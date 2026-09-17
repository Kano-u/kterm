<script setup>
/* EditorView：CodeMirror 6 实例的持有者。
 *
 * 本组件由 App.vue 用 defineAsyncComponent 懒加载，且仅在 state.editors 非空时
 * 挂载 → 首屏（文件列表）不会下载 CM 内核，故 CM 的 import 可以写在顶层。
 *
 * 层叠模型（同 TerminalView）：tabId -> {el, view}，v-show 切换；切走视图不销毁
 * doc，切回即恢复（含撤销栈与光标）。CM 的 EditorState 不进响应式 store，
 * 只在这里的普通 Map 中持有；store 侧的会话条目只存纯 UI 状态与钩子。
 */
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { EditorState, Compartment, Annotation } from '@codemirror/state'
import {
  EditorView as CM, keymap, lineNumbers, drawSelection, dropCursor,
  highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, rectangularSelection,
  crosshairCursor,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'

import { state } from '../store.js'
import { editorOf, saveEditor, closeEditor, requestReload, toggleReadOnly } from '../editor.js'
import { languageFor, m3Theme } from '../editor-lang.js'
import { activeBusy } from '../terminal.js'
import Icon from './Icon.vue'

const layersEl = ref(null)
const layerCount = ref(0)
/* tabId -> {el, view, readonly} */
const layers = new Map()

/* 标记「程序写入」（打开/重载/换文件）：文档更新监听据此跳过 dirty 重算 */
const External = Annotation.define()

const current = computed(() => editorOf(state.activeTabId))
const busy = computed(() => activeBusy())
const cursor = ref({ line: 1, col: 1, lines: 1 })

function readonlyExtensions() {
  return [EditorState.readOnly.of(true), CM.editable.of(false)]
}

/* 把 store 里的 readOnly / busy 应用到某个层的 CM 实例 */
function applyLock(tabId) {
  const rec = layers.get(tabId)
  const e = state.editors.get(tabId)
  if (!rec || !e) return
  rec.view.dispatch({
    effects: rec.readOnlyComp.reconfigure(e.readOnly || e.busy ? readonlyExtensions() : []),
  })
}

function buildExtensions(tabId, rec, entry) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    foldGutter(),
    highlightSelectionMatches(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    CM.lineWrapping,
    keymap.of([
      // Ctrl+S 保存（preventDefault 阻止浏览器默认的「保存网页」）
      { key: 'Mod-s', preventDefault: true, run: () => { saveEditor(tabId); return true } },
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    rec.langComp.of([]),
    rec.readOnlyComp.of(entry.readOnly || entry.busy ? readonlyExtensions() : []),
    CM.updateListener.of((u) => {
      if (u.docChanged && !u.transactions.some((t) => t.annotation(External))) {
        const e = state.editors.get(tabId)
        const r = layers.get(tabId)
        if (e && r && r.orig) e.dirty = !u.state.doc.eq(r.orig)
      }
      if ((u.selectionSet || u.docChanged) && tabId === state.activeTabId) {
        cursor.value = cursorOf(u.view)
      }
    }),
  ]
}

function cursorOf(view) {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  return { line: line.number, col: head - line.from + 1, lines: view.state.doc.lines }
}

/* 建层：仅在需要编辑该 tab 时创建 CM 实例（含语言包 / 主题的懒加载）。
 * pending 去重：watch 可能在同一 tick 内触发多次（会话新增 + 视图切换），
 * 而 ensureLayer 内部有 await，否则会重复创建 CM 实例。 */
const pending = new Map()

function ensureLayer(tabId) {
  if (layers.has(tabId)) return Promise.resolve(layers.get(tabId))
  if (pending.has(tabId)) return pending.get(tabId)
  const p = createLayer(tabId).finally(() => pending.delete(tabId))
  pending.set(tabId, p)
  return p
}

async function createLayer(tabId) {
  const entry = state.editors.get(tabId)
  if (!entry) return null

  const el = document.createElement('div')
  el.className = 'absolute inset-0 overflow-hidden'
  el.style.display = 'none'
  layersEl.value.appendChild(el)

  // 语言包（大文件跳过）+ 主题，首次打开编辑器才下载
  const [lang, theme] = await Promise.all([
    entry.highlight ? languageFor(entry.name) : Promise.resolve(null),
    m3Theme(),
  ])
  // 加载期间会话可能已被替换 / 关闭
  const still = state.editors.get(tabId)
  if (still !== entry) {
    el.remove()
    return null
  }

  const rec = { el, view: null, orig: null, relPath: entry.relPath, langComp: new Compartment(), readOnlyComp: new Compartment() }

  // 闭包捕获本层实例（不用 layers.get：同一 tab 可能已换为更新的会话）
  const applyDocTo = (text, highlight) => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      annotations: External.of(true),
    })
    rec.orig = view.state.doc
    if (highlight !== undefined) setHighlightFor(rec, entry, highlight)
  }

  const state_ = EditorState.create({
    doc: entry.text,
    extensions: buildExtensions(tabId, rec, entry).concat([
      rec.langComp.of(lang ? [lang] : []),
      theme,
    ]),
  })
  const view = new CM({ state: state_, parent: el })
  rec.view = view
  rec.orig = view.state.doc
  layers.set(tabId, rec)
  layerCount.value = layers.size

  // 注入钩子：store 侧只通过这些函数与 CM 交互。
  // 钩子内部先确认「本层仍是当前会话的层」——旧层的异步回调不应影响新会话。
  entry.getText = () => view.state.doc.toString()
  entry.applyDoc = (text, highlight) => {
    if (layers.get(tabId) !== rec) return
    applyDocTo(text, highlight)
    const e = state.editors.get(tabId)
    if (e) {
      e.text = text
      e.dirty = false
    }
  }
  entry.markSaved = () => {
    if (layers.get(tabId) === rec) rec.orig = view.state.doc
  }
  entry.syncLock = () => applyLock(tabId)

  if (tabId === state.activeTabId) cursor.value = cursorOf(view)
  return rec
}

async function setHighlight(tabId, on) {
  const e = state.editors.get(tabId)
  const rec = layers.get(tabId)
  if (!rec || !e) return
  await setHighlightFor(rec, e, on)
}

async function setHighlightFor(rec, e, on) {
  e.highlight = on
  const lang = on ? await languageFor(e.name) : null
  if (rec.view === null || rec.disposed) return
  rec.view.dispatch({ effects: rec.langComp.reconfigure(lang ? [lang] : []) })
}

function showLayer(tabId) {
  for (const [id, rec] of layers) {
    rec.el.style.display = id === tabId ? 'block' : 'none'
    if (id === tabId) {
      nextTick(() => {
        rec.view.requestMeasure()
        cursor.value = cursorOf(rec.view)
      })
    }
  }
}

function disposeLayer(tabId) {
  const rec = layers.get(tabId)
  if (!rec) return
  rec.disposed = true
  rec.view.destroy()
  rec.el.remove()
  layers.delete(tabId)
  layerCount.value = layers.size
}

/* 会话集合变化：新增 / 换文件 / 移除 → 重建或回收对应层。
 * 键包含文件路径：换文件时旧层必须销毁重建（清空撤销栈与语法状态）。 */
const layerKeys = () =>
  [...state.editors.entries()].map(([id, e]) => id + ':' + e.relPath).join(',')

watch(
  layerKeys,
  async () => {
    const alive = new Set(state.editors.keys())
    for (const [tabId, rec] of [...layers]) {
      const e = state.editors.get(tabId)
      if (!alive.has(tabId) || !e || e.relPath !== rec.relPath) disposeLayer(tabId)
    }
    if (state.view !== 'editor') return
    const tabId = state.activeTabId
    if (!alive.has(tabId)) return
    const rec = await ensureLayer(tabId)
    // 等待期间视图/标签可能又变了，只在仍应显示时展示
    if (rec && state.view === 'editor' && state.activeTabId === tabId) showLayer(tabId)
  },
  { flush: 'post' },
)

/* 视图 / 激活标签变化 → 建层 + 层叠显示 */
watch(
  () => [state.view, state.activeTabId],
  async ([view, tabId]) => {
    if (view !== 'editor') return
    if (!state.editors.has(tabId)) return
    const rec = await ensureLayer(tabId)
    if (rec && state.view === 'editor' && state.activeTabId === tabId) showLayer(tabId)
  },
  { flush: 'post' },
)

/* 终端 busy 变化 → 编辑器只读锁定（服务端 write 亦兜底） */
watch(busy, (on) => {
  const e = state.editors.get(state.activeTabId)
  if (e) e.busy = on
  applyLock(state.activeTabId)
})

/* 只读开关变化（顶栏按钮） */
watch(
  () => current.value && current.value.readOnly,
  () => applyLock(state.activeTabId),
)

/* 焦点不在 CM 内（例如点了顶栏按钮）时 Ctrl+S 也要生效 */
function onKeydown(ev) {
  if (state.view !== 'editor' || ev.defaultPrevented) return
  if (ev.ctrlKey || ev.metaKey) {
    const k = ev.key.toLowerCase()
    if (k === 's') {
      ev.preventDefault()
      saveEditor(state.activeTabId)
    } else if (k === 'w') {
      ev.preventDefault()
      closeEditor(state.activeTabId)
    }
  }
}

window.addEventListener('keydown', onKeydown)
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  for (const tabId of [...layers.keys()]) disposeLayer(tabId)
})
</script>

<template>
  <main class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-1">
    <!-- 顶栏：文件名 + dirty 圆点 + 光标 / 大小状态 + 操作 -->
    <div class="flex flex-none items-center gap-0.5 border-b border-outline-variant/40 bg-surface px-2 py-1.5">
      <span class="material-symbols-outlined ml-1 flex-none text-primary" style="font-size: 18px">edit_document</span>
      <div class="min-w-0 flex-1 pl-1">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="truncate text-[13px] text-on-surface">{{ current ? current.name : '' }}</span>
          <span
            v-if="current && current.dirty"
            class="h-2 w-2 flex-none rounded-full bg-primary"
            title="有未保存的修改"
          />
          <span v-if="current && current.readOnly" class="material-symbols-outlined flex-none text-on-surface-variant" style="font-size: 13px">lock</span>
        </div>
        <div class="truncate text-[11px] text-on-surface-variant">
          <template v-if="current">
            {{ current.dirty ? '未保存' : '已保存' }} · 第 {{ cursor.line }}/{{ cursor.lines }} 行 第 {{ cursor.col }} 列
            <template v-if="!current.highlight"> · 已关闭高亮</template>
          </template>
        </div>
      </div>

      <span
        v-if="busy"
        class="material-symbols-outlined flex-none animate-spin text-primary"
        style="font-size: 16px"
        title="终端正在运行命令，暂不能保存"
      >progress_activity</span>
      <button
        class="state-layer flex h-9 w-9 flex-none items-center justify-center rounded-full"
        :class="current && current.readOnly ? 'text-primary' : 'text-on-surface-variant'"
        :title="current && current.readOnly ? '解除只读' : '设为只读'"
        @click="toggleReadOnly(state.activeTabId)"
      >
        <Icon :name="current && current.readOnly ? 'lock' : 'lock_open'" :size="18" />
      </button>
      <button
        class="state-layer flex h-9 w-9 flex-none items-center justify-center rounded-full text-on-surface-variant"
        title="重新加载（丢弃当前修改）"
        @click="requestReload(state.activeTabId)"
      >
        <Icon name="refresh" :size="18" />
      </button>
      <button
        class="state-layer flex h-9 flex-none items-center gap-1 rounded-full px-3 text-[13px] font-medium text-primary transition-opacity disabled:pointer-events-none disabled:opacity-35"
        :disabled="!current || !current.dirty || busy || current.readOnly"
        :title="busy ? '终端正在运行命令' : '保存 (Ctrl+S)'"
        @click="saveEditor(state.activeTabId)"
      >
        <Icon name="save" :size="18" />
        保存
      </button>
      <button
        class="state-layer flex h-9 w-9 flex-none items-center justify-center rounded-full text-on-surface-variant"
        title="关闭编辑器"
        @click="closeEditor(state.activeTabId)"
      >
        <Icon name="close" :size="18" />
      </button>
    </div>

    <!-- CM 层叠容器 -->
    <div ref="layersEl" class="relative min-h-0 flex-1 overflow-hidden">
      <div
        v-if="layerCount === 0"
        class="absolute inset-0 flex items-center justify-center text-sm text-on-surface-variant/70"
      >
        正在打开编辑器…
      </div>
    </div>
  </main>
</template>

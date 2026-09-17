<script setup>
import { ref, watch, nextTick, onUnmounted } from 'vue'
import EntrySheet from './EntrySheet.vue'
import Icon from './Icon.vue'
import { fileIcon } from '../icons.js'
import {
  state, activeTab, shownEntries, shownSearchResults, pruneSelection,
  enterMultiSelect, exitMultiSelect, toggleSelect,
  fmtSize, fmtTime, joinPath,
} from '../store.js'
import { navigate, gotoSearchHit } from '../actions.js'

const listEl = ref(null)
const sheetEntry = ref(null)

const shown = () => shownEntries()
const tab = () => activeTab()

/* 长按进入多选（500ms，移动即取消） */
let pressTimer = null
let pressMoved = false

function onContextmenu(ev) {
  ev.preventDefault()
}

function onPointerdown(ev) {
  const row = ev.target.closest('[data-row]')
  if (!row || state.multi.active) return
  pressMoved = false
  const name = row.dataset.row
  pressTimer = setTimeout(() => {
    pressTimer = null
    if (!pressMoved) {
      if (navigator.vibrate) navigator.vibrate(30)
      enterMultiSelect(name)
    }
  }, 500)
}

function cancelPress() {
  pressMoved = true
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}
function onPointerup() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

/* 列表变化时同步多选集合（删除/粘贴后自动清掉已不存在的选中项）。
 * 直接 watch 当前 tab 的缓存引用：缓存每次导航/刷新都是新数组，
 * 比 watch(shown) 的 getter 更直白（后者每次返回新数组引用，必触发）。 */
watch(
  () => { const t = tab(); return t.cache && t.cache.path === t.path ? t.cache.entries : null },
  (entries) => pruneSelection(entries || []),
  { flush: 'sync' },
)

onUnmounted(() => {
  document.removeEventListener('pointermove', cancelPress)
})

function onClickRow(e) {
  const tab0 = tab()
  if (state.multi.active) {
    toggleSelect(e.name)
    return
  }
  if (e.isDir) {
    navigate(joinPath(tab0.path, e.name))
  } else {
    sheetEntry.value = e
  }
}

/* 搜索结果：点目录进入该目录；点文件跳到其父目录并高亮 */
function onClickHit(hit) {
  if (state.multi.active) return
  gotoSearchHit(hit)
}

/* 搜索结果副标题：相对当前目录的路径 */
function hitSub(hit) {
  return hit.dir ? './' + hit.dir : '当前目录'
}
</script>

<template>
  <main
    ref="listEl"
    class="relative flex-1 overflow-y-auto overscroll-contain"
    @contextmenu="onContextmenu"
    @pointerdown="onPointerdown"
    @pointermove="cancelPress"
    @pointerup="onPointerup"
    @pointercancel="cancelPress"
    @scroll.passive="cancelPress"
  >
    <!-- 搜索结果视图 -->
    <template v-if="state.search.active">
      <div
        v-if="state.search.busy && shownSearchResults().length === 0"
        class="fade-in flex flex-col items-center gap-3 px-4 py-16 text-on-surface-variant/70"
      >
        <Icon name="search" :size="48" />
        <span class="text-sm">搜索中…</span>
      </div>
      <template v-else>
        <div
          v-if="state.search.truncated"
          class="flex items-center gap-2 bg-tertiary-container/50 px-4 py-2 text-xs text-on-surface-variant"
        >
          <Icon name="info" :size="16" />
          结果过多，仅显示前 500 条
        </div>
        <div
          v-if="!state.search.query.trim()"
          class="fade-in flex flex-col items-center gap-3 px-4 py-16 text-on-surface-variant/70"
        >
          <Icon name="search" :size="48" />
          <span class="text-sm">输入关键字搜索当前目录及子目录</span>
        </div>
        <div
          v-else-if="shownSearchResults().length === 0"
          class="fade-in flex flex-col items-center gap-3 px-4 py-16 text-on-surface-variant/70"
        >
          <Icon name="folder_open" :size="48" />
          <span class="text-sm">无匹配结果</span>
        </div>
        <div
          v-for="hit in shownSearchResults()"
          :key="hit.dir + '/' + hit.name"
          class="state-layer flex min-h-13 cursor-pointer items-center gap-3.5 border-b border-outline-variant/25 px-3 select-none"
          @click="onClickHit(hit)"
        >
          <span class="flex h-9 w-9 flex-none items-center justify-center text-primary">
            <Icon :name="fileIcon(hit)" :size="24" :filled="!hit.isDir ? false : true" />
          </span>
          <span class="min-w-0 flex flex-1 flex-col justify-center">
            <span class="truncate text-sm">{{ hit.name }}</span>
            <span class="truncate text-xs text-on-surface-variant">{{ hitSub(hit) }}</span>
          </span>
          <span v-if="!hit.isDir" class="flex-none text-xs text-on-surface-variant">
            {{ fmtSize(hit.size) }} · {{ fmtTime(hit.mtime) }}
          </span>
        </div>
      </template>
    </template>

    <!-- 目录列表视图 -->
    <template v-else>
    <div
      v-if="shown().length === 0"
      class="fade-in flex flex-col items-center gap-3 px-4 py-16 text-on-surface-variant/70"
    >
      <Icon name="folder_open" :size="48" />
      <span class="text-sm">空文件夹</span>
    </div>

    <div
      v-for="e in shown()"
      :key="e.name"
      :data-row="e.name"
      class="ripple state-layer flex min-h-13 cursor-pointer items-center gap-3.5 border-b border-outline-variant/25 px-3 select-none transition-colors"
      :class="
        state.multi.active && state.multi.sel.has(e.name)
          ? 'bg-secondary-container/40'
          : 'bg-surface-1'
      "
      @click="onClickRow(e)"
    >
      <!-- 多选复选框（M3 checkbox 形态） -->
      <span
        v-if="state.multi.active"
        class="material-symbols-outlined flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[2px] border-2"
        :class="
          state.multi.sel.has(e.name)
            ? 'border-primary bg-primary text-on-primary'
            : 'border-on-surface-variant text-transparent'
        "
        style="font-size: 15px; font-variation-settings: 'FILL' 1"
      >check</span>

      <span class="flex h-9 w-9 flex-none items-center justify-center text-primary">
        <Icon :name="fileIcon(e)" :size="24" :filled="!e.isDir ? false : true" />
      </span>
      <span class="min-w-0 flex-1 truncate text-sm">{{ e.name }}</span>
      <span v-if="!e.isDir" class="flex-none text-xs text-on-surface-variant">
        {{ fmtSize(e.size) }} · {{ fmtTime(e.mtime) }}
      </span>
    </div>

    <!-- 单击文件：底部详情/操作面板 -->
    <EntrySheet v-if="sheetEntry" :entry="sheetEntry" @close="sheetEntry = null" />
    </template>
  </main>
</template>

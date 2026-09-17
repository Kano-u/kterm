/* 编辑器会话管理（镜像 terminal.js 的架构）。
 *
 * state.editors: Map<tabId, {
 *   relPath, name,          // 编辑目标（展示路径：相对 / 绝对）
 *   text,                   // 打开 / 重载时读到的内容（已归一为 \n）
 *   eol,                    // 原文件换行风格：'\n' | '\r\n'（保存时原样写回）
 *   modTime, size,          // 服务端读到的 mtime / 大小（冲突检测、大文件降级）
 *   dirty, readOnly, busy,  // 界面状态
 *   highlight,              // 是否启用语法高亮（大文件降级）
 *   getText, applyDoc, markSaved, setReadOnly,  // 由 EditorView.vue 挂载时注入
 * }>
 *
 * 关键设计：CodeMirror 的 EditorState / Text **不放进响应式 store**（它们是
 * 大对象且不可代理），由 EditorView.vue 的普通 Map 持有；这里只保留纯 UI 状态
 * 与几个钩子函数。首屏不会静态加载任何 CodeMirror 包（本模块只用动态 import）。
 */
import { state, joinPath } from './store.js'
import { toast } from './toast.js'
import { apiGet, apiOp } from './api.js'
import { confirm } from './confirm.js'
import { ensureUnlocked, isBusy } from './terminal.js'
import { isTextName, HIGHLIGHT_MAX } from './editor-lang.js'

/* ---------- 换行风格 ---------- */

/* 原文件是否使用 CRLF（CM 内部统一按 \n，保存时再还原） */
export function detectEOL(content) {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

/* 统一为 \n 供编辑内核使用（CRLF / 孤立 CR 都归一） */
export function normalizeEOL(content) {
  return content.replace(/\r\n?/g, '\n')
}

/* 保存时把 \n 还原为原文件的换行风格 */
export function applyEOL(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}

/* ---------- 会话查询 ---------- */

export function editorOf(tabId) {
  return state.editors.get(tabId)
}

/* 当前激活标签的编辑会话 */
export function activeEditor() {
  return state.editors.get(state.activeTabId)
}

export function isEditorOpen(tabId) {
  return state.editors.has(tabId)
}

export function editorDirty(tabId) {
  const e = state.editors.get(tabId)
  return !!e && e.dirty
}

export function editorReadOnly(tabId) {
  const e = state.editors.get(tabId)
  return !!e && e.readOnly
}

/* 是否有任一编辑器有未保存修改（刷新 / 关标签拦截用） */
export function anyDirty() {
  for (const e of state.editors.values()) {
    if (e.dirty) return true
  }
  return false
}

/* 该文件的父目录相对路径（保存/重载后刷新列表用） */
export function editorDir(e) {
  const i = e.relPath.lastIndexOf('/')
  return i < 0 ? '' : e.relPath.slice(0, i)
}

/* ---------- 打开 / 关闭 ---------- */

async function confirmDiscard(name) {
  return confirm({
    title: '放弃未保存的修改？',
    message: `“${name}” 有未保存的修改，放弃后无法恢复。`,
    okText: '放弃修改',
  })
}

/* 打开（或切换到）某文件：tab 为拥有该文件的标签，file 为列表条目。
 * 非文本文件入口处已过滤，这里是兜底。同一标签已有未保存改动时先确认。 */
export async function openEditor(tab, file) {
  if (!file || file.isDir) return false
  if (!isTextName(file.name)) {
    toast('该类型文件不支持编辑')
    return false
  }
  const rel = joinPath(tab.path, file.name)
  const cur = state.editors.get(tab.id)
  if (cur && cur.relPath === rel) {
    enterEditorView(tab.id, rel)
    return true
  }
  if (cur && cur.dirty && !(await confirmDiscard(cur.name))) return false
  if (!(await loadEditor(tab.id, rel, file.name))) return false
  enterEditorView(tab.id, rel)
  return true
}

/* 读取服务端内容并建立会话（不切视图）。同一标签已有挂载实例时
 * 复用其钩子，把新内容直接替换进现有 CM 实例（不重建编辑器）。 */
async function loadEditor(tabId, rel, name) {
  let data
  try {
    data = await apiGet('/api/read?path=' + encodeURIComponent(rel))
  } catch (err) {
    toast(err.message)
    return false
  }
  const prev = state.editors.get(tabId)
  const sameFile = !!prev && prev.relPath === rel
  const entry = {
    relPath: rel,
    name: name || rel.split('/').pop(),
    text: normalizeEOL(data.content || ''),
    eol: detectEOL(data.content || ''),
    modTime: data.mtime,
    size: data.size,
    dirty: false,
    readOnly: false,
    busy: isBusy(tabId),
    highlight: (data.size || 0) <= HIGHLIGHT_MAX,
    // 钩子只在本标签的同一文件重载时沿用；换文件由 EditorView 重建 CM 实例
    // （重建才能清空撤销栈，避免撤销回到上一个文件的内容）
    getText: sameFile ? prev.getText : null,
    applyDoc: sameFile ? prev.applyDoc : null,
    markSaved: sameFile ? prev.markSaved : null,
    syncLock: sameFile ? prev.syncLock : null,
  }
  state.editors.set(tabId, entry)
  const live = state.editors.get(tabId)
  if (live.applyDoc) live.applyDoc(live.text, live.highlight)
  return true
}

/* 进入编辑视图并压入 history 记录（返回手势 = 回文件视图） */
function enterEditorView(tabId, rel) {
  const tab = state.tabs.find((t) => t.id === tabId)
  if (state.view !== 'editor' || state.activeTabId !== tabId) {
    state.activeTabId = tabId
    state.view = 'editor'
    history.pushState({ tabId, path: tab ? tab.path : '', editor: rel }, '')
  }
}

/* 关闭编辑会话（底部「编辑」按钮的 ×）：有未保存改动先确认。 */
export async function closeEditor(tabId) {
  const e = state.editors.get(tabId)
  if (!e) return false
  if (e.dirty && !(await confirmDiscard(e.name))) return false
  state.editors.delete(tabId)
  exitEditorView(tabId)
  return true
}

/* 静默丢弃（标签关闭 / 视图切换后清理；调用方已确认） */
export function dropEditor(tabId) {
  if (!state.editors.has(tabId)) return
  state.editors.delete(tabId)
  exitEditorView(tabId)
}

/* 离开编辑视图（若正停在其中） */
function exitEditorView(tabId) {
  if (state.view === 'editor' && state.activeTabId === tabId) state.view = 'files'
}

/* ---------- 保存 ---------- */

/* 保存指定标签当前编辑的文件；true 表示内容已落盘（dirty 已清）。 */
export async function saveEditor(tabId) {
  const e = state.editors.get(tabId)
  if (!e || !e.getText) return false
  if (!e.dirty) return true
  if (e.readOnly) {
    toast('当前为只读模式，无法保存')
    return false
  }
  if (!ensureUnlocked()) return false // 终端运行中：与服务端 rejectIfBusy 同一机制

  const content = applyEOL(e.getText(), e.eol)
  try {
    const res = await apiOp('/api/write', { path: e.relPath, content, mtime: e.modTime })
    markSaved(tabId, res.mtime)
    toast('已保存 ' + e.name, 'ok')
    return true
  } catch (err) {
    if (err.status === 409) return await resolveConflict(tabId, content)
    toast(err.message)
    return false
  }
}

function markSaved(tabId, mtime) {
  const e = state.editors.get(tabId)
  if (!e) return
  if (e.markSaved) e.markSaved()
  e.dirty = false
  if (mtime) e.modTime = mtime
}

/* mtime 冲突（打开后被外部改写）：重新加载 / 覆盖保存 / 取消 三选一 */
async function resolveConflict(tabId, content) {
  const e = state.editors.get(tabId)
  if (!e) return false
  const choice = await confirm({
    title: '文件已被其他程序修改',
    message: `“${e.name}” 在编辑期间被其他程序改写。\n重新加载：丢弃当前修改，载入磁盘最新内容\n覆盖保存：用当前内容覆盖磁盘文件`,
    okText: '重新加载',
    dangerText: '覆盖保存',
  })
  if (choice === 'danger') {
    try {
      // 覆盖：先读磁盘当前 mtime，再以该 mtime 写入
      const data = await apiGet('/api/read?path=' + encodeURIComponent(e.relPath))
      const res = await apiOp('/api/write', { path: e.relPath, content, mtime: data.mtime })
      markSaved(tabId, res.mtime)
      toast('已覆盖保存 ' + e.name, 'ok')
      return true
    } catch (err) {
      toast(err.message)
      return false
    }
  }
  if (choice === true) {
    await reloadEditor(tabId)
    return false
  }
  return false
}

/* 请求重新加载：有未保存修改时先确认 */
export async function requestReload(tabId) {
  const e = state.editors.get(tabId)
  if (!e) return false
  if (e.dirty) {
    const ok = await confirm({
      title: '重新加载？',
      message: `“${e.name}” 有未保存的修改，重新加载将丢弃这些修改。`,
      okText: '重新加载',
    })
    if (ok !== true) return false
  }
  return reloadEditor(tabId)
}

/* 丢弃当前修改，重新从磁盘载入 */
export async function reloadEditor(tabId) {
  const e = state.editors.get(tabId)
  if (!e) return false
  let data
  try {
    data = await apiGet('/api/read?path=' + encodeURIComponent(e.relPath))
  } catch (err) {
    toast(err.message)
    return false
  }
  e.text = normalizeEOL(data.content || '')
  e.eol = detectEOL(data.content || '')
  e.modTime = data.mtime
  e.size = data.size
  const highlight = (data.size || 0) <= HIGHLIGHT_MAX
  e.highlight = highlight
  e.dirty = false
  if (e.applyDoc) e.applyDoc(e.text, highlight)
  toast('已重新加载 ' + e.name, 'ok')
  return true
}

/* 只读开关（顶栏按钮）：写入 store 后由 EditorView 的 watch 同步到 CM 实例 */
export function toggleReadOnly(tabId) {
  const e = state.editors.get(tabId)
  if (!e) return false
  e.readOnly = !e.readOnly
  if (e.syncLock) e.syncLock()
  toast(e.readOnly ? '已设为只读' : '已解除只读', 'ok')
  return e.readOnly
}

/* 保存的便捷入口（当前标签） */
export function saveActive() {
  return saveEditor(state.activeTabId)
}

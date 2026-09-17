import { toast } from './toast.js'
import { apiList, apiOp, apiSearch } from './api.js'
import {
  state, activeTab, saveState, newTab, exitMultiSelect, resetSearch, joinPath, applyListing,
} from './store.js'
import { confirm } from './confirm.js'
import { sendCd, ensureUnlocked, ensureCloseable, removeTerm } from './terminal.js'
import { editorDirty, dropEditor, closeEditor } from './editor.js'
import { isSettingsState, applySettingsState, exitSettings, canLeaveSettings, reopenSettingsPage, takeGuardPassed } from './settingsnav.js'

/* 文件页导航成功后向该 tab 的终端注入 cd（T2 双向同步） */
function syncTerminalCd(tab) {
  if (state.terminals.has(tab.id)) sendCd(tab.id, tab.path)
}

/* 进入新目录：更新 tab 栈 + pushState（Android 返回手势 = 返回上级）。
 * opts.fromTerminal=true 表示该导航由终端 OSC 7 上报驱动：
 *   1) 不向其回注 cd（否则终端里会凭空多出一条 cd 命令）；
 *   2) 可能是非活动标签的终端在后台改目录，不夺焦、不写 history。 */
export async function navigate(path, opts = {}) {
  await navigateTab(activeTab(), path, opts)
}

/* 指定标签导航。tab 非当前活动标签时只更新其缓存/历史（后台同步，不 pushState）。
 * 不改变 state.view：终端 OSC 7 上报可能来自后台标签，当前视图（编辑/终端）不应被扰动。 */
export async function navigateTab(tab, path, opts = {}) {
  if (!state.tabs.includes(tab)) return // 标签已被关闭
  exitMultiSelect()
  try {
    const data = await apiList(path)
    applyListing(tab, data)
    // 截断前进分支，压入新记录
    tab.history = tab.history.slice(0, tab.histIdx + 1)
    if (tab.history[tab.histIdx] !== tab.path) {
      tab.history.push(tab.path)
      tab.histIdx++
    }
    if (tab.id === state.activeTabId) {
      history.pushState({ tabId: tab.id, path: tab.path }, '')
    }
    saveState()
    if (!opts.fromTerminal) syncTerminalCd(tab)
  } catch (err) {
    toast(err.message)
  }
}

/* Android 返回手势 / 浏览器后退：恢复对应 tab 的上一路径（前进由浏览器自身的历史栈承担，
 * 页面内不再提供前进/后退按钮）
 *
 * 编辑器会话不会因返回手势或视图切换而销毁（切走再切回 doc/撤销栈原样保留），
 * 因此这里只在「同一标签内换文件」时询问，不做多余的丢改动确认。
 *
 * 设置子页有未保存改动时，返回手势已经生效（记录已出栈），因此这里用「先把记录压回去」
 * 的方式撤销这次返回，等用户确认后再走一次 history.back()。 */
export async function onPopState(ev, restorePath) {
  const s = ev.state
  const incoming = isSettingsState(s) ? s.settings || '' : null
  // 离开设置子页（回列表页或退出设置）前先过未保存守卫
  // （页面内按钮触发的那次回退已经问过，用一次性标记跳过）
  if (state.settingsPage && state.settingsPage !== incoming && !takeGuardPassed()) {
    if (!(await canLeaveSettings())) {
      reopenSettingsPage(state.settingsPage) // 撤销这次返回，停在子页
      return
    }
  }
  // 设置页记录：还原设置页层级（返回手势在设置列表页/子页之间回退）
  if (incoming !== null) {
    applySettingsState(s)
    return
  }
  // 从设置页退回文件/终端/编辑器记录：还原进入设置前的视图
  if (state.view === 'settings') exitSettings()

  // 编辑器记录：返回手势回到进入编辑器前的文件列表（会话保留不丢）。
  // 会话已被关闭（无 dirty 时关掉）时记录会失效，此时按文件视图处理。
  const tab0 = s && s.tabId ? state.tabs.find((t) => t.id === s.tabId) : null
  if (s && s.editor && tab0 && state.editors.has(tab0.id)) {
    state.activeTabId = tab0.id
    state.view = 'editor'
    return
  }
  if (state.view === 'editor') state.view = 'files'

  let tab = null
  if (s && s.tabId) tab = state.tabs.find((t) => t.id === s.tabId)
  if (!tab) tab = activeTab()

  const path = s && typeof s.path === 'string' ? s.path : tab.path
  const idx = tab.history.indexOf(path)
  if (idx >= 0) tab.histIdx = idx

  state.activeTabId = tab.id
  exitMultiSelect()
  restorePath(tab, path)
}

export async function restorePath(tab, path) {
  try {
    const data = await apiList(path)
    applyListing(tab, data)
    syncTerminalCd(tab)
  } catch (err) {
    toast(err.message)
  }
  saveState()
}

/* ---------- 标签操作 ---------- */

export async function addTab() {
  const tab = newTab()
  try {
    const data = await apiList('')
    applyListing(tab, data)
  } catch (err) {
    tab.abs = ''
    tab.cache = { path: '', entries: [] }
    toast(err.message)
  }
  state.tabs.push(tab)
  state.activeTabId = tab.id
  state.view = 'files' // 新建标签默认进入文件视图（终端/编辑器惰性创建，不跟随）
  history.pushState({ tabId: tab.id, path: '' }, '')
  saveState()
}

export function closeTab(id) {
  if (state.tabs.length <= 1) return // 至少保留一个标签
  // T3：该标签的终端有命令在运行时拒绝关闭（toast 提示）
  if (!ensureCloseable(id)) return
  // E4：该标签的编辑器有未保存改动时先确认（异步，确认后再关）
  closeTabConfirmed(id)
}

async function closeTabConfirmed(id) {
  if (editorDirty(id)) {
    const e = state.editors.get(id)
    const ok = await confirm({
      title: '放弃未保存的修改？',
      message: `“${e.name}” 有未保存的修改，关闭标签后无法恢复。`,
      okText: '放弃并关闭',
    })
    if (ok !== true) return
  }
  // T4：先杀掉该标签绑定的终端（WS close → 服务端立即结束 PTY），再删标签
  removeTerm(id)
  dropEditor(id)
  const idx = state.tabs.findIndex((t) => t.id === id)
  state.tabs.splice(idx, 1)
  if (state.activeTabId === id) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)]
    state.activeTabId = next.id
    // 切到新标签：该标签若没有编辑会话则退出编辑视图
    if (state.view === 'editor' && !state.editors.has(next.id)) state.view = 'files'
  }
  saveState()
}

/* 切换标签：有缓存直接用，不重新请求 */
export function switchTab(id) {
  if (id === state.activeTabId) return
  const tab = state.tabs.find((t) => t.id === id)
  if (!tab) return
  exitMultiSelect()
  state.activeTabId = id
  // 编辑视图中切标签：目标标签有编辑会话则继续显示编辑视图，否则回文件视图
  if (state.view === 'editor' && !state.editors.has(id)) state.view = 'files'
  if (!tab.cache) {
    // 无缓存（恢复后首次切换）才请求
    apiList(tab.path)
      .then((data) => {
        applyListing(tab, data)
        saveState()
        syncTerminalCd(tab)
      })
      .catch((err) => toast(err.message))
  }
  history.pushState({ tabId: id, path: tab.path }, '')
  saveState()
}

/* 刷新当前 tab 列表（写操作成功后调用） */
export async function refreshActive() {
  const tab = activeTab()
  try {
    const data = await apiList(tab.path)
    applyListing(tab, data)
    saveState()
  } catch (err) {
    toast(err.message)
  }
}

/* ---------- 基础操作（新建 / 重命名） ---------- */

export async function doCreate(result) {
  if (!ensureUnlocked()) return false // T3：当前标签终端运行中
  const tab = activeTab()
  try {
    if (result.kind === 'dir') {
      await apiOp('/api/mkdir', { path: tab.path, name: result.name })
      toast('已创建文件夹 ' + result.name, 'ok')
    } else {
      await apiOp('/api/create', { path: tab.path, name: result.name })
      toast('已创建文件 ' + result.name, 'ok')
    }
    await refreshActive()
    return true
  } catch (err) {
    toast(err.message)
    return false
  }
}

export async function doRename(entry, newName) {
  if (!ensureUnlocked()) return false // T3
  const tab = activeTab()
  try {
    await apiOp('/api/rename', { path: tab.path, oldName: entry.name, newName })
    toast('已重命名为 ' + newName, 'ok')
    await refreshActive()
    return true
  } catch (err) {
    toast(err.message)
    return false
  }
}

/* ---------- 删除 / 回收站 ---------- */

/**
 * 删除确认框：主按钮移入回收站，红色破坏性按钮永久删除。
 * 返回 true 表示执行了任一删除（调用方刷新列表）。
 */
export async function confirmDelete(names) {
  if (!ensureUnlocked()) return false // T3：当前标签终端运行中
  const n = names.length
  const label = n === 1 ? `“${names[0]}”` : `${n} 项`
  const choice = await confirm({
    title: '删除',
    message: `确定删除 ${label} 吗？\n移入回收站后可随时恢复。`,
    okText: '移入回收站',
    dangerText: '永久删除',
  })
  if (choice === false) return false
  const mode = choice === 'danger' ? 'permanent' : 'trash'
  const tab = activeTab()
  try {
    const report = await apiOp('/api/delete', { path: tab.path, names, mode })
    if (report.failed === 0) {
      toast(mode === 'permanent' ? `已永久删除 ${report.success} 项` : `已移入回收站 ${report.success} 项`, 'ok')
    } else {
      const firstFail = report.results.find((r) => !r.ok)
      toast(`成功 ${report.success} 项，失败 ${report.failed} 项：` + (firstFail ? firstFail.error : ''))
    }
    exitMultiSelect()
    await refreshActive()
    return true
  } catch (err) {
    toast(err.message)
    return false
  }
}

/* ---------- 回收站面板动作（由 TrashPanel.vue 调用） ---------- */

export async function restoreBatch(id) {
  try {
    const report = await apiOp('/api/trash/restore', { ids: [id] })
    if (report.failed === 0) {
      toast('已恢复到原位置', 'ok')
    } else {
      const firstFail = report.results.find((r) => !r.ok)
      toast(`部分恢复失败：` + (firstFail ? firstFail.error : ''))
    }
    return true
  } catch (err) {
    toast(err.message)
    return false
  }
}

export async function purgeBatch(id) {
  try {
    await apiOp('/api/trash/purge', { ids: [id] })
    toast('已彻底删除', 'ok')
    return true
  } catch (err) {
    toast(err.message)
    return false
  }
}

export async function emptyTrash() {
  try {
    await apiOp('/api/trash/purge', { all: true })
    toast('回收站已清空', 'ok')
    return true
  } catch (err) {
    toast(err.message)
    return false
  }
}

/* ---------- 搜索 ---------- */

let searchTimer = null
let searchAbort = null

/* 进入搜索模式：面包屑行切换为输入框 */
export function startSearch() {
  resetSearch()
  state.search.active = true
}

/* 取消搜索：回到目录列表 */
export function endSearch() {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }
  if (searchAbort) {
    searchAbort.abort()
    searchAbort = null
  }
  resetSearch()
}

/* 输入变化：300ms 防抖 + AbortController 取消上一次请求 */
export function onSearchInput(q) {
  state.search.query = q
  if (searchTimer) clearTimeout(searchTimer)
  if (!q.trim()) {
    state.search.results = null
    state.search.truncated = false
    state.search.busy = false
    return
  }
  state.search.busy = true
  searchTimer = setTimeout(() => runSearch(), 300)
}

async function runSearch() {
  searchTimer = null
  const tab = activeTab()
  const q = state.search.query
  if (searchAbort) searchAbort.abort()
  searchAbort = new AbortController()
  const signal = searchAbort.signal
  try {
    const res = await apiSearch(tab.path, q, signal)
    // 已发出更新的请求或已退出搜索模式时丢弃旧结果
    if (!state.search.active || state.search.query !== q) return
    state.search.results = res.hits || []
    state.search.truncated = !!res.truncated
  } catch (err) {
    if (err.name === 'AbortError') return // 被新请求/取消替代
    toast(err.message)
    state.search.results = []
    state.search.truncated = false
  } finally {
    if (searchAbort && searchAbort.signal === signal) {
      searchAbort = null
      if (state.search.query === q) state.search.busy = false
    }
  }
}

/* 点搜索结果：目录直接进入；文件跳到其父目录并短暂高亮该行 */
export async function gotoSearchHit(hit) {
  const tab = activeTab()
  const target = joinPath(tab.path, hit.dir)
  if (hit.isDir) {
    const full = joinPath(target, hit.name)
    endSearch()
    await navigate(full)
    return
  }
  endSearch()
  await navigate(target)
  // 高亮目标行（等待渲染完成）
  setTimeout(() => {
    const rows = document.querySelectorAll('[data-row]')
    for (const el of rows) {
      if (el.dataset.row === hit.name) {
        el.classList.add('row-flash')
        setTimeout(() => el.classList.remove('row-flash'), 1600)
        el.scrollIntoView({ block: 'center' })
        break
      }
    }
  }, 80)
}

/* ---------- 多选 / 剪贴板 ---------- */

export function copySelection() {
  if (state.multi.sel.size === 0) return
  state.clipboard = { mode: 'copy', srcPath: activeTab().path, names: [...state.multi.sel] }
  const n = state.clipboard.names.length
  exitMultiSelect()
  toast('已复制 ' + n + ' 项，请到目标位置粘贴', 'ok')
}

export function cutSelection() {
  if (state.multi.sel.size === 0) return
  if (!ensureUnlocked()) return // T3：剪切会移动文件
  state.clipboard = { mode: 'cut', srcPath: activeTab().path, names: [...state.multi.sel] }
  const n = state.clipboard.names.length
  exitMultiSelect()
  toast('已剪切 ' + n + ' 项，请到目标位置粘贴', 'ok')
}

export function clearClipboard() {
  state.clipboard = null
  toast('已清空剪贴板', 'ok')
}

export async function pasteClipboard() {
  const clip = state.clipboard
  if (!clip) return
  if (!ensureUnlocked()) return // T3：粘贴是写操作
  const tab = activeTab()
  const url = clip.mode === 'copy' ? '/api/copy' : '/api/move'
  try {
    const report = await apiOp(url, {
      srcPath: clip.srcPath,
      names: clip.names,
      destPath: tab.path,
    })
    if (report.failed === 0) {
      toast((clip.mode === 'copy' ? '已粘贴 ' : '已移动 ') + report.success + ' 项', 'ok')
    } else {
      const firstFail = report.results.find((r) => !r.ok)
      toast('成功 ' + report.success + ' 项，失败 ' + report.failed + ' 项：' + (firstFail ? firstFail.error : ''))
    }
    // 移动后清空剪贴板；复制保留可重复粘贴
    if (clip.mode === 'cut') state.clipboard = null
    await refreshActive()
  } catch (err) {
    toast(err.message)
  }
}

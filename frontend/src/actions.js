import { toast } from './toast.js'
import { apiList, apiOp } from './api.js'
import {
  state, activeTab, saveState, newTab, exitMultiSelect,
} from './store.js'

/* 进入新目录：更新 tab 栈 + pushState（Android 返回手势 = 返回上级） */
export async function navigate(path) {
  const tab = activeTab()
  exitMultiSelect()
  try {
    const data = await apiList(path)
    tab.path = data.path || ''
    tab.cache = { path: tab.path, entries: data.entries || [] }
    // 截断前进分支，压入新记录
    tab.history = tab.history.slice(0, tab.histIdx + 1)
    if (tab.history[tab.histIdx] !== tab.path) {
      tab.history.push(tab.path)
      tab.histIdx++
    }
    history.pushState({ tabId: tab.id, path: tab.path }, '')
    saveState()
  } catch (err) {
    toast(err.message)
  }
}

/* 沿 tab 自身历史前进/后退（工具栏 ‹ ›） */
export async function tabGo(delta) {
  const tab = activeTab()
  exitMultiSelect()
  const idx = tab.histIdx + delta
  if (idx < 0 || idx >= tab.history.length) return
  const target = tab.history[idx]
  try {
    const data = await apiList(target)
    tab.histIdx = idx
    tab.path = data.path || target
    tab.cache = { path: tab.path, entries: data.entries || [] }
    history.pushState({ tabId: tab.id, path: tab.path }, '')
    saveState()
  } catch (err) {
    toast(err.message)
  }
}

/* Android 返回手势 / 浏览器后退：恢复对应 tab 的上一路径 */
export function onPopState(ev, restorePath) {
  const s = ev.state
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
    tab.path = data.path || ''
    tab.cache = { path: tab.path, entries: data.entries || [] }
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
    tab.cache = { path: '', entries: data.entries || [] }
  } catch (err) {
    tab.cache = { path: '', entries: [] }
    toast(err.message)
  }
  state.tabs.push(tab)
  state.activeTabId = tab.id
  history.pushState({ tabId: tab.id, path: '' }, '')
  saveState()
}

export function closeTab(id) {
  if (state.tabs.length <= 1) return // 至少保留一个标签
  const idx = state.tabs.findIndex((t) => t.id === id)
  state.tabs.splice(idx, 1)
  if (state.activeTabId === id) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)]
    state.activeTabId = next.id
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
  if (!tab.cache) {
    // 无缓存（恢复后首次切换）才请求
    apiList(tab.path)
      .then((data) => {
        tab.path = data.path || ''
        tab.cache = { path: tab.path, entries: data.entries || [] }
        saveState()
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
    tab.path = data.path || ''
    tab.cache = { path: tab.path, entries: data.entries || [] }
    saveState()
  } catch (err) {
    toast(err.message)
  }
}

/* ---------- 基础操作（新建 / 重命名） ---------- */

export async function doCreate(result) {
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

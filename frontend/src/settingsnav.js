/* 设置页的两级导航。
 *
 * 底部任务栏「设置」→ 设置列表页（view = 'settings', settingsPage = ''）
 *   点某一项 → 打开该设置项的独立页面（settingsPage = 'keyboard'）
 * 每次进入都 pushState，于是安卓返回手势/浏览器后退 = 退回上一级，
 * 从列表页再退 = 回到进入设置前的视图（文件或终端）。
 * 页面内的返回按钮同样走 history，保证与返回手势行为一致。
 *
 * 层级最多两级，用 pushed = 1（列表）/ 2（子页）记录「离设置入口有多远」；
 * 「从设置页直接切到文件/终端」时一次 go(-pushed) 退干净，并把目标视图暂存到
 * pendingView，等 popstate 到达后由 exitSettings 一次性落实。
 * 进入设置前的视图随 history 记录保存（from 字段），刷新后仍能还原。
 */
import { state } from './store.js'

/* 进入设置页之前的视图（'files' | 'term'），退出设置时还原 */
let viewBefore = 'files'

/* 当前压在设置页记录上的层数：0 = 不在设置页，1 = 列表页，2 = 子页 */
let pushed = 0

/* 点底部任务栏直接切走时的目标视图（等待 popstate 落实） */
let pendingView = null

/* 「未保存修改」守卫：由子页注册，返回 false 表示取消返回 */
let guard = null

/* 一次性标记：页面内按钮已过守卫，接下来的 popstate 不再重复询问 */
let guardPassed = false

/* 退出设置页后的收尾回调（App.vue 注入 setView，用于终端惰性建连） */
let exitHook = null

function depthOf(page) {
  return page ? 2 : 1
}

export function setSettingsGuard(fn) {
  guard = fn
}

/* 页面内按钮已经问过守卫并放行；后续那次 history 回退不应再问一遍 */
export function markGuardPassed() {
  guardPassed = true
}

/* 取走一次性「守卫已放行」标记 */
export function takeGuardPassed() {
  const v = guardPassed
  guardPassed = false
  return v
}

export function setSettingsExitHook(fn) {
  exitHook = fn
}

/* 询问是否可以离开设置子页；无守卫或守卫放行时返回 true */
export async function canLeaveSettings() {
  if (!guard) return true
  try {
    return (await guard()) !== false
  } catch {
    return true
  }
}

/* 收尾：出栈完成，切到目标视图（经 exitHook → setView，触发终端惰性建连） */
function finish(view) {
  pushed = 0
  pendingView = null
  guardPassed = false
  state.settingsPage = ''
  viewBefore = view === 'term' ? 'term' : 'files'
  if (exitHook) exitHook(viewBefore)
  else state.view = viewBefore
}

/* 点底部「设置」：不在设置页则进入列表页；已在子页则退回列表页 */
export function enterSettings() {
  if (state.view === 'settings') {
    if (state.settingsPage) backSettings()
    return
  }
  viewBefore = state.view === 'term' ? 'term' : 'files'
  state.view = 'settings'
  state.settingsPage = ''
  pushed = 1
  history.pushState({ settings: '', from: viewBefore }, '')
}

/* 打开某个设置项的独立页面 */
export function openSettingsPage(page) {
  if (state.view === 'settings' && state.settingsPage === page) return
  state.view = 'settings'
  state.settingsPage = page
  pushed = depthOf(page)
  history.pushState({ settings: page, from: viewBefore }, '')
}

/* 返回手势误离子页后，把该页重新压回历史（用于「放弃修改？」被取消时） */
export function reopenSettingsPage(page) {
  state.view = 'settings'
  state.settingsPage = page
  pushed = depthOf(page)
  history.pushState({ settings: page, from: viewBefore }, '')
}

/* 页面内返回按钮：先过守卫，再退一级 */
export async function backSettings() {
  if (!(await canLeaveSettings())) return
  markGuardPassed()
  if (pushed > 0) history.back()
  else finish(viewBefore)
}

/* 从设置页直接切到文件/终端视图：一次退掉所有设置页记录 */
export async function leaveSettings(view) {
  if (!(await canLeaveSettings())) return false
  markGuardPassed()
  pendingView = view === 'term' ? 'term' : 'files'
  viewBefore = pendingView
  if (pushed > 0) history.go(-pushed)
  else finish(pendingView)
  return true
}

/* history.state 是否是一个设置页记录 */
export function isSettingsState(s) {
  return !!s && typeof s.settings === 'string'
}

/* 由 history 记录恢复设置页层级（返回手势命中设置页记录时） */
export function applySettingsState(s) {
  const page = (s && s.settings) || ''
  state.view = 'settings'
  state.settingsPage = page
  pushed = depthOf(page)
}

/* 刷新时停在设置页：还原层级并用 replaceState 写回同一记录（不新增历史） */
export function restoreSettingsState(s) {
  const page = (s && s.settings) || ''
  if (s && typeof s.from === 'string') viewBefore = s.from === 'term' ? 'term' : 'files'
  state.view = 'settings'
  state.settingsPage = page
  pushed = depthOf(page)
  history.replaceState({ settings: page, from: viewBefore }, '')
}

/* 离开设置页：还原视图（此时设置页记录已全部出栈） */
export function exitSettings() {
  finish(pendingView || viewBefore)
}

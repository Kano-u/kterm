/* 内置键盘与系统输入法的切换逻辑。
 *
 * 内置键盘显示时，xterm 的隐藏 textarea 带 inputmode=none，系统键盘不会弹出；
 * 点“输入法”后移除该属性并聚焦 textarea，让系统键盘接管。因为此时内置键盘
 * 会卸载，任务栏会重新出现，所以任务栏上要显示一个“内置键盘”按钮负责切回。
 *
 * 把 DOM 操作集中在这里，键盘组件与任务栏只调用 openIme / openBuiltIn。
 */
import { state } from './store.js'
import { applyInputMode, terminalTextareas, visibleTerminalTextarea } from './inputmode.js'

/* 把“当前是否抑制系统键盘”写进所有终端层的隐藏输入框。
 * 显示内置键盘时全部抑制；系统输入法接管时全部放开（只有可见层能被聚焦）。
 * TerminalView 在层叠切换 / 尺寸变化后调用，避免每个 xterm 各记一份状态。 */
export function syncInputModes(doc = typeof document !== 'undefined' ? document : null) {
  const suppressed = state.mobileKeyboard && state.view === 'term' && !state.imeActive
  for (const ta of terminalTextareas(doc)) applyInputMode(ta, suppressed)
  return suppressed
}

/* 打开系统输入法：清掉内置键盘的抑制，让 xterm textarea 获得焦点。 */
export function openIme(doc = typeof document !== 'undefined' ? document : null, win = typeof window !== 'undefined' ? window : null) {
  state.imeActive = true
  state.keyboardInset = 0
  const ta = visibleTerminalTextarea(doc)
  if (!ta) return false
  applyInputMode(ta, false)
  ta.focus({ preventScroll: true })
  if (win && typeof win.requestAnimationFrame === 'function') {
    win.requestAnimationFrame(() => ta.focus({ preventScroll: true }))
  }
  return true
}

/* 切回内置键盘：重新抑制系统键盘，并把焦点收回到 xterm。 */
export function openBuiltIn(doc = typeof document !== 'undefined' ? document : null, win = typeof window !== 'undefined' ? window : null) {
  const wasImeActive = state.imeActive
  state.imeActive = false
  const ta = visibleTerminalTextarea(doc)
  if (ta) {
    /* 先失焦再改回 inputmode，确保已经弹出的系统键盘真的收起；
     * 单纯把 inputmode 改成 none 在部分 Android 浏览器上不会关闭现用键盘。 */
    if (wasImeActive && typeof ta.blur === 'function') ta.blur()
    applyInputMode(ta, true)
    if (win && typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(() => ta.focus({ preventScroll: true }))
    }
  }
  return true
}

/* 离开终端视图 / 切标签 / 会话结束时的统一收尾：
 * 退出系统输入法、放开所有 textarea 的抑制，避免状态带到下个会话。
 * 内置键盘会因此重新出现（仍在终端视图时），这也正是期望行为。 */
export function resetImeState(doc = typeof document !== 'undefined' ? document : null) {
  if (state.imeActive) {
    const ta = visibleTerminalTextarea(doc)
    if (ta && typeof ta.blur === 'function') ta.blur()
  }
  state.imeActive = false
  return syncInputModes(doc)
}

/* xterm 隐藏 textarea 的输入模式控制。
 *
 * 窄屏内置键盘显示时把 inputmode 设为 none，阻止系统软键盘弹出；
 * 用户点右下角“输入法”后移除该属性，把 textarea 交还给系统输入法。
 *
 * 单独成模块便于纯 node 测试，也避免 KeyboardBar / TerminalView 各自
 * 记住一份 DOM 细节。
 */
export const INPUTMODE_NONE = 'none'
export const TERMINAL_TEXTAREA_SELECTOR = '.xterm textarea'

/* 对某个 textarea 应用或撤销“抑制系统软键盘”。 */
export function applyInputMode(textarea, suppressed) {
  if (!textarea || typeof textarea.setAttribute !== 'function') return
  if (suppressed) textarea.setAttribute('inputmode', INPUTMODE_NONE)
  else if (typeof textarea.removeAttribute === 'function') textarea.removeAttribute('inputmode')
}

/* 元素自身或任一祖先被内联 display:none 隐藏即视为不可见。
 * 各标签的终端层用内联 display 切换（见 TerminalView.showLayer），
 * 所以只查内联样式，不依赖 getComputedStyle（纯 node 测试也能跑）。 */
export function isElementVisible(el) {
  for (let node = el; node; node = node.parentElement) {
    if (node.style && node.style.display === 'none') return false
  }
  return !!el
}

/* 当前文档里所有终端层的隐藏输入框（多标签层叠时输入模式要一起同步）。 */
export function terminalTextareas(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return []
  const list = doc.querySelectorAll(TERMINAL_TEXTAREA_SELECTOR)
  return list ? Array.from(list) : []
}

/* 找到当前可见终端层的隐藏输入框。
 * 隐藏的是整层容器（.xterm 的父元素），不是 .xterm 自身，所以必须向上
 * 逐级检查 display；只看 .xterm 的样式会把后台标签的 textarea 当成可见的。 */
export function visibleTerminalTextarea(doc = typeof document !== 'undefined' ? document : null) {
  return terminalTextareas(doc).find(isElementVisible) || null
}

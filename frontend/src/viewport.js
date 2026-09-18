/* 软键盘检测：判定软键盘是否弹出，并把被遮挡高度写入 store。
 *
 * 两种宿主行为都要兼容：
 *   - interactive-widget=resizes-content（Chrome，index.html 已声明）：
 *     软键盘弹出时 layout viewport 一起缩小，100dvh 变小，底部栏自然被顶到键盘上方；
 *     此时 innerHeight 与 visualViewport.height 同步缩小，inset ≈ 0。
 *   - resizes-visual（Safari 等）：layout 不变，键盘覆盖页面；
 *     此时 inset > 0，系统输入法接管时任务栏据此自行抬高（见 Taskbar）。
 *
 * 同时维护窄屏判定：宽度 ≤768px 且处于终端视图时，内置键盘自动出现（见 keybar.js）。
 *
 * 判定用「当前可见高度比历史最大高度少了多少」：阈值 140px 足以避开地址栏收放抖动。
 */
import { state } from './store.js'
import { resetImeState } from './ime.js'
import { visibleTerminalTextarea } from './inputmode.js'

/* 窄屏阈值与内置键盘显隐共用同一份判定，避免两处 768 漂移。 */
import { isNarrowViewport } from './keybar.js'

const KEYBOARD_MIN_INSET = 140

let baseline = 0 // 历史最大可见高度（键盘收起时的值）
let lastWidth = 0

function update() {
  const vv = window.visualViewport
  const height = vv ? vv.height : window.innerHeight
  const width = vv ? vv.width : window.innerWidth
  /* 内置键盘只在窄屏出现。横向跨过阈值（如手机横屏）时要收起系统输入法：
   * 宽屏没有内置键盘，任务栏上的“内置键盘”入口也不再存在，系统键盘若留着
   * 就没有收回入口。先让 textarea 失焦把系统键盘落回去，再恢复默认输入模式。 */
  const narrow = isNarrowViewport(window)
  const wasImeActive = state.imeActive
  state.mobileKeyboard = narrow
  if (!narrow && wasImeActive) {
    const ta = visibleTerminalTextarea()
    if (ta && typeof ta.blur === 'function') ta.blur()
    resetImeState()
  }
  // 横竖屏切换会大幅改变高度，先重置基准，避免被误判成软键盘
  if (lastWidth && Math.abs(width - lastWidth) > 80) baseline = height
  lastWidth = width
  if (height > baseline) baseline = height
  const hidden = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0
  state.keyboardBar = baseline - height > KEYBOARD_MIN_INSET
  state.keyboardInset = state.keyboardBar && hidden > 60 ? hidden : 0
}

/* 启动监听（App 挂载时调用一次），返回取消函数。 */
export function initViewportWatch() {
  const vv = window.visualViewport
  const target = vv || window
  const onResize = () => update()
  // iOS 键盘弹出时 visual viewport 会滚动，一并监听
  const onScroll = () => update()
  target.addEventListener('resize', onResize)
  target.addEventListener('scroll', onScroll)
  update()
  return () => {
    target.removeEventListener('resize', onResize)
    target.removeEventListener('scroll', onScroll)
  }
}

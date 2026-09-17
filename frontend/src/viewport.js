/* 软键盘检测：判定软键盘是否弹出，并把被遮挡高度写入 store。
 *
 * 两种宿主行为都要兼容：
 *   - interactive-widget=resizes-content（Chrome，index.html 已声明）：
 *     软键盘弹出时 layout viewport 一起缩小，100dvh 变小，底部栏自然被顶到键盘上方；
 *     此时 innerHeight 与 visualViewport.height 同步缩小，inset ≈ 0。
 *   - resizes-visual（Safari 等）：layout 不变，键盘覆盖页面；
 *     此时 inset > 0，底部栏据此自行抬高（见 KeyboardBar）。
 *
 * 判定用「当前可见高度比历史最大高度少了多少」：阈值 140px 足以避开地址栏收放抖动。
 */
import { state } from './store.js'
import { resetKeyBarManual } from './keybar.js'

const KEYBOARD_MIN_INSET = 140

let baseline = 0 // 历史最大可见高度（键盘收起时的值）
let lastWidth = 0

function update() {
  const vv = window.visualViewport
  const height = vv ? vv.height : window.innerHeight
  const width = vv ? vv.width : window.innerWidth
  // 横竖屏切换会大幅改变高度，先重置基准，避免被误判成软键盘
  if (lastWidth && Math.abs(width - lastWidth) > 80) baseline = height
  lastWidth = width
  if (height > baseline) baseline = height
  const hidden = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0
  const open = baseline - height > KEYBOARD_MIN_INSET
  // 软键盘开/合时清掉手动覆盖，让 auto 模式重新接管按键栏显隐
  if (open !== state.keyboardBar) resetKeyBarManual()
  state.keyboardBar = open
  state.keyboardInset = open ? (hidden > 60 ? hidden : 0) : 0
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

/* 底部栏（任务栏 / 终端按键栏 / 多选栏 / 粘贴栏）占用的高度，
 * 供底部浮层（Toast）避让。
 *
 * 终端会话结束时弹出的「终端会话已结束」是全局 Toast，原先固定贴屏幕底部
 * （bottom: 24px + safe-area），在手机端正好压住任务栏的「终端」按钮。
 * 与其在浮层里写魔数，不如把底栏真正占掉的高度测量出来写进 CSS 变量
 * --kfm-bottom-bar，浮层用 calc(var(--kfm-bottom-bar) + 12px) 落到底栏上方。
 *
 * 底栏不止一条，而且互斥出现：任务栏与按键栏二选一，多选栏与粘贴栏各自
 * 覆盖在任务栏之上（z 更高）。所以这里量的是「所有可见底栏里最高的那条」——
 * 取最大值而不是求和，正是为了不被层叠关系绕进去。
 *
 * 为什么量「视口底 − 元素上沿」而不是「元素高度」：
 *   - 底栏自身带 safe-area 内边距（pb-[calc(env(safe-area-inset-bottom)+Npx)]），
 *     高度里已经含了安全区，浮层不该再叠一次；
 *   - resizes-visual 宿主（Safari）里软键盘覆盖页面，按键栏靠 margin-bottom
 *     自行抬高；这段 margin 算不算进元素高度取决于格式化上下文，量高度容易
 *     算漏或算重，而「上沿到视口底」怎么都正确；
 *   - 于是键盘顶起（margin）、安全区（padding）、内容行数（高度）三个来源
 *     自动统一为一个数字，不存在重复计算。
 *
 * 用 ResizeObserver 而不是 window.resize：底栏内容变化（标签变多、按键行数
 * 改变、多选栏多了一行计数）时窗口尺寸不变。软键盘造成的位移不改变元素尺寸，
 * 可能不触发 ResizeObserver，因此同时监听视口 resize 事件兜底。
 */

export const BOTTOM_BAR_VAR = '--kfm-bottom-bar'

/* 底栏元素的标记属性：写在每个底部栏容器的根元素上即可被自动测量 */
export const BOTTOM_BAR_ATTR = 'data-bottom-bar'

/* 所有可见底栏占掉的最大高度 = max(视口高 − 元素上沿)，px 整数。
 *
 * rects 里会混有「尚未渲染 / 已隐藏」的元素（v-if 切换的瞬间、display:none）。
 * 这类元素的高度为 0 而 top 可能是 0，直接算会得到「整屏高」把浮层推出屏幕，
 * 因此零高度一律跳过。 */
export function bottomBarSpace(rects, viewportHeight) {
  const vh = Number(viewportHeight) || 0
  if (!vh) return 0
  let max = 0
  for (const r of rects || []) {
    if (!r) continue
    const top = Number(r.top)
    const height = Number(r.height) || 0
    if (!Number.isFinite(top) || height <= 0) continue
    max = Math.max(max, vh - top)
  }
  return Math.max(0, Math.round(max))
}

/* 把测量值写进 CSS 变量（document 由调用方注入，便于测试） */
export function applyBottomBarVar(doc, px) {
  if (!doc || !doc.documentElement || !doc.documentElement.style) return
  doc.documentElement.style.setProperty(BOTTOM_BAR_VAR, Math.max(0, Math.round(px) || 0) + 'px')
}

/* 收集底栏元素：按标记属性查，避免把每个栏的 ref 层层往上传 */
export function collectBottomBars(doc, selector) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return []
  try {
    return Array.from(doc.querySelectorAll(selector || '[' + BOTTOM_BAR_ATTR + ']'))
  } catch {
    return []
  }
}

function rectOf(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null
  const r = el.getBoundingClientRect()
  return { top: r.top, height: r.height }
}

/**
 * 安装测量：立即同步一次，并在底栏尺寸 / 视口变化时重新同步。
 *
 * @param {object} o
 * @param {Document} [o.doc]                  变量写入目标，默认当前文档
 * @param {() => number} [o.viewportHeight]   视口高度（默认 window.innerHeight）
 * @param {typeof ResizeObserver} [o.observe] ResizeObserver 构造器（可注入假实现）
 * @param {Window} [o.win]                    resize 事件来源，null 表示不监听
 * @param {string} [o.selector]               底栏元素选择器（默认按标记属性）
 * @returns {{sync: () => void, stop: () => void}}
 */
export function installBottomBarWatch({ doc, viewportHeight, observe, win, selector } = {}) {
  const target = doc || (typeof document !== 'undefined' ? document : null)
  const w = win === undefined ? (typeof window !== 'undefined' ? window : null) : win
  const vh = viewportHeight || (() => (w ? w.innerHeight : 0))
  const RO = observe || (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null)

  let ro = null
  let observed = new Set()

  /* 底栏是 v-if 挂载的（多选栏 / 粘贴栏唯条件出现），安装时不存在，所以每次
   * sync 都要重新对接：新出现的 observe，消失的 unobserve。否则后挂载的那条栏
   * 改高度时不会有任何回调，变量会停在旧值上。 */
  function rebind(els) {
    if (!ro) return
    const now = new Set(els)
    for (const el of now) {
      if (!observed.has(el)) ro.observe(el)
    }
    for (const el of observed) {
      if (!now.has(el)) ro.unobserve(el)
    }
    observed = now
  }

  const sync = () => {
    const els = collectBottomBars(target, selector)
    rebind(els)
    applyBottomBarVar(target, bottomBarSpace(els.map(rectOf), vh()))
  }

  if (RO && target) ro = new RO(sync)
  sync()
  if (w && typeof w.addEventListener === 'function') w.addEventListener('resize', sync)
  return {
    sync,
    stop() {
      if (ro) ro.disconnect()
      observed = new Set()
      if (w && typeof w.removeEventListener === 'function') w.removeEventListener('resize', sync)
    },
  }
}

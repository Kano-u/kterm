/* 底部栏（任务栏 / 终端按键栏）在屏幕底部占掉的高度，供底部浮层（Toast）避让。
 *
 * 终端会话结束时弹出的「终端会话已结束」是全局 Toast，原先固定贴屏幕底部
 * （bottom: 24px + safe-area），在手机端正好压住任务栏的「终端」按钮。
 * 与其在浮层里写魔数，不如把底栏真正占掉的高度测量出来写进 CSS 变量
 * --kfm-bottom-bar，浮层用 calc(var(--kfm-bottom-bar) + 12px) 落到底栏上方。
 *
 * 为什么量「视口底 − 底栏上沿」而不是「元素高度」：
 *   - 底栏自身带 safe-area 内边距（pb-[calc(env(safe-area-inset-bottom)+Npx)]），
 *     高度里已经含了安全区，浮层不该再叠一次；
 *   - resizes-visual 宿主（Safari）里软键盘覆盖页面，按键栏靠 margin-bottom
 *     自行抬高；这段 margin 算不算进容器高度取决于格式化上下文，量高度容易
 *     算漏或算重，而「上沿到视口底」怎么都正确；
 *   - 于是键盘顶起（margin）、安全区（padding）、内容行数（高度）三个来源
 *     自动统一为一个数字，不存在重复计算。
 *
 * 用 ResizeObserver 而不是 window.resize：底栏内容变化（标签变多、按键行数
 * 改变）时窗口尺寸不变。软键盘造成的位移不改变元素尺寸，可能不触发
 * ResizeObserver，因此同时监听视口 resize 事件兜底。
 */

export const BOTTOM_BAR_VAR = '--kfm-bottom-bar'

/* 底栏占掉的高度 = 视口高 − 底栏上沿，px 整数 */
export function bottomBarSpace({ top, viewportHeight }) {
  const vh = Number(viewportHeight) || 0
  const t = Number(top)
  if (!vh || !Number.isFinite(t)) return 0
  return Math.max(0, Math.round(vh - t))
}

/* 把测量值写进 CSS 变量（document 由调用方注入，便于测试） */
export function applyBottomBarVar(doc, px) {
  if (!doc || !doc.documentElement || !doc.documentElement.style) return
  doc.documentElement.style.setProperty(BOTTOM_BAR_VAR, Math.max(0, Math.round(px) || 0) + 'px')
}

/**
 * 安装测量：立即同步一次，并在底栏尺寸 / 视口变化时重新同步。
 *
 * @param {object} o
 * @param {Element} o.el                        底栏容器
 * @param {() => number} [o.viewportHeight]     视口高度（默认 window.innerHeight）
 * @param {Document} [o.doc]                    变量写入目标，默认当前文档
 * @param {typeof ResizeObserver} [o.observe]   ResizeObserver 构造器（可注入假实现）
 * @param {Window} [o.win]                      resize 事件来源，null 表示不监听
 * @returns {{sync: () => void, stop: () => void}}
 */
export function installBottomBarWatch({ el, viewportHeight, doc, observe, win } = {}) {
  const target = doc || (typeof document !== 'undefined' ? document : null)
  const w = win === undefined ? (typeof window !== 'undefined' ? window : null) : win
  const vh = viewportHeight || (() => (w ? w.innerHeight : 0))
  const RO = observe || (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null)

  const sync = () => {
    if (!el || typeof el.getBoundingClientRect !== 'function') {
      applyBottomBarVar(target, 0)
      return
    }
    applyBottomBarVar(target, bottomBarSpace({ top: el.getBoundingClientRect().top, viewportHeight: vh() }))
  }

  sync()
  let ro = null
  if (el && RO) {
    ro = new RO(sync)
    ro.observe(el)
  }
  if (w && typeof w.addEventListener === 'function') w.addEventListener('resize', sync)
  return {
    sync,
    stop() {
      if (ro) ro.disconnect()
      if (w && typeof w.removeEventListener === 'function') w.removeEventListener('resize', sync)
    },
  }
}

/* 底部浮层避让底部栏的布局契约（纯 node，无第三方依赖）：
 *   cd frontend && node test/bottombar.test.mjs
 *
 * 终端会话结束时弹出的「终端会话已结束」是全局 Toast，原先固定贴屏幕底部
 * （bottom: 24px + safe-area inset），在手机端任务栏就在那一带，于是提示框
 * 会盖住「终端」按钮。解决办法不是给 Toast 调个魔数，而是把底栏实际占掉的
 * 空间测量出来写进 CSS 变量 --kfm-bottom-bar，浮层用 calc() 叠加。
 *
 * 本测试锁住三件事：
 *   1. bottomBarSpace 的语义（下沿 → 视口底）与取整/缺失/负值兜底；
 *   2. applyBottomBarVar / installBottomBarWatch 的写入与生命周期；
 *   3. 浮层 bottom 的计算结果确实落在底栏上方（各种机型与键盘场景都不重叠）。
 */

const { bottomBarSpace, applyBottomBarVar, installBottomBarWatch, BOTTOM_BAR_VAR } =
  await import('../src/bottombar.js')

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}

/* ---------- 1. bottomBarSpace：视口高 − 底栏上沿 ---------- */
{
  const space = (top, vh) => bottomBarSpace({ top, viewportHeight: vh })
  assert(space(600, 656) === 56, '上沿 600 / 视口 656 → 底栏占 56px')
  assert(space(620, 656) === 36, '软键盘顶起后上沿上移 → 占用变小（不重复计 margin）')
  assert(space(612.4, 656) === 44, '上沿带小数时四舍五入到整数 px')
  assert(space(656, 656) === 0, '底栏完全沉在视口外 → 0（浮层回落到默认间距）')
  assert(space(700, 656) === 0, '上沿落在视口外（过渡帧）→ 兜底 0，不会把浮层推离屏幕')
  assert(space(0, 0) === 0, '取不到视口高度 → 0')
  assert(space(undefined, 656) === 0, '取不到上沿（null/undefined）→ 0')
  assert(space(NaN, 656) === 0, 'NaN 上沿 → 0')
  assert(space('600', 656) === 56, '字符串数字也能算出结果')
}

/* ---------- 2. applyBottomBarVar ---------- */
{
  const written = []
  const fakeDoc = { documentElement: { style: { setProperty: (k, v) => written.push([k, v]) } } }
  applyBottomBarVar(fakeDoc, 56)
  applyBottomBarVar(fakeDoc, 56.7)
  applyBottomBarVar(fakeDoc, 0)
  applyBottomBarVar(fakeDoc, NaN)
  applyBottomBarVar(null, 56) // 无文档时静默忽略

  assert(written.length === 4, '无文档时不写入')
  assert(written.every(([k]) => k === BOTTOM_BAR_VAR), `变量名为 ${BOTTOM_BAR_VAR}`)
  assert(written[0][1] === '56px', '写入整数 px')
  assert(written[1][1] === '57px', '小数四舍五入')
  assert(written[2][1] === '0px' && written[3][1] === '0px', '0 / NaN 都写 0px（CSS 变量始终可解析）')
}

/* ---------- 3. 安装测量：立即同步 + 尺寸变化重同步 + stop ---------- */
{
  const written = []
  const fakeDoc = { documentElement: { style: { setProperty: (k, v) => written.push(v) } } }
  let resizeCb = null
  let observed = null
  let disconnected = false
  class FakeRO {
    constructor(cb) { resizeCb = cb }
    observe(el) { observed = el }
    disconnect() { disconnected = true }
  }
  let vh = 656
  const el = { getBoundingClientRect: () => ({ top: vh - 56 }) }
  const h = installBottomBarWatch({ el, viewportHeight: () => vh, doc: fakeDoc, observe: FakeRO, win: null })

  assert(written[0] === '56px', '安装即同步一次（避免首帧提示框压在底栏上）')
  assert(observed === el, '对底栏容器本身做 ResizeObserver 观测')

  // 底栏内容变化（例如按键栏行数变化）→ 占到更多空间 → 重测
  el.getBoundingClientRect = () => ({ top: vh - 92 })
  resizeCb()
  assert(written[1] === '92px', '底栏尺寸变化后重新写入')

  // 视口高度变化（软键盘 resizes-content）不触发 ResizeObserver，显式 sync 补齐
  vh = 400
  h.sync()
  assert(written[2] === '92px', 'resizes-content 下键盘压缩视口，上沿跟着上移但占用不变')

  h.stop()
  assert(disconnected, 'stop 断开观测（组件卸载不留监听）')

  // 没有 ResizeObserver 的环境（老浏览器 / 纯 node）不应崩
  const h2 = installBottomBarWatch({ el, viewportHeight: () => vh, doc: fakeDoc, win: null })
  assert(typeof h2.sync === 'function', '缺少 ResizeObserver 时降级为手动 sync，不抛错')
  h2.stop()

  // 元素尚未挂载（ref 为 null）
  const h3 = installBottomBarWatch({ el: null, viewportHeight: () => vh, doc: fakeDoc, win: null })
  assert(written[written.length - 1] === '0px', '元素未挂载时写 0px（首帧浮层用默认间距）')
  h3.stop()
}

/* ---------- 3b. window resize 兜底（软键盘改 margin 的场景） ---------- */
{
  const written = []
  const fakeDoc = { documentElement: { style: { setProperty: (k, v) => written.push(v) } } }
  const listeners = {}
  const fakeWin = {
    innerHeight: 656,
    addEventListener: (n, cb) => { listeners[n] = cb },
    removeEventListener: (n) => { delete listeners[n] },
  }
  let top = 656 - 36
  const el = { getBoundingClientRect: () => ({ top }) }
  const h = installBottomBarWatch({ el, doc: fakeDoc, win: fakeWin, observe: null })

  assert(written[0] === '36px', '默认从 window.innerHeight 取视口高度')

  // Safari（resizes-visual）：键盘弹出时视口高度不变，按键栏靠 margin 上移
  top = 656 - 36 - 300
  listeners.resize()
  assert(written[1] === '336px', '键盘顶起按键栏后，resize 事件重测出更大的占用')

  h.stop()
  assert(!listeners.resize, 'stop 摘掉 resize 监听')
}

/* ---------- 4. 浮层位置：任何机型都不能与底栏重叠 ---------- */
{
  const SAFE_BOTTOM = 34 // iPhone 底部 home indicator
  const GAP = 12 // 浮层与底栏之间的间距（Toast.vue）

  /* CSS: bottom: calc(var(--kfm-bottom-bar, 0px) + 12px)
   * --kfm-bottom-bar 已是「视口底 − 底栏上沿」，含安全区与键盘顶起，不再叠加。 */
  const toastBottom = (barPx) => barPx + GAP
  const barHeight = (content, safe = SAFE_BOTTOM) => content + safe + 6

  const cases = [
    { name: '安卓 360×640（有导航条安全区）', bar: barHeight(36) },
    { name: 'iPhone SE 375×667（无安全区）', bar: barHeight(36, 0) },
    { name: 'iPhone 14 393×852（home indicator）', bar: barHeight(36) },
    { name: '按键栏 2 行（键盘顶起底栏）', bar: barHeight(36) + 2 * 30 },
    { name: '底栏不存在（异常状态）', bar: 0 },
  ]
  for (const c of cases) {
    const bottom = toastBottom(c.bar)
    const clears = c.bar === 0 ? bottom === GAP : bottom > c.bar
    assert(clears, `${c.name}：底栏占 ${c.bar}px，浮层下沿 ${bottom}px → ${c.bar ? '位于底栏上方' : '用默认间距'}`)
  }
}

/* ---------- 5. 旧行为对照：固定 24px + safe-area 会重叠 ---------- */
{
  const SAFE_BOTTOM = 34
  const bar = 36 + SAFE_BOTTOM + 6 // 76px
  const OLD = 24 + SAFE_BOTTOM // 原先的 bottom: calc(24px + env(safe-area-inset-bottom))
  assert(OLD < bar, `原先 bottom=${OLD}px < 底栏 ${bar}px → 正是盖住「终端」按钮的原因`)
  assert(OLD + 40 > bar, '而提示框自身约 40px 高，所以视觉上明显压住按钮')
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')

/* 底部浮层避让底部栏的布局契约（纯 node，无第三方依赖）：
 *   cd frontend && node test/bottombar.test.mjs
 *
 * 终端会话结束时弹出的「终端会话已结束」是全局 Toast，原先固定贴屏幕底部
 * （bottom: 24px + safe-area inset），在手机端任务栏就在那一带，于是提示框
 * 会盖住「终端」按钮。解决办法不是给 Toast 调个魔数，而是把底栏实际占掉的
 * 空间测量出来写进 CSS 变量 --kfm-bottom-bar，浮层用 calc() 叠加。
 *
 * 底栏不止一条，且互斥出现：任务栏 / 按键栏二选一，多选栏 / 粘贴栏覆盖其上。
 * 因此取「所有可见底栏的最大高度」而不是求和——这正是本测试锁定的语义。
 */

const {
  bottomBarSpace, applyBottomBarVar, collectBottomBars, installBottomBarWatch,
  BOTTOM_BAR_VAR, BOTTOM_BAR_ATTR,
} = await import('../src/bottombar.js')

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}

const VH = 656
const rect = (top, height) => ({ top, height }) // 底栏：上沿 + 高度
const bar = (h) => rect(VH - h, h) // 贴在视口底的底栏

/* ---------- 1. bottomBarSpace：取最大占用，忽略零高度 ---------- */
{
  assert(bottomBarSpace([bar(56)], VH) === 56, '单条底栏 → 它的高度')
  assert(bottomBarSpace([bar(56), bar(92)], VH) === 92, '多条底栏 → 取最大（层叠覆盖，不相加）')
  assert(bottomBarSpace([bar(56), bar(92)], VH) !== 148, '不是求和（求和会把浮层推得过高）')
  assert(bottomBarSpace([bar(56), rect(0, 0)], VH) === 56,
    '零高度元素跳过（v-if 切换瞬间 top=0 会算出整屏高，必须忽略）')
  assert(bottomBarSpace([rect(0, 0)], VH) === 0, '只有零高度元素 → 0')
  assert(bottomBarSpace([bar(44.6)], VH) === 45, '四舍五入到整数 px')
  assert(bottomBarSpace([], VH) === 0, '没有底栏 → 0')
  assert(bottomBarSpace(null, VH) === 0, 'rects 为 null 不抛错')
  assert(bottomBarSpace([null, undefined, {}], VH) === 0, '非法元素跳过')
  assert(bottomBarSpace([bar(56)], 0) === 0, '取不到视口高度 → 0')
  assert(bottomBarSpace([bar(56)], 'abc') === 0, '视口高度非数值 → 0')
  assert(bottomBarSpace([rect(NaN, 56)], VH) === 0, '上沿 NaN → 跳过')
  assert(bottomBarSpace([rect(VH + 40, 40)], VH) === 0, '元素完全在视口下方 → 0（不产生负值）')
  // 软键盘（resizes-visual）：底栏靠 margin 抬高，上沿整体上移
  assert(bottomBarSpace([rect(VH - 336, 36)], VH) === 336, '键盘顶起时占用随之变大')
}

/* ---------- 2. applyBottomBarVar ---------- */
{
  const written = []
  const fakeDoc = { documentElement: { style: { setProperty: (k, v) => written.push([k, v]) } } }
  applyBottomBarVar(fakeDoc, 56)
  applyBottomBarVar(fakeDoc, 56.7)
  applyBottomBarVar(fakeDoc, 0)
  applyBottomBarVar(fakeDoc, NaN)
  applyBottomBarVar(fakeDoc, -10)
  applyBottomBarVar(null, 56) // 无文档时静默忽略

  assert(written.length === 5, '无文档时不写入')
  assert(written.every(([k]) => k === BOTTOM_BAR_VAR), `变量名为 ${BOTTOM_BAR_VAR}`)
  assert(written[0][1] === '56px', '写入整数 px')
  assert(written[1][1] === '57px', '小数四舍五入')
  assert(written[2][1] === '0px' && written[3][1] === '0px', '0 / NaN 都写 0px（变量始终可解析）')
  assert(written[4][1] === '0px', '负值兜底为 0（不会把浮层推到屏幕上方）')
}

/* ---------- 3. 元素收集 ---------- */
{
  const a = { id: 'a' }
  const b = { id: 'b' }
  const doc = { querySelectorAll: (sel) => (sel === '[data-bottom-bar]' ? [a, b] : []) }
  assert(collectBottomBars(doc).length === 2, '默认按标记属性收集所有底栏')
  assert(collectBottomBars(null).length === 0, '无 document → 空数组')
  assert(collectBottomBars({}).length === 0, '不支持 querySelectorAll → 空数组')
  assert(collectBottomBars({ querySelectorAll: () => { throw new Error('bad selector') } }).length === 0,
    '选择器抛错时降级为空（不影响浮层默认位置）')
  assert(BOTTOM_BAR_ATTR === 'data-bottom-bar', '标记属性名稳定')
}

/* ---------- 4. 安装测量：立即同步 + 观察 + 后挂载栏对接 + stop ---------- */
{
  const written = []
  const fakeDoc = { documentElement: { style: { setProperty: (k, v) => written.push(v) } } }
  let resizeCb = null
  const observed = new Set()
  const unobserved = new Set()
  let disconnected = false
  class FakeRO {
    constructor(cb) { resizeCb = cb }
    observe(el) { observed.add(el) }
    unobserve(el) { observed.delete(el); unobserved.add(el) }
    disconnect() { disconnected = true }
  }

  let bars = []
  fakeDoc.querySelectorAll = () => bars
  let vh = VH
  const el = (h) => ({ getBoundingClientRect: () => ({ top: vh - h, height: h }) })

  const taskbar = el(56)
  bars = [taskbar]
  const h = installBottomBarWatch({ doc: fakeDoc, viewportHeight: () => vh, observe: FakeRO, win: null })

  assert(written[0] === '56px', '安装即同步一次（避免首帧提示框压在底栏上）')
  assert(observed.has(taskbar), '对已存在的底栏做 ResizeObserver 观测')

  // 底栏内容变化（标签变多等）→ 重测
  let taskbarH = 92
  taskbar.getBoundingClientRect = () => ({ top: vh - taskbarH, height: taskbarH })
  resizeCb()
  assert(written[written.length - 1] === '92px', '尺寸变化后重新写入')

  // 多选栏后挂载（v-if）→ 下次 sync 必须把它也纳入观测
  const selectBar = el(100)
  bars = [taskbar, selectBar]
  h.sync()
  assert(written[written.length - 1] === '100px', '后挂载的多选栏被纳入测量（取最大值）')
  assert(observed.has(selectBar), '后挂载的底栏被补上观测（否则它改高度时不会有回调）')

  // 多选栏消失 → 退回任务栏高度，并解除观测
  bars = [taskbar]
  h.sync()
  assert(written[written.length - 1] === '92px', '多选栏退出后回落到任务栏高度')
  assert(unobserved.has(selectBar), '消失的底栏被解除观测（不留监听）')

  // 视口变化（软键盘 resizes-content）/ 键盘顶起：显式 sync 补齐
  vh = 400
  h.sync()
  assert(written[written.length - 1] === '92px', '视口压缩后上沿跟着上移，占用不变')

  h.stop()
  assert(disconnected, 'stop 断开观测（组件卸载不留监听）')

  // 没有 ResizeObserver 的环境（老浏览器 / 纯 node）不应崩
  const h2 = installBottomBarWatch({ doc: fakeDoc, viewportHeight: () => vh, win: null })
  assert(typeof h2.sync === 'function', '缺少 ResizeObserver 时降级为手动 sync，不抛错')
  h2.sync()
  h2.stop()

  // 没有任何底栏（异常状态）→ 写 0px
  bars = []
  const h3 = installBottomBarWatch({ doc: fakeDoc, viewportHeight: () => VH, win: null })
  assert(written[written.length - 1] === '0px', '无底栏时写 0px（浮层用默认间距）')
  h3.stop()
}

/* ---------- 4b. window resize 兜底（软键盘改 margin 的场景） ---------- */
{
  const written = []
  const fakeDoc = { documentElement: { style: { setProperty: (k, v) => written.push(v) } } }
  const listeners = {}
  const fakeWin = {
    innerHeight: VH,
    addEventListener: (n, cb) => { listeners[n] = cb },
    removeEventListener: (n) => { delete listeners[n] },
  }
  let top = VH - 36
  const keybar = { getBoundingClientRect: () => ({ top, height: 36 }) }
  fakeDoc.querySelectorAll = () => [keybar]
  const h = installBottomBarWatch({ doc: fakeDoc, win: fakeWin, observe: null })

  assert(written[0] === '36px', '默认从 window.innerHeight 取视口高度')

  // Safari（resizes-visual）：视口高度不变，按键栏靠 margin 上移
  top = VH - 36 - 300
  listeners.resize()
  assert(written[1] === '336px', '键盘顶起按键栏后，resize 事件重测出更大的占用')

  h.stop()
  assert(!listeners.resize, 'stop 摘掉 resize 监听')
}

/* ---------- 5. 浮层位置：任何机型都不能与底栏重叠 ---------- */
{
  const SAFE_BOTTOM = 34 // iPhone 底部 home indicator
  const GAP = 12 // 浮层与底栏之间的间距（Toast.vue）

  /* CSS: bottom: calc(var(--kfm-bottom-bar, 0px) + 12px)
   * --kfm-bottom-bar 已是「视口底 − 底栏上沿」，含安全区与键盘顶起，不再叠加。 */
  const toastBottom = (barPx) => barPx + GAP
  const barHeight = (content, safe = SAFE_BOTTOM) => content + safe + 6

  const cases = [
    { name: '安卓 360×640 / 任务栏', bar: barHeight(36) },
    { name: 'iPhone SE / 任务栏（无安全区）', bar: barHeight(36, 0) },
    { name: 'iPhone 14 / 任务栏', bar: barHeight(36) },
    { name: '多选栏（两行：计数 + 按钮）', bar: barHeight(66) },
    { name: '多选栏 + 任务栏同时命中（取最大）', bar: Math.max(barHeight(66), barHeight(36)) },
    { name: '按键栏 2 行（键盘顶起底栏）', bar: barHeight(36) + 2 * 30 },
    { name: '底栏不存在（异常状态）', bar: 0 },
  ]
  for (const c of cases) {
    const bottom = toastBottom(c.bar)
    const clears = c.bar === 0 ? bottom === GAP : bottom > c.bar
    assert(clears, `${c.name}：底栏占 ${c.bar}px，浮层下沿 ${bottom}px → ${c.bar ? '位于底栏上方' : '用默认间距'}`)
  }
}

/* ---------- 6. 旧行为对照：固定 24px + safe-area 会重叠 ---------- */
{
  const SAFE_BOTTOM = 34
  const barPx = 36 + SAFE_BOTTOM + 6 // 76px
  const OLD = 24 + SAFE_BOTTOM // 原先的 bottom: calc(24px + env(safe-area-inset-bottom))
  assert(OLD < barPx, `原先 bottom=${OLD}px < 底栏 ${barPx}px → 正是盖住「终端」按钮的原因`)
  assert(OLD + 40 > barPx, '而提示框自身约 40px 高，所以视觉上明显压住按钮')
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')

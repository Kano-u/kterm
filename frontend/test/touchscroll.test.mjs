/* 终端触摸滚动的无依赖回归测试（纯 node，无第三方依赖）：
 *   cd frontend && node test/touchscroll.test.mjs
 *
 * 覆盖：
 *   1. 纯函数 dragToLines：像素→行数、余量结转、上下对称；
 *   2. decayVelocity：衰减与停止阈值；
 *   3. cellHeightOf：实测优先、渲染未就绪时按字号估算；
 *   4. attachTouchScroll：轻点不劫持、纵向拖动滚动、横向滑动放弃、
 *      多指放行、惯性滑行与松手前静止不计惯性、dispose 后不再响应。
 */

const { dragToLines, decayVelocity, cellHeightOf, attachTouchScroll, FRICTION, MIN_VELOCITY } =
  await import('../src/touchscroll.js')

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

/* ---------- 1. dragToLines ---------- */
{
  let r = dragToLines(20, 20)
  assert(r.lines === 1 && r.carry === 0, '整格位移 → 1 行、无余量')

  r = dragToLines(10, 20)
  assert(r.lines === 0 && r.carry === 10, '半格位移 → 0 行、余量 10px 结转')

  // 余量结转后凑够一格
  r = dragToLines(10, 20, r.carry)
  assert(r.lines === 1 && r.carry === 0, '余量累加凑满 → 1 行、余量清零')

  r = dragToLines(-10, 20)
  assert(r.lines === 0 && r.carry === -10, '向上半格 → 余量 -10px')

  r = dragToLines(-10, 20, r.carry)
  assert(r.lines === -1 && r.carry === 0, '向上滚动与向下对称（trunc 而非 floor）')

  r = dragToLines(5, 0)
  assert(Number.isFinite(r.lines) && Number.isFinite(r.carry), 'cellHeight 为 0 时不产生 NaN')

  r = dragToLines(0, 20, 7)
  assert(r.lines === 0 && r.carry === 7, '零位移保留余量')
}

/* ---------- 2. decayVelocity ---------- */
{
  assert(near(decayVelocity(1), FRICTION), `衰减系数 ${FRICTION}`)
  assert(decayVelocity(MIN_VELOCITY / 2) === 0, '低于阈值归零（停止惯性）')
  assert(decayVelocity(-MIN_VELOCITY / 2) === 0, '反向同样归零')
  const v1 = decayVelocity(1)
  assert(Math.abs(decayVelocity(v1)) < Math.abs(v1), '速度单调递减')
}

/* ---------- 3. cellHeightOf ---------- */
{
  const el = { querySelector: (sel) => (sel === '.xterm-screen' ? { clientHeight: 260 } : null) }
  assert(cellHeightOf(el, 20) === 13, '实测高度 / 行数 = 单元格高度')

  const blank = { querySelector: () => ({ clientHeight: 0 }) }
  assert(cellHeightOf(blank, 20, 13) === 15.6, '渲染未就绪 → 按字号 * 1.2 估算')

  assert(cellHeightOf(null, 20, 13) === 15.6, '元素缺失时走估算，不抛错')
  assert(cellHeightOf(el, 0, 13) === 15.6, '行数为 0 时走估算，避免除零')
}

/* ---------- 触摸事件模拟 ---------- */
class FakeEl {
  constructor() {
    this.style = { display: 'block' }
    this.handlers = new Map()
    this._q = { '.xterm-screen': { clientHeight: 200 }, '.scrollbar': null }
  }
  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type).add(fn)
  }
  removeEventListener(type, fn) {
    this.handlers.get(type)?.delete(fn)
  }
  querySelector(sel) {
    return this._q[sel] ?? null
  }
  dispatch(type, ev) {
    const e = { type, cancelable: true, defaultPrevented: false, ...ev }
    e.preventDefault = () => { e.defaultPrevented = true }
    for (const fn of [...(this.handlers.get(type) || [])]) fn(e)
    return e
  }
  listenerCount() {
    let n = 0
    for (const s of this.handlers.values()) n += s.size
    return n
  }
}

class FakeTerm {
  constructor(rows = 10, fontSize = 13) {
    // 单元格高度 = 200 / 10 = 20px
    this.rows = rows
    this.options = { fontSize }
    this.scrolled = 0
    this.calls = 0
    this.focused = 0
  }
  scrollLines(n) {
    this.scrolled += n
    this.calls++
  }
  focus() {
    this.focused++
  }
}

/* 可控时钟 + 手动 rAF：raf 回调被收集，由测试逐帧驱动 */
function harness(rows = 10) {
  let clock = 1000
  const frames = new Map()
  let nextId = 1
  const el = new FakeEl()
  const term = new FakeTerm(rows)
  const detach = attachTouchScroll(el, term, {
    now: () => clock,
    raf: (fn) => {
      const id = nextId++
      frames.set(id, fn)
      return id
    },
    caf: (id) => frames.delete(id),
  })
  return {
    el,
    term,
    detach,
    setClock: (v) => { clock = v },
    advance: (ms) => { clock += ms },
    pending: () => frames.size,
    /* 跑一帧，并把时钟推进 dt */
    frame(dt = 16) {
      clock += dt
      const batch = [...frames.entries()]
      frames.clear()
      for (const [, fn] of batch) fn(clock)
    },
  }
}

const touch = (identifier, x, y) => ({ identifier, clientX: x, clientY: y })

/* ---------- 4. 轻点：不劫持，交给 xterm ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 100)], changedTouches: [touch(1, 100, 100)] })
  h.el.dispatch('touchend', { touches: [], changedTouches: [touch(1, 101, 102)] })
  assert(h.term.calls === 0, '轻点不滚动')
  assert(h.pending() === 0, '轻点不启动惯性')
  assert(h.term.focused === 0, '轻点不自行 focus（交给 xterm 原生处理）')
}

/* ---------- 5. 向上拖动（手指上滑）→ 滚动到后面的内容（正数行） ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 200)], changedTouches: [touch(1, 100, 200)] })
  // 越过 slop，先消化 60px（3 行）
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 140)], changedTouches: [touch(1, 100, 140)] })
  assert(h.term.scrolled === 3, '手指上滑 60px → 向下滚 3 行（看后面的内容）')

  h.el.dispatch('touchmove', { touches: [touch(1, 100, 100)], changedTouches: [touch(1, 100, 100)] })
  assert(h.term.scrolled === 5, '继续上滑 40px → 累计 5 行')
}

/* ---------- 6. 向下拖动（手指下滑）→ 回看历史（负数行） ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 100)], changedTouches: [touch(1, 100, 100)] })
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 180)], changedTouches: [touch(1, 100, 180)] })
  assert(h.term.scrolled === -4, '手指下滑 80px → 向上滚 4 行（看历史）')
}

/* ---------- 7. 余量结转：小步拖动不会丢失位移 ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 300)], changedTouches: [touch(1, 100, 300)] })
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 285)], changedTouches: [touch(1, 100, 285)] }) // 15px < 20px
  assert(h.term.calls === 0, '单次不足一格 → 不滚动，余量保留')
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 270)], changedTouches: [touch(1, 100, 270)] }) // 累计 30px
  assert(h.term.scrolled === 1, '余量结转后凑满一格 → 滚 1 行')
}

/* ---------- 8. 横向滑动：放弃手势，不滚动、不给惯性 ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 100)], changedTouches: [touch(1, 100, 100)] })
  h.el.dispatch('touchmove', { touches: [touch(1, 300, 110)], changedTouches: [touch(1, 300, 110)] })
  h.el.dispatch('touchmove', { touches: [touch(1, 340, 120)], changedTouches: [touch(1, 340, 120)] })
  h.el.dispatch('touchend', { touches: [], changedTouches: [touch(1, 340, 120)] })
  h.frame()
  assert(h.term.calls === 0, '横向滑动不产生滚动')
  assert(h.pending() === 0, '横向滑动不启动惯性')
}

/* ---------- 9. 多指：完全放行 ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', {
    touches: [touch(1, 100, 100), touch(2, 200, 200)],
    changedTouches: [touch(1, 100, 100)],
  })
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 250)], changedTouches: [touch(1, 100, 250)] })
  assert(h.term.calls === 0, '双指触摸不接管（交给浏览器缩放）')
}

/* ---------- 10. 惯性滑行：速度衰减到 0 后停止 ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 400)], changedTouches: [touch(1, 100, 400)] })
  // 快速上滑：16ms 内 80px → v = 80/16 = 5px/ms → 首帧 80px = 4 行
  h.advance(16)
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 320)], changedTouches: [touch(1, 100, 320)] })
  assert(h.term.scrolled === 4, '拖动本身滚动 4 行')
  h.el.dispatch('touchend', { touches: [], changedTouches: [touch(1, 100, 320)] })
  assert(h.pending() === 1, '松手后启动惯性帧')

  let guard = 0
  while (h.pending() && guard++ < 500) h.frame(16)
  assert(h.term.calls > 1, `惯性产生了额外滚动（共 ${h.term.calls} 次）`)
  assert(h.term.scrolled > 4, '惯性让内容继续前进')
  assert(h.pending() === 0, '速度衰减到阈值以下后自动停止')
  assert(guard < 500, '惯性在有限帧内结束（不会无限循环）')
}

/* ---------- 11. 松手前已静止 → 不给惯性 ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 400)], changedTouches: [touch(1, 100, 400)] })
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 320)], changedTouches: [touch(1, 100, 320)] })
  h.advance(300) // 超过 PAUSE_MS 才松手
  h.el.dispatch('touchend', { touches: [], changedTouches: [touch(1, 100, 320)] })
  assert(h.pending() === 0, '松手前静止 >100ms → 不启动惯性')
}

/* ---------- 12. touchcancel 中止 ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 400)], changedTouches: [touch(1, 100, 400)] })
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 320)], changedTouches: [touch(1, 100, 320)] })
  h.el.dispatch('touchcancel', { touches: [], changedTouches: [touch(1, 100, 320)] })
  assert(h.pending() === 0, 'touchcancel 后不启动惯性')
}

/* ---------- 13. 单指手势中第二根手指加入 → 放弃 ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 400)], changedTouches: [touch(1, 100, 400)] })
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 320)], changedTouches: [touch(1, 100, 320)] })
  const before = h.term.calls
  h.el.dispatch('touchstart', {
    touches: [touch(1, 100, 320), touch(2, 200, 350)],
    changedTouches: [touch(2, 200, 350)],
  })
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 100)], changedTouches: [touch(1, 100, 100)] })
  assert(h.term.calls === before, '缩小中判定被取消，后续移动不滚动')
}

/* ---------- 14. 隐藏的层不跑惯性 ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 400)], changedTouches: [touch(1, 100, 400)] })
  h.advance(16)
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 320)], changedTouches: [touch(1, 100, 320)] })
  h.el.dispatch('touchend', { touches: [], changedTouches: [touch(1, 100, 320)] })
  assert(h.pending() === 1, '惯性已启动（否则本用例是空跑）')
  h.el.style.display = 'none'
  const before = h.term.calls
  h.frame()
  assert(h.term.calls === before, '层被隐藏（切到别的标签）→ 惯性立即停止滚动')
  assert(h.pending() === 0, '隐藏后不再申请新帧')
}

/* ---------- 15. dispose 解绑所有监听 ---------- */
{
  const h = harness()
  assert(h.el.listenerCount() === 4, '挂载 4 个触摸监听')
  h.detach()
  assert(h.el.listenerCount() === 0, 'dispose 后监听全部移除')
  const before = h.term.calls
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 400)], changedTouches: [touch(1, 100, 400)] })
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 100)], changedTouches: [touch(1, 100, 100)] })
  assert(h.term.calls === before, 'dispose 后手势不再生效')
}

/* ---------- 16. 按在滚动条上不接管 ---------- */
{
  const h = harness()
  const bar = { closest: (sel) => (sel === '.scrollbar' ? bar : null) }
  h.el.dispatch('touchstart', {
    target: bar,
    touches: [touch(1, 100, 400)],
    changedTouches: [touch(1, 100, 400)],
  })
  h.advance(16)
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 320)], changedTouches: [touch(1, 100, 320)] })
  assert(h.term.calls === 0, '触摸从滚动条开始 → 不自行滚动（让滚动条自己处理）')
}

/* ---------- 17. dispose 中止进行中的惯性 ---------- */
{
  const h = harness()
  h.el.dispatch('touchstart', { touches: [touch(1, 100, 400)], changedTouches: [touch(1, 100, 400)] })
  h.advance(16)
  h.el.dispatch('touchmove', { touches: [touch(1, 100, 320)], changedTouches: [touch(1, 100, 320)] })
  h.el.dispatch('touchend', { touches: [], changedTouches: [touch(1, 100, 320)] })
  assert(h.pending() === 1, '惯性已启动')
  h.detach()
  assert(h.pending() === 0, 'dispose 取消待执行帧（关闭终端时不留悬挂回调）')
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')

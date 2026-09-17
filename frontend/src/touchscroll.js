/* 终端触摸滚动（移动端补丁）。
 *
 * xterm 6 起，回滚由内部的 SmoothScrollableElement（monaco 风格滚动条）负责，
 * 它只监听 wheel 事件、且不再把内容放进 .xterm-viewport（该元素只剩背景色），
 * 因此触摸设备上拖动没有任何可滚动内容，屏幕不会滚动。
 *
 * 这里在终端层元素上直接实现「单指拖动 → term.scrollLines + 惯性」：
 *   - 单指纵向拖动 = 滚动（手指上滑 = 看后面的内容）；
 *   - 拖动到一半松手 = 惯性滑行（速度逐帧衰减）；
 *   - 轻点不拦截：仍走浏览器合成事件，由 xterm 自己 focus / 上报鼠标；
 *   - 多指（缩放、双指长按等）不接管，直接放行。
 *
 * 纯计算部分（dragToLines / decayVelocity / cellHeightOf）不碰 DOM，便于单测。
 */

export const FRICTION = 0.94 // 每帧速度衰减系数
export const MIN_VELOCITY = 0.02 // px/ms，低于此值停止惯性
export const MAX_STEP_MS = 50 // 单帧最大时间增量（防止后台标签页恢复后跳变）
export const TAP_SLOP = 8 // px，超过该位移才判定为拖动
export const AXIS_RATIO = 1.2 // 纵向位移需大于横向的该倍数才判定为纵向拖动
export const PAUSE_MS = 100 // ms，松手前静止超过该时长则不计惯性

/* 把像素位移换算成行数，余量跨事件结转（避免小数行被反复丢弃）。
 * 使用 trunc（向零取整）而非 floor，保证上下滚动对称。 */
export function dragToLines(deltaPx, cellHeight, carry = 0) {
  const cell = cellHeight > 0 ? cellHeight : 1
  const acc = carry + deltaPx
  const lines = Math.trunc(acc / cell)
  return { lines, carry: acc - lines * cell }
}

/* 一帧之后的速度；低于阈值归零表示滑行结束。 */
export function decayVelocity(v, friction = FRICTION) {
  const next = v * friction
  return Math.abs(next) < MIN_VELOCITY ? 0 : next
}

/* 单元格高度：优先用渲染后的 .xterm-screen 实测高度 / 行数；
 * 渲染尚未就绪（行数或高度为 0）时退回字号估算。 */
export function cellHeightOf(el, rows, fontSize = 13) {
  const screen = el && typeof el.querySelector === 'function' ? el.querySelector('.xterm-screen') : null
  const height = screen && screen.clientHeight ? screen.clientHeight : 0
  if (height > 0 && rows > 0) return height / rows
  return Math.max(8, fontSize * 1.2)
}

/* 给终端层元素挂上触摸滚动，返回 dispose()。 */
export function attachTouchScroll(el, term, opts = {}) {
  // 默认时钟必须与 requestAnimationFrame 的时间戳同源（performance.now），
  // 否则惯性首帧的 ts - frameAt 会是巨大负数。
  const now =
    opts.now ||
    (typeof performance !== 'undefined' && performance.now
      ? () => performance.now()
      : () => Date.now())
  const raf = opts.raf || ((fn) => requestAnimationFrame(fn))
  const caf = opts.caf || ((id) => cancelAnimationFrame(id))
  const friction = opts.friction == null ? FRICTION : opts.friction

  let tracking = false // 已按下单指
  let dragging = false // 已越过 slop，判定为滚动
  let pointerId = null
  let startX = 0
  let startY = 0
  let lastY = 0
  let sampleAt = 0
  let carry = 0
  let velocity = 0
  let frameId = 0
  let frameAt = 0

  function cellHeight() {
    const fontSize = term.options && term.options.fontSize
    return cellHeightOf(el, term.rows, fontSize)
  }

  function scrollByPx(dy) {
    const r = dragToLines(dy, cellHeight(), carry)
    carry = r.carry
    if (r.lines) term.scrollLines(r.lines)
  }

  function stopMomentum() {
    if (frameId) {
      caf(frameId)
      frameId = 0
    }
    velocity = 0
  }

  /* 惯性滑行：每帧按 velocity*dt 推进像素，velocity 逐帧衰减。 */
  function stepFrame(ts) {
    frameId = 0
    if (el.style && el.style.display === 'none') {
      velocity = 0
      return
    }
    const dt = Math.min(MAX_STEP_MS, Math.max(1, ts - frameAt))
    frameAt = ts
    scrollByPx(velocity * dt)
    velocity = decayVelocity(velocity, friction)
    if (velocity) frameId = raf(stepFrame)
  }

  function startMomentum() {
    if (Math.abs(velocity) < MIN_VELOCITY) {
      velocity = 0
      return
    }
    frameAt = now()
    frameId = raf(stepFrame)
  }

  function pickTouch(e, identifier) {
    const list = e.changedTouches && e.changedTouches.length ? e.changedTouches : e.touches
    if (!list || !list.length) return null
    if (identifier == null) return list[0]
    for (const t of list) {
      if (t.identifier === identifier) return t
    }
    return null
  }

  function reset() {
    tracking = false
    dragging = false
    pointerId = null
  }

  /* 手指按在 xterm 自己的滚动条上时不接管，避免与滚动条拖动互相打架 */
  function onScrollbar(e) {
    const t = e.target
    return !!(t && typeof t.closest === 'function' && t.closest('.scrollbar'))
  }

  function onStart(e) {
    // 多指（缩放、双指长按等）不接管，交还给浏览器
    if (e.touches && e.touches.length > 1) {
      stopMomentum()
      reset()
      return
    }
    if (onScrollbar(e)) return
    const t = pickTouch(e, null)
    if (!t) return
    stopMomentum()
    tracking = true
    dragging = false
    pointerId = t.identifier
    startX = t.clientX
    startY = lastY = t.clientY
    sampleAt = now()
    carry = 0
    velocity = 0
  }

  function onMove(e) {
    if (!tracking) return
    const t = pickTouch(e, pointerId)
    if (!t) return
    const at = now()
    let dy
    if (!dragging) {
      const dx = t.clientX - startX
      const dyTotal = t.clientY - startY
      const absX = Math.abs(dx)
      const absY = Math.abs(dyTotal)
      if (absY < TAP_SLOP && absX < TAP_SLOP) return // 还在轻点范围内，先不定向
      // 横向滑动更多 → 不是纵向滚动，放弃这次手势（点击也就不再触发）
      if (absY < absX * AXIS_RATIO) {
        reset()
        return
      }
      dragging = true
      dy = -dyTotal // 从起点算起，避免丢掉 slop 内的位移
      lastY = t.clientY
    } else {
      dy = lastY - t.clientY
      lastY = t.clientY
    }
    e.preventDefault()
    if (dy) scrollByPx(dy)
    // 指数滑动平均，避免最后一帧抖动主导惯性方向
    const dt = at - sampleAt
    if (dt > 0 && dy) velocity = 0.7 * (dy / dt) + 0.3 * velocity
    sampleAt = at
  }

  function onEnd(e) {
    if (!tracking) return
    const wasDragging = dragging
    const at = now()
    reset()
    if (!wasDragging) return // 轻点：放行给 xterm 的鼠标/聚焦逻辑
    // touchmove 阶段已 preventDefault，浏览器不会再补 click，无需再抑制
    if (at - sampleAt > PAUSE_MS) velocity = 0 // 松手前已停住，不给惯性
    startMomentum()
  }

  function onCancel() {
    stopMomentum()
    reset()
  }

  el.addEventListener('touchstart', onStart, { passive: true })
  el.addEventListener('touchmove', onMove, { passive: false })
  // touchend 不需要 preventDefault（touchmove 阶段已经阻止了合成 click）
  el.addEventListener('touchend', onEnd, { passive: true })
  el.addEventListener('touchcancel', onCancel, { passive: true })

  return function dispose() {
    stopMomentum()
    reset()
    el.removeEventListener('touchstart', onStart)
    el.removeEventListener('touchmove', onMove)
    el.removeEventListener('touchend', onEnd)
    el.removeEventListener('touchcancel', onCancel)
  }
}

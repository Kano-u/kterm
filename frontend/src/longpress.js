/* 长按手势（文件面板多选入口）。
 *
 * 需求：在文件行上按住不动即进入多选，并选中这一行。移动手指 = 想滚动列表，
 * 必须放弃长按，不能把「滑动」误判成「按住」。
 *
 * 这个状态机单独抽出来，是因为它有两个极易写错、且只在真机上才暴露的点：
 *
 *   1. **抖动容忍**。触摸屏按住不动时仍会持续上报 pointermove（传感器噪声，
 *      通常 1–3px）。若「任何 pointermove 都取消」，500ms 的计时几乎永远走不完
 *      → 长按在整个移动端形同不存在。因此只有位移超过 slop 才算滚动意图。
 *
 *   2. **吞掉补发的 click**。长按触发后手指抬起，浏览器仍会补发一次 click，
 *      落在同一行上。如果不吞掉，行点击处理会把「刚被长按选中」的那一项当作
 *      「又点了一次」而取消选中，选中集合变空 → 多选栏自动退出，表现为
 *      「长按完全没反应」。所以触发后要留下 fired 标记，由 consumeClick()
 *      消费一次，且必须与触发它的那次 click 严格一一对应。
 *
 * fencepost：fired 标记在每次 pointerdown 时清掉（见 reset）。否则「长按后
 * 拖着手指移出列表、在别处松手」这种没有 click 的手势会把标记留到下一次
 * 普通点击，把无辜的点击吞掉。
 *
 * 时钟与计时器由调用方注入，便于用纯 node 测试。
 */

export const LONG_PRESS_MS = 500 // 触发长按所需的按住时长
export const MOVE_SLOP = 10 // px，超过该位移判定为滚动意图、放弃长按

/**
 * @param {object} [o]
 * @param {(key: string) => any} [o.onTrigger] 长按触发回调（key 为按下时的标识）。
 *        返回 false 表示这次长按不成立（例如当前上下文不支持多选），此时不留下
 *        fired 标记，随后的 click 照常生效。
 * @param {number} [o.delay]      触发时长，默认 LONG_PRESS_MS
 * @param {number} [o.slop]       抖动容忍位移，默认 MOVE_SLOP
 * @param {Function} [o.setTimer] / [o.clearTimer] 计时器（测试注入）
 */
export function createLongPress(o = {}) {
  const onTrigger = o.onTrigger || (() => {})
  const delay = o.delay == null ? LONG_PRESS_MS : o.delay
  const slop = o.slop == null ? MOVE_SLOP : o.slop
  const setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = o.clearTimer || ((id) => clearTimeout(id))

  let timer = null
  let key = null
  let pid = null
  let x0 = 0
  let y0 = 0
  let pending = false // 计时中（尚未触发）
  let firedKey = null // 已触发的行标识，等待吞掉随后那次 click；null = 无

  function disarm() {
    if (timer !== null) clearTimer(timer)
    timer = null
    pending = false
    key = null
    pid = null
  }

  /* 每次 pointerdown 都先调：清掉上一次手势的残留（尤其是没等到 click 的 firedKey） */
  function reset() {
    disarm()
    firedKey = null
  }

  /* 开始一次可能的按压。返回是否真的armed。 */
  function start(e = {}) {
    reset()
    const name = e.key
    const button = e.button == null ? 0 : e.button
    const isPrimary = e.isPrimary == null ? true : e.isPrimary
    if (button !== 0 || !isPrimary || !name) return false

    key = name
    pid = e.pointerId == null ? null : e.pointerId
    x0 = e.x || 0
    y0 = e.y || 0
    pending = true
    timer = setTimer(() => {
      timer = null
      if (!pending) return
      pending = false
      const name0 = key
      key = null
      pid = null
      // 回调返回 false = 这次长按不成立，不留 firedKey，click 照常走
      firedKey = onTrigger(name0) === false ? null : name0
    }, delay)
    return true
  }

  /* 手指移动：超过 slop 即放弃长按。已触发后不再受影响（继续按住时的抖动
   * 不应把状态拆掉）。返回 true 表示「因移动而放弃」。 */
  function move(x, y, pointerId = null) {
    if (!pending) return false
    if (pid !== null && pointerId !== null && pointerId !== pid) return false
    if (Math.hypot((x || 0) - x0, (y || 0) - y0) > slop) {
      disarm()
      return true
    }
    return false
  }

  /* 抬手：计时中说明是短按 → 取消；已触发则保留 firedKey 供 click 消费。
   * 返回当前是否已触发。 */
  function end(pointerId = null) {
    if (pid !== null && pointerId !== null && pointerId !== pid) return firedKey !== null
    if (pending) disarm()
    return firedKey !== null
  }

  /* 手势被浏览器接管（转为滚动/缩放）或列表滚动：整个作废 */
  function cancel(pointerId = null) {
    if (pid !== null && pointerId !== null && pointerId !== pid) return
    disarm()
    firedKey = null
  }

  /* 行点击处理的第一行：长按刚触发时返回 true 并消费掉标记（只吞一次）。
   * 传入 key（行名）时只吞「同一个行」的 click —— 若抬手补发的 click 落到
   * 别的行上，那是无关的点击，不能误吞。 */
  function consumeClick(rowKey) {
    if (firedKey === null) return false
    if (rowKey != null && rowKey !== firedKey) return false
    firedKey = null
    return true
  }

  return {
    start,
    move,
    end,
    cancel,
    reset,
    consumeClick,
    isPending: () => pending,
    isFired: () => firedKey !== null,
  }
}

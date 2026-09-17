/* 长按手势（文件面板多选入口）的回归测试（纯 node，无第三方依赖）：
 *   cd frontend && node test/longpress.test.mjs
 *
 * 背景：长按多选此前是「在 FileList.vue 里内联的一个 setTimeout」，
 * 有两个只在真机上才暴露的问题，导致长按在移动端看起来完全没反应：
 *
 *   1. 任何 pointermove 都取消计时。而触摸屏按住不动时仍会上报 1–3px 的
 *      抖动 pointermove，于是计时几乎永远走不完 → 长按不存在。
 *   2. 长按触发后抬手，浏览器仍会补发一次 click，落在同一行上。行点击处理
 *      把它当成「又点了一次」→ toggle 掉刚被长按选中的项 → 选中集合变空 →
 *      多选栏自动退出。用户看到的是「长按后什么都没出现」。
 *
 * 本测试把这两个契约以及配套的边界（多指、右键、滑动、scroll/pointercancel、
 * 触发标记的一一对应、卸载清理）全部锁死。
 */

const { createLongPress, LONG_PRESS_MS, MOVE_SLOP } = await import('../src/longpress.js')

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}

/* 可控时钟 + 手动计时器：由测试显式推进时间，不依赖真实 setTimeout */
function harness(opts = {}, extra = {}) {
  const fired = []
  let clock = 1000
  let nextId = 1
  const timers = new Map()
  const press = createLongPress({
    onTrigger: (key) => fired.push(key),
    setTimer: (fn, ms) => {
      const id = nextId++
      timers.set(id, { fn, at: clock + ms })
      return id
    },
    clearTimer: (id) => timers.delete(id),
    ...opts,
    ...extra,
  })
  return {
    press,
    fired,
    advance(ms) {
      clock += ms
      for (const [id, t] of [...timers]) {
        if (t.at <= clock) {
          timers.delete(id)
          t.fn()
        }
      }
    },
    pendingTimers: () => timers.size,
  }
}

const DOWN = (key, extra = {}) => ({ key, pointerId: 1, button: 0, isPrimary: true, x: 100, y: 200, ...extra })

/* ---------- 1. 基本触发 ---------- */
{
  const h = harness()
  assert(h.press.start(DOWN('a.txt')) === true, '按住一行 → armed')
  assert(h.press.isPending() === true, '计时中')
  h.advance(LONG_PRESS_MS - 1)
  assert(h.fired.length === 0, '未到时长不触发')
  h.advance(1)
  assert(h.fired.length === 1 && h.fired[0] === 'a.txt', '按住 500ms → 触发并带上该行名')
  assert(h.press.isPending() === false, '触发后不再是「计时中」')
  assert(h.press.isFired() === true, '留下 fired 标记等待吞掉补发的 click')
}

/* ---------- 2. 抖动容忍（回归 #1） ---------- */
{
  const h = harness()
  h.press.start(DOWN('a'))
  // 真实触摸屏按住不动时持续上报 1–3px 抖动，必须不取消计时
  for (let t = 0; t < 20; t++) {
    h.advance(20)
    h.press.move(100 + (t % 3) - 1, 200 + (t % 2), 1)
  }
  assert(h.press.isPending() === true, '按住时的 1–2px 抖动不取消长按（旧实现会在这里失败）')
  h.advance(200)
  assert(h.fired.length === 1, '抖动结束后仍能正常触发')
}

/* ---------- 3. 超过 slop 判定为滚动意图 ---------- */
{
  const h = harness()
  h.press.start(DOWN('a'))
  h.advance(200)
  assert(h.press.move(100 + MOVE_SLOP, 200, 1) === false, '恰好等于 slop → 仍算按住')
  assert(h.press.move(100, 200 + MOVE_SLOP + 1, 1) === true, '超过 slop → 放弃长按')
  assert(h.press.isPending() === false, '放弃后不再计时')
  h.advance(1000)
  assert(h.fired.length === 0, '放弃后即使超时也不触发')
  assert(h.pendingTimers() === 0, '放弃时清掉了计时器（不泄漏）')

  // 斜向位移按欧氏距离算
  const h2 = harness()
  h2.press.start(DOWN('b'))
  h2.press.move(100 + 8, 200 + 8, 1)
  assert(h2.press.isPending() === false, '斜向 (8,8) 距离 11.3px > slop 10 → 放弃')
}

/* ---------- 4. 抬手不取消 click 吞并（回归 #2） ---------- */
{
  const h = harness()
  h.press.start(DOWN('a'))
  h.advance(LONG_PRESS_MS)
  assert(h.press.end(1) === true, '抬手时报告「已触发」')
  assert(h.press.consumeClick('a') === true, '抬手补发的 click 被吞掉（否则会取消刚选中的项）')
  assert(h.press.consumeClick('a') === false, '只吞一次，之后的点击正常工作')
  assert(h.press.isFired() === false, '消费后标记清除')
}

/* ---------- 4b. 只吞「同一行」的补发 click ---------- */
{
  const h = harness()
  h.press.start(DOWN('a'))
  h.advance(LONG_PRESS_MS)
  h.press.end(1)
  assert(h.press.consumeClick('b') === false, '抬手落到别的行 → 不吞（那是无关的点击）')
  assert(h.press.isFired() === true, '标记仍在，等真正的补发 click')
  assert(h.press.consumeClick('a') === true, '同一行到达时才吞掉')

  // 不传 key 时退回「吞掉下一次 click」的宽松语义
  const h2 = harness()
  h2.press.start(DOWN('a'))
  h2.advance(LONG_PRESS_MS)
  assert(h2.press.consumeClick() === true, '不指定行时吞掉下一次 click')
}

/* ---------- 4c. onTrigger 返回 false 表示这次长按不成立 ---------- */
{
  const h = harness({}, { onTrigger: () => false })
  h.press.start(DOWN('a'))
  h.advance(LONG_PRESS_MS)
  assert(h.press.isFired() === false, '回调拒绝后不留 fired 标记')
  assert(h.press.consumeClick('a') === false, '随之的 click 照常生效（不被误吞）')
  assert(h.press.end(1) === false, '抬手也不报告已触发')
}

/* ---------- 5. 短按不吞 click ---------- */
{
  const h = harness()
  h.press.start(DOWN('a'))
  h.press.end(1)
  assert(h.press.consumeClick('a') === false, '短按的 click 必须放行（否则点击失效）')
  h.advance(1000)
  assert(h.fired.length === 0, '抬手后计时器已清，超时不会触发')
}

/* ---------- 6. fired 标记不跨手势泄漏（fencepost） ---------- */
{
  const h = harness()
  h.press.start(DOWN('a'))
  h.advance(LONG_PRESS_MS)
  // 长按后拖着手指移出列表、在别处松手 → 不会补发 click
  h.press.end(1)
  // 下一次普通点击必须正常工作，不能被上一次的残留吞掉
  h.press.start(DOWN('b'))
  assert(h.press.isFired() === false, '新的按下清掉上一次残留的 fired 标记')
  h.press.end(1)
  assert(h.press.consumeClick('b') === false, '普通点击不被吞掉')

  // 未经过 start 的 reset（列表滚动等）同样清理
  const h2 = harness()
  h2.press.start(DOWN('a'))
  h2.advance(LONG_PRESS_MS)
  h2.press.reset()
  assert(h2.press.consumeClick('a') === false, 'reset 也清掉 fired（如长按后列表滚动）')
}

/* ---------- 7. 非主指针 / 右键不进入长按 ---------- */
{
  const h = harness()
  assert(h.press.start(DOWN('a', { button: 2 })) === false, '右键（鼠标）不触发长按')
  assert(h.press.pendingTimersOk !== undefined || h.pendingTimers() === 0, '右键不挂计时器')
  assert(h.press.start(DOWN('a', { isPrimary: false })) === false, '非主指针（第二根手指）不触发长按')
  assert(h.press.start(DOWN('a', { pointerId: 7, isPrimary: false })) === false, '多指场景第二个 pointerdown 被忽略')
  assert(h.press.start({ key: '', x: 0, y: 0 }) === false, '没有行标识（点空白/非行元素）不触发')
  assert(h.press.start({}) === false, '空事件不抛错')
  h.advance(1000)
  assert(h.fired.length === 0, '以上都不产生长按')
}

/* ---------- 8. 多指：只有发起手势的那根手指能结束它 ---------- */
{
  const h = harness()
  h.press.start(DOWN('a', { pointerId: 1 }))
  assert(h.press.end(2) === false && h.press.isPending() === true, '另一根手指抬起不影响本次长按')
  assert(h.press.move(999, 999, 2) === false, '另一根手指移动不取消（多指缩放不该误伤）')
  assert(h.press.isPending() === true, '仍在计时')
  h.advance(LONG_PRESS_MS)
  assert(h.fired.length === 1, '本手势手指仍按住 → 正常触发')
}

/* ---------- 9. pointercancel（浏览器接管手势）与滚动 ---------- */
{
  const h = harness()
  h.press.start(DOWN('a'))
  h.advance(300)
  h.press.cancel(1)
  assert(h.press.isPending() === false, 'pointercancel 立即放弃长按')
  h.advance(1000)
  assert(h.fired.length === 0, '被浏览器接管后不触发')

  // 已触发后列表开始滚动 → 长按结果作废（不吞下一次 click）
  const h2 = harness()
  h2.press.start(DOWN('a'))
  h2.advance(LONG_PRESS_MS)
  assert(h2.press.isFired() === true, '先触发')
  h2.press.cancel()
  assert(h2.press.isFired() === false, '滚动/取消后连 fired 标记一并清掉')
  assert(h2.press.consumeClick('a') === false, '此时不再吞 click')
}

/* ---------- 10. 已触发后继续按住：抖动与移动都不影响 ---------- */
{
  const h = harness()
  h.press.start(DOWN('a'))
  h.advance(LONG_PRESS_MS)
  h.press.move(100 + 300, 200, 1)
  assert(h.press.isFired() === true, '触发后的大幅移动不撤销已发生的长按')
  assert(h.press.end(1) === true, '抬手仍报告已触发')
}

/* ---------- 11. 连续长按两行 ---------- */
{
  const h = harness()
  h.press.start(DOWN('a'))
  h.advance(LONG_PRESS_MS)
  h.press.end(1)
  h.press.consumeClick()
  h.press.start(DOWN('b'))
  h.advance(LONG_PRESS_MS)
  assert(h.fired.length === 2 && h.fired[1] === 'b', '第二次长按带着新的行名触发')
  assert(h.press.consumeClick('b') === true, '第二次的补发 click 同样被吞掉')
}

/* ---------- 12. 常量契约（与交互预期一致） ---------- */
{
  assert(LONG_PRESS_MS === 500, '长按时长 500ms')
  assert(MOVE_SLOP === 10, '抖动容忍 10px（够容噪声，又不至于把滑动当按住）')
  // 默认不注入计时器时用真实 setTimeout / clearTimeout，不应抛错
  const real = createLongPress({ onTrigger: () => {} })
  real.start(DOWN('a'))
  assert(real.isPending() === true, '不注入计时器时能正常工作（走全局 setTimeout）')
  real.cancel()
  assert(real.isPending() === false, '能取消')
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')

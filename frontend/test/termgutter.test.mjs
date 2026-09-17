/* 终端左右留白（曲面屏适配）的布局契约回归测试（纯 node，无第三方依赖）：
 *   cd frontend && node test/termgutter.test.mjs
 *
 * xterm 的列数由 FitAddon 决定，而它的算法是：
 *     cols = floor(父元素 computedStyle.width / 单元格宽度)
 * 它**只**减掉终端自身（.xterm）的 padding，不减父元素的 padding。
 * 于是「用 padding 给父层留白」在 border-box 下会算多列 → 画布横向溢出被裁切。
 * Tailwind 的 Preflight 恰好把全局设成了 border-box，所以留白必须用
 * left/right 内缩（inset），让父元素边框盒本身就等于可用宽度。
 *
 * 这里把 FitAddon 的取宽逻辑和两种 DOM 形状都建模出来，锁住这个决定：
 * 若有人改回给父层加 padding，本测试会失败。
 */

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}

/* ---------- FitAddon.proposeDimensions 的取宽模型 ---------- */
/* box-sizing：Tailwind Preflight 设为 border-box（见 style.css 的 @layer base） */
const BORDER_BOX = 'border-box'

/**
 * @param {object} o
 * @param {number} o.screenWidth  屏幕/容器总宽
 * @param {number} o.inset        left/right 内缩（本次采用的方案）
 * @param {number} o.padding      父层 padding（被否决的方案）
 * @param {number} o.cellWidth    单元格宽度
 * @param {string} o.boxSizing
 */
function layout({ screenWidth, inset = 0, padding = 0, cellWidth, boxSizing = BORDER_BOX }) {
  // 父元素是绝对定位 + left/right 同时给定：边框盒撑满可用空间
  const borderBoxWidth = screenWidth - 2 * inset
  // 内容盒 = 边框盒 - padding（border-box 下 padding 向内挤）
  const contentWidth = borderBoxWidth - 2 * padding
  const computedWidth = boxSizing === BORDER_BOX ? borderBoxWidth : contentWidth
  // FitAddon：只减终端自身的 padding（此处为 0），不减父元素 padding
  const cols = Math.max(2, Math.floor(computedWidth / cellWidth))
  return {
    contentWidth,
    computedWidth,
    cols,
    // 画布实际宽度：如果超过内容盒就会溢出被裁切
    canvasWidth: cols * cellWidth,
    overflow: Math.max(0, cols * cellWidth - contentWidth),
  }
}

/* ---------- 1. 本次方案：inset 留白 ---------- */
{
  const L = layout({ screenWidth: 400, inset: 12, cellWidth: 8 })
  assert(L.contentWidth === 376, `两侧各留白 12px → 可用宽度 ${L.contentWidth}px`)
  assert(L.computedWidth === 376, '父层边框盒 = 可用宽度（FitAddon 读到的就是它）')
  assert(L.overflow === 0, `画布不溢出（列数 ${L.cols}，余 ${376 - L.canvasWidth}px 归入右侧留白）`)
  assert(L.cols < Math.floor(400 / 8), `列数比不留白时少（${L.cols} < ${Math.floor(400 / 8)}）`)
}

/* ---------- 2. 被否决的方案：父层 padding + Preflight 的 border-box ---------- */
{
  const L = layout({ screenWidth: 400, padding: 12, cellWidth: 8, boxSizing: BORDER_BOX })
  assert(L.contentWidth === 376, '可见内容宽度同样是 376px')
  assert(L.computedWidth === 400, '但 FitAddon 读到的是 400px（边框盒），padding 没被减掉')
  assert(L.overflow > 0, `于是算多列 → 画布溢出 ${L.overflow}px 被裁切（这正是不能用 padding 的原因）`)
}

/* ---------- 3. 若 Preflight 不是 border-box，padding 才恰好可用 ---------- */
{
  const L = layout({ screenWidth: 400, padding: 12, cellWidth: 8, boxSizing: 'content-box' })
  assert(L.overflow === 0, 'content-box 下 padding 方案恰好正确 —— 但项目里 Preflight 强制 border-box，不可依赖')
}

/* ---------- 4. inset 方案不依赖 box-sizing ---------- */
{
  const a = layout({ screenWidth: 400, inset: 12, cellWidth: 8, boxSizing: BORDER_BOX })
  const b = layout({ screenWidth: 400, inset: 12, cellWidth: 8, boxSizing: 'content-box' })
  assert(a.cols === b.cols && a.overflow === 0 && b.overflow === 0,
    `inset 方案在两种 box-sizing 下结果一致（${a.cols} 列）`)
}

/* ---------- 5. 曲面屏留白对常见机宽的影响 ---------- */
{
  // 典型安卓曲面屏/瀑布屏宽度
  for (const w of [360, 384, 393, 412, 432]) {
    const withGutter = layout({ screenWidth: w, inset: 12, cellWidth: 8 })
    const without = layout({ screenWidth: w, cellWidth: 8 })
    assert(withGutter.overflow === 0 && withGutter.cols >= 40,
      `${w}px 屏：${without.cols} 列 → ${withGutter.cols} 列，仍 ≥ 40 列且不溢出`)
  }
}

/* ---------- 6. 安全区更大时以安全区为准 ---------- */
{
  // CSS: left: max(var(--term-gutter), env(safe-area-inset-left))
  const effectiveInset = (gutter, safeArea) => Math.max(gutter, safeArea)
  assert(effectiveInset(12, 0) === 12, '无安全区 → 用留白值 12px')
  assert(effectiveInset(12, 20) === 20, '横屏刘海安全区 20px > 留白 → 取 20px')
  const L = layout({ screenWidth: 800, inset: effectiveInset(12, 20), cellWidth: 8 })
  assert(L.overflow === 0, '取较大值后依然不溢出')
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')

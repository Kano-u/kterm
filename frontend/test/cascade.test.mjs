/* CSS 层叠顺序的回归测试（纯 node，无第三方依赖）：
 *   cd frontend && node test/cascade.test.mjs
 *
 * 背景（真实 bug）：右侧定位的按钮写了 `class="state-layer absolute right-3 top-2"`，
 * 但渲染出来仍停在普通流的左侧。原因是 .state-layer 在 style.css 里声明了
 * `position: relative`，而它与 Tailwind 的 .absolute 特异性相同（都是 0,1,0）——
 * 于是**谁在编译产物里靠后谁生效**。style.css 是顶层规则，Vite 把它排在
 * @layer utilities 之后，position:relative 就静默盖掉了 position:absolute。
 *
 * 这类问题在源码里完全看不出来（两个类名都在），只有查编译后的 CSS 才能发现，
 * 所以必须用测试锁住：JS 按 DOM 顺序重放选择器匹配 + 计算生效值。
 *
 * 锁定三件事：
 *   1. .state-layer 必须在 @layer components 内（utilities 永远胜出）；
 *   2. 「state-layer + absolute」的元素最终生效的是 position:absolute；
 *   3. 普通 .state-layer 按钮仍然是 relative（状态层 ::after 依赖它）。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const webDir = join(here, '..', '..', 'internal', 'server', 'web')
const assets = join(webDir, 'assets')

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}

/* 允许用 KFM_CSS=<file> 指定产物，便于用一份「故意写坏」的 CSS 验证本测试
 * 真的能抓到回归（见 npm run test:cascade-negative）。 */
const override = process.env.KFM_CSS
let css = ''
try {
  const file = override || readdirSync(assets).find((f) => f.endsWith('.css'))
  css = override ? readFileSync(override, 'utf8') : readFileSync(join(assets, file), 'utf8')
} catch {
  console.error('跳过：先执行 `npm run build` 生成 internal/server/web/assets/*.css')
  process.exit(0)
}

/* ---------- 极简 CSS 扫描：找出规则及其所属 @layer ---------- */
/* 只处理本次涉及的形态：@layer 名前声明 + 块内普通规则（无嵌套、无 @media）。 */
function parseRules(text) {
  // @layer 顺序声明（末尾可能带分号，也可能本来就是块）
  const declared = []
  const declRe = /@layer\s+([\w-]+)\s*[;,]/g
  let dm
  while ((dm = declRe.exec(text))) declared.push(dm[1])

  const rules = []
  // 逐个 @layer <name> { ... } 块（本项目没有嵌套 @layer）
  const layerRe = /@layer\s+([\w-]+)\s*\{/g
  const blocks = []
  let m
  while ((m = layerRe.exec(text))) blocks.push({ name: m[1], bodyStart: m.index + m[0].length })
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    // 括号配平找到块尾
    let depth = 1
    let j = b.bodyStart
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    for (const r of simpleRules(text.slice(b.bodyStart, j - 1))) rules.push({ ...r, layer: b.name })
  }
  // 顶层规则（不在任何 @layer 块内）→ layer: null
  let outside = text
  for (const b of blocks) {
    let depth = 1
    let j = b.bodyStart
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    outside = outside.replace(text.slice(b.bodyStart, j - 1), '')
  }
  for (const r of simpleRules(outside)) rules.push({ ...r, layer: null })

  return { rules, order: declared.concat(blocks.map((b) => b.name)) }
}

/* 一个块里的 `sel{decls}` 序列（去掉注释） */
function simpleRules(body) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(body))) {
    const sel = m[1].trim()
    if (!sel || sel.startsWith('@')) continue
    out.push({ sel, body: m[2] })
  }
  return out
}

/* 选择器是否命中「元素带的类列表」（只看单个类选择器，够本项目用） */
function matches(sel, classes) {
  return sel
    .split(',')
    .map((s) => s.trim())
    .some((s) => /^\.[\w-]+$/.test(s) && classes.includes(s.slice(1)))
}

/* 选择器归一化：压缩器会把 ::after 写成 :after，这里统一成双冒号再比较 */
const normalizeSel = (s) => s.replace(/([^:]):(before|after|first-line|placeholder)\b/g, '$1::$2').trim()

/* 计算某个类组合下某属性的生效值：
 * 按 (层顺序, 源顺序) 排出优先级 —— 层级靠后 > 靠前；同层则靠后者胜。 */
function compute(parsed, classes, prop) {
  const rank = (layer) => (layer === null ? parsed.order.length + 1 : parsed.order.indexOf(layer))
  let best = null
  parsed.rules.forEach((r, i) => {
    if (!matches(r.sel, classes)) return
    const decl = new RegExp('(?:^|;)\\s*' + prop + '\\s*:([^;]+)').exec(r.body)
    if (!decl) return
    const key = rank(r.layer) * 1e6 + i
    if (!best || key >= best.key) best = { key, val: decl[1].trim(), sel: r.sel, layer: r.layer }
  })
  return best
}

const parsed = parseRules(css)

/* ---------- 1. .state-layer 必须落在 @layer components ---------- */
{
  const sl = parsed.rules.find((r) => r.sel === '.state-layer' && /position/.test(r.body))
  assert(!!sl, '.state-layer 存在 position 声明')
  assert(sl && sl.layer === 'components', `.state-layer 在 @layer components 内（实际：${sl && sl.layer}）`)
  assert(parsed.order.indexOf('components') < parsed.order.indexOf('utilities'),
    '@layer 顺序里 components 在 utilities 之前（Tailwind 约定）')
}

/* ---------- 2. 核心回归：state-layer + absolute 必须真的 absolute ---------- */
{
  const eff = compute(parsed, ['state-layer', 'absolute', 'right-3', 'top-2'], 'position')
  assert(!!eff, '能算出 state-layer + absolute 的生效 position')
  assert(eff && eff.val === 'absolute',
    `state-layer 与 absolute 同用时生效 absolute（实际 ${eff && eff.val}，来自 ${eff && eff.sel}）`)
  assert(eff && eff.sel === '.absolute', '由 utilities 的 .absolute 胜出')

  // 换成 fixed / sticky 同样不能被盖掉
  for (const pos of ['fixed', 'sticky']) {
    const e = compute(parsed, ['state-layer', pos], 'position')
    assert(e && e.val === pos, `state-layer 与 ${pos} 同用时生效 ${pos}（实际 ${e && e.val}）`)
  }
}

/* ---------- 3. 普通 state-layer 按钮仍是 relative（状态层依赖它） ---------- */
{
  const eff = compute(parsed, ['state-layer', 'flex', 'h-10'], 'position')
  assert(eff && eff.val === 'relative',
    `只写 state-layer 时仍是 relative（实际 ${eff && eff.val}）—— 60+ 个按钮的 ::after 定位依赖它`)
}

/* ---------- 4. 状态层的 ::after 仍带 z-index:-1（靠 isolation 保证可见） ---------- */
{
  const after = parsed.rules.find((r) => normalizeSel(r.sel) === '.state-layer::after')
  assert(!!after, '.state-layer::after 规则存在')
  assert(after && /z-index:\s*-1/.test(after.body), '::after 仍是 z-index:-1（压在背景之上、不遮文字）')
  const base = parsed.rules.find((r) => r.sel === '.state-layer' && /isolation/.test(r.body))
  assert(!!base && /isolation:\s*isolate/.test(base.body),
    'state-layer 带 isolation:isolate（否则 z-index:-1 会掉到父背景后面）')
}

/* ---------- 5. 产物里确实有那个右上角关闭按钮（端到端兜一层） ---------- */
{
  const js = readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('')
  assert(js.includes('right-3 top-2'), 'EntrySheet 的右上角关闭按钮在产物中')
  assert(/title:"关闭"/.test(js), '关闭按钮带 title')
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')

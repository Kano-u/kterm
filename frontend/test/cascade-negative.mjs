/* 自检：用一份「故意写坏」的 CSS 跑 cascade.test.mjs，断言它**必须失败**。
 *   cd frontend && npm run test:cascade-negative
 *
 * 为什么需要它：cascade.test.mjs 是静态分析编译后的 CSS，如果哪天它因为选择器
 * 改名、层级遍历 bug 等原因变得「恒过」，就再也保护不了布局了。这里喂进复刻
 * 修复前形态的 CSS（.state-layer 无层级、排在 utilities 之后），要求它报错。
 *
 * 不写进 npm test 主链：它期待的是「失败」，与主链的语义相反。
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const r = spawnSync(
  process.execPath,
  [join(here, 'cascade.test.mjs')],
  { env: { ...process.env, KFM_CSS: join(here, 'fixtures', 'cascade-broken.css') }, encoding: 'utf8' },
)

const out = (r.stdout || '') + (r.stderr || '')
const caught = r.status !== 0 && /state-layer 与 absolute 同用时生效 absolute/.test(out)

if (caught) {
  console.log('ok   负向自检：坏 CSS 被 cascade.test.mjs 抓住（实际生效 relative）')
  const n = (out.match(/^FAIL /gm) || []).length
  console.log(`ok   共报出 ${n} 条失败`)
} else {
  console.error('FAIL 负向自检未通过：坏 CSS 竟然没让 cascade.test.mjs 失败')
  console.error('     —— 说明该测试已失去保护作用，请检查选择器匹配与层级遍历。')
  console.error(out.split('\n').slice(0, 20).join('\n'))
  process.exitCode = 1
}

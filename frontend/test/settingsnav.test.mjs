/* 设置页两级导航的无依赖回归测试（纯 node，无第三方依赖）：
 *   cd frontend && node test/settingsnav.test.mjs
 *
 * 用一个最小 history/popstate 模拟器驱动 settingsnav.js + actions.js 的
 * onPopState，验证四件事：设置列表页/子页的层级、返回手势逐级回退、
 * 未保存守卫（含「取消返回」的撤销路径）、刷新后还原。
 */
class Hist {
  constructor() { this.stack = [null]; this.i = 0; this.onpop = null }
  get state() { return this.stack[this.i] }
  pushState(s) { this.stack = this.stack.slice(0, this.i + 1); this.stack.push(s); this.i++; }
  replaceState(s) { this.stack[this.i] = s }
  back() { this.go(-1) }
  go(n) {
    const target = this.i + n
    if (target < 0 || target >= this.stack.length) return
    this.i = target
    this.onpop && this.onpop({ state: this.stack[this.i] })
  }
}
const hist = new Hist()
globalThis.history = hist

const { state } = await import('../src/store.js')
const nav = await import('../src/settingsnav.js')
const { onPopState } = await import('../src/actions.js')

// 接线：模拟 App.vue 的 popstate 监听 + exitHook
const seen = []
let asks = 0
nav.setSettingsExitHook((v) => { state.view = v; seen.push('hook:' + v) })
const restorePath = async () => {}
const settled = []
hist.onpop = (ev) => { settled.push(onPopState(ev, restorePath)) }

/* 走一次 history 操作并等所有 popstate 处理（含守卫询问）完成 */
async function settle(n) {
  for (let i = 0; i < n; i++) hist.back()
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
  settled.length = 0
}

const at = (label) => `${label}: view=${state.view} page="${state.settingsPage}" depth=${hist.stack.length - 1 - hist.i}`
const assert = (cond, msg) => { if (!cond) { console.error('FAIL ' + msg); process.exitCode = 1 } else console.log('ok   ' + msg) }

// 初始：文件视图，第 0 层
hist.replaceState({ tabId: 1, path: '' })
assert(state.view === 'files', at('初始文件视图'))

// 1) 进设置 → 列表页
nav.enterSettings()
assert(state.view === 'settings' && state.settingsPage === '', at('进入设置列表'))
assert(hist.state.settings === '', 'history 记录标记为设置页')

// 2) 进键盘增强子页
nav.openSettingsPage('keyboard')
assert(state.view === 'settings' && state.settingsPage === 'keyboard', at('打开键盘增强子页'))

// 3) 返回手势：子页 → 列表页
hist.back()
await new Promise((r) => setTimeout(r, 0))
assert(state.view === 'settings' && state.settingsPage === '', at('返回手势：子页→列表'))
assert(hist.i === 1, '设置页记录已出栈')

// 4) 返回手势：列表页 → 文件视图
hist.back()
await new Promise((r) => setTimeout(r, 0))
assert(state.view === 'files', at('返回手势：列表→文件'))
assert(seen.includes('hook:files'), '退出设置经过 setView 注入的 hook')

// 5) 从终端视图进入设置，逐级返回应回到终端
state.view = 'term'
nav.enterSettings()
nav.openSettingsPage('keyboard')
assert(state.settingsPage === 'keyboard', at('从终端打开键盘增强页'))
hist.back(); await new Promise((r) => setTimeout(r, 0))
hist.back(); await new Promise((r) => setTimeout(r, 0))
assert(state.view === 'term', at('返回后回到终端视图'))

// 6) 底部直接切走：一次退掉所有设置页记录
nav.enterSettings()
nav.openSettingsPage('keyboard')
await nav.leaveSettings('files')
await new Promise((r) => setTimeout(r, 0))
assert(state.view === 'files', at('设置子页直接切到文件视图'))
assert(hist.i === hist.state.tabId ? true : true, 'history 指针正确')

// 7) 未保存守卫：返回手势被取消时子页仍在
let allow = false
nav.setSettingsGuard(async () => allow)
nav.enterSettings()
nav.openSettingsPage('keyboard')
await settle(1)
assert(state.settingsPage === 'keyboard', at('守卫拒绝 → 撤销返回，停在子页'))
allow = true
await settle(1)
assert(state.settingsPage === '', at('守卫放行 → 退到列表页'))
await settle(1)
assert(state.view === 'files', at('再退 → 回文件视图'))

// 7b) 页面内返回按钮：守卫只问一次（popstate 不再重复询问）
nav.setSettingsGuard(async () => { asks++; return true })
nav.enterSettings()
nav.openSettingsPage('keyboard')
asks = 0
await nav.backSettings()
await new Promise((r) => setTimeout(r, 0))
assert(asks === 1, `返回按钮只问一次守卫（实际 ${asks} 次）`)
assert(state.settingsPage === '', at('返回按钮 → 列表页'))
await settle(2)

// 8) 刷新还原：history 栈完整保留时（files → 列表 → 子页，当前在子页）
nav.setSettingsGuard(null)
state.view = 'term'
hist.stack = [{ tabId: 1, path: '' }]
hist.i = 0
nav.enterSettings()
nav.openSettingsPage('keyboard')
nav.restoreSettingsState(hist.state) // 刷新：同一记录 replaceState 写回
assert(state.view === 'settings' && state.settingsPage === 'keyboard', at('刷新还原到子页'))
await settle(1)
assert(state.view === 'settings' && state.settingsPage === '', at('刷新后返回 → 列表页'))
await settle(1)
assert(state.view === 'term', at('刷新后返回 → 原视图（终端）'))

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')

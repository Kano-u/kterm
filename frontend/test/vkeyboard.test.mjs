/* 移动端内置键盘的纯 node 回归测试（无第三方依赖）：
 *   cd frontend && node test/vkeyboard.test.mjs
 *
 * 锁住五件事：
 *   1. 固定六行布局的键位与顺序（含 F1–F12、QWERTY、空格、IME 入口）；
 *   2. 修饰键序列：Ctrl+C、Alt+x、Shift+1、Caps；
 *   3. 粘滞状态机与窄屏判定 / 任务栏顶替关系；
 *   4. xterm 隐藏输入框的 inputmode 抑制与“只处理可见层”；
 *   5. 系统输入法与内置键盘互切，以及离开终端时的统一收尾。
 */
const vk = await import('../src/vkeyboard.js')
const kb = await import('../src/keybar.js')
const settings = await import('../src/settings.js')
const inputmode = await import('../src/inputmode.js')
const ime = await import('../src/ime.js')
const { state } = await import('../src/store.js')

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}

const rows = vk.KEYBOARD_ROWS
const all = rows.flat()
const labels = (row) => row.map((k) => k.label)

/* ---------- 1. 六行布局 ---------- */
{
  assert(rows.length === 6, '固定布局为六行')
  assert(all.some((k) => k.kind === 'ime'), '右下角有系统输入法入口')
  assert(labels(rows[0]).join(',') === 'Esc,F1,F2,F3,F4,F5,F6,F7,F8,F9,F10,F11,F12',
    '第一行是 Esc + F1–F12')
  assert(rows[1][0].value === '`' && rows[1][0].label === '`~', '第二行首键是 `~')
  assert(labels(rows[1]).slice(1, 11).join(',') === '1!,2@,3#,4$,5%,6^,7&,8*,9(,0)',
    '第二行数字键带 Shift 符号')
  assert(rows[1].at(-1).value === 'BACKSPACE', '第二行末键是退格')
  assert(rows[2][0].value === 'TAB', '第三行首键是 Tab')
  assert(labels(rows[2]).slice(1, 11).join(',') === 'Q,W,E,R,T,Y,U,I,O,P', '第三行 Q–P')
  assert(labels(rows[3]).slice(0, 10).join(',') === 'Caps,A,S,D,F,G,H,J,K,L', '第四行 Caps + A–L')
  assert(rows[3].at(-1).value === 'ENTER', '第四行末键是 Enter')
  assert(rows[3][0].kind === 'mod' && rows[3][0].value === 'CAPS', 'Caps 是锁定键而不是发送文本 CAPS 的普通键')
  assert(rows[4][0].value === 'SHIFT', '第五行首键是 Shift')
  assert(rows[4].at(-1).value === 'RIGHT' && rows[4].at(-1).label === '→', '第五行末键是右方向键')
  assert(rows[5].some((k) => k.value === 'SPACE' && k.flex === 4), '第六行有加宽空格键')
  assert(rows[5][0].value === 'CTRL' && rows[5][1].value === 'ALT', '第六行 Ctrl / Alt 是粘滞修饰键')
}

/* ---------- 2. 修饰键与功能键序列 ---------- */
{
  const parsed = vk.keyboardActions(settings.parseKey)
  const by = (name, kind = null) =>
    parsed.flat().find((k) => (kind === null || k.kind === kind) && (k.name === name || k.value === name))
  const seq = (name, sticky = [], kind = null) => vk.actionSequence(by(name, kind), sticky, settings.sequenceFor)

  assert(seq('c', ['CTRL']) === '\x03', 'Ctrl → C 发控制字节')
  assert(seq('x', ['ALT']) === '\x1bx', 'Alt → x 前置 ESC')
  assert(seq('1', ['SHIFT']) === '!', 'Shift → 1 发 !')
  assert(seq('a', ['CAPS']) === 'A', 'Caps → a 发 A')
  assert(seq('b', ['CAPS']) === 'B', 'Caps 锁定可连续作用多个字母')
  assert(seq('F1') === '\x1bOP', 'F1 发 SS3 P')
  assert(seq('F5') === '\x1b[15~', 'F5 发 CSI 15~')
  assert(seq('RIGHT') === '\x1b[C', '右方向键发 CSI C')
  assert(seq('SPACE') === ' ', '空格发普通空格')
  assert(seq('RIGHT', ['ALT']) === '\x1b[1;3C', 'Alt → 方向键发 CSI 修饰参数')
  assert(settings.sequenceFor(settings.parseKey('C'), ['CTRL']) === '\x03', '大写 C 的 Ctrl 组合一致')
}

/* ---------- 3. 粘滞状态机 ---------- */
{
  assert(vk.toggleSticky([], 'CTRL').join(',') === 'CTRL', '点修饰键 → 点亮')
  assert(vk.toggleSticky(['CTRL'], 'CTRL').length === 0, '再点自己 → 取消')
  assert(vk.toggleSticky(['CTRL'], 'ALT').join(',') === 'CTRL,ALT', '多个修饰键可叠加')
  assert(!vk.isSendable({ kind: 'ime' }), 'IME 入口不发送 PTY 字节')
  assert(vk.isSendable({ kind: 'mod' }), '修饰键是有效动作')
  assert(vk.actionSequence({ kind: 'ime' }, [], settings.sequenceFor) === '', 'IME 动作序列为空字符串')
  assert(vk.consumeSticky(['CTRL', 'CAPS']).join(',') === 'CAPS', '一次按键后只留下锁定的 Caps')
  assert(vk.consumeSticky(['CTRL', 'ALT', 'SHIFT']).length === 0, 'Ctrl/Alt/Shift 用后即消')
  assert(vk.consumeSticky(undefined).length === 0, 'consumeSticky 容忍空值')
}

/* ---------- 4. 窄屏判定与任务栏顶替 ---------- */
{
  const win = (w) => ({ innerWidth: w, visualViewport: { width: w } })
  assert(!kb.isNarrowViewport(null), '无 window → 不显示（安全默认）')
  assert(kb.isNarrowViewport(win(360)), '360px → 窄屏')
  assert(kb.isNarrowViewport(win(768)), '768px 边界 → 窄屏')
  assert(!kb.isNarrowViewport(win(769)), '769px → 宽屏')
  assert(!kb.isNarrowViewport({ innerWidth: 360, visualViewport: { width: 900 } }),
    'visualViewport 宽度优先于 innerWidth')

  const set = (o) => Object.assign(state, o)
  set({ view: 'term', mobileKeyboard: true, imeActive: false })
  assert(kb.keyBarVisible.value && !kb.taskbarVisible.value, '窄屏终端 → 内置键盘顶替任务栏')
  set({ view: 'files' })
  assert(!kb.keyBarVisible.value && kb.taskbarVisible.value, '非终端视图 → 任务栏照旧')
  set({ view: 'term', mobileKeyboard: false })
  assert(!kb.keyBarVisible.value, '宽屏终端 → 不弹内置键盘')
  set({ view: 'term', mobileKeyboard: true, imeActive: true })
  assert(!kb.keyBarVisible.value && kb.taskbarVisible.value, '系统输入法接管 → 键盘收起、任务栏回来')
  set({ view: 'files', mobileKeyboard: false, imeActive: false })
}

/* ---------- 5. inputmode 抑制/释放 ---------- */
const fakeTextarea = () => {
  const attrs = new Map()
  const ta = {
    attrs,
    focusCount: 0,
    blurCount: 0,
    style: {},
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    focus: () => { ta.focusCount++ },
    blur: () => { ta.blurCount++ },
  }
  ta.parentElement = { style: {}, parentElement: null }
  return ta
}

/* 伪造一个多终端层文档：layers[].visible=false 表示该层的内联 display 是 none */
const fakeDoc = (layers) => ({
  querySelectorAll: () => layers.map((l) => l.ta),
  querySelector: () => layers.find((l) => l.visible)?.ta || null,
})

{
  const ta = fakeTextarea()
  inputmode.applyInputMode(ta, true)
  assert(ta.attrs.get('inputmode') === 'none', '抑制系统键盘时写 inputmode=none')
  inputmode.applyInputMode(ta, false)
  assert(!ta.attrs.has('inputmode'), '释放系统键盘时移除 inputmode')
  inputmode.applyInputMode(null, true) // 不应抛错

  const hidden = fakeTextarea()
  hidden.parentElement.style.display = 'none'
  const shown = fakeTextarea()
  assert(inputmode.isElementVisible(shown), '内联 display 未隐藏 → 可见')
  assert(!inputmode.isElementVisible(hidden), '祖先层 display:none → 不可见（后台标签）')
  const doc = fakeDoc([{ ta: hidden, visible: false }, { ta: shown, visible: true }])
  assert(inputmode.visibleTerminalTextarea(doc) === shown, '只选中可见终端层的 textarea')
}

/* ---------- 6. 系统输入法与内置键盘互切 ---------- */
{
  const visible = fakeTextarea()
  const hidden = fakeTextarea()
  hidden.parentElement.style.display = 'none'
  const doc = fakeDoc([{ ta: hidden, visible: false }, { ta: visible, visible: true }])
  Object.assign(state, { view: 'term', mobileKeyboard: true, imeActive: false })

  ime.openIme(doc, null)
  assert(state.imeActive === true, '打开系统输入法时置 imeActive')
  assert(!visible.attrs.has('inputmode'), '打开系统输入法时释放可见 textarea 的 inputmode')
  assert(visible.focusCount === 1, '打开系统输入法时聚焦可见 xterm textarea')
  assert(hidden.focusCount === 0, '后台标签的 textarea 不被聚焦')
  assert(state.keyboardInset === 0, '打开系统输入法时清空软键盘遮挡高度')

  ime.openBuiltIn(doc, null)
  assert(state.imeActive === false, '切回内置键盘时清掉 imeActive')
  assert(visible.attrs.get('inputmode') === 'none', '切回内置键盘时重新抑制系统键盘')
  assert(visible.blurCount === 1, '切回内置键盘时先失焦，确保系统键盘真的收起')

  /* 离开终端视图 / 切标签 / 会话结束的统一收尾 */
  Object.assign(state, { imeActive: true, view: 'files', mobileKeyboard: true })
  const blurBeforeReset = visible.blurCount
  ime.resetImeState(doc)
  assert(state.imeActive === false, 'resetImeState 退出系统输入法')
  assert(visible.blurCount === blurBeforeReset + 1, '离开终端时输入框失焦，系统键盘不会跟着切走')
  assert(!visible.attrs.has('inputmode'), '非终端视图不再抑制系统键盘')

  /* 宽屏：内置键盘不出现，也不该保留 inputmode=none */
  Object.assign(state, { view: 'term', mobileKeyboard: false, imeActive: false })
  ime.syncInputModes(doc)
  assert(!visible.attrs.has('inputmode'), '宽屏终端不抑制系统键盘')
  Object.assign(state, { view: 'term', mobileKeyboard: true, imeActive: false })
  ime.syncInputModes(doc)
  assert(visible.attrs.get('inputmode') === 'none', '窄屏终端抑制系统键盘')
  Object.assign(state, { view: 'files' })
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')

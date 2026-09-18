/* 移动端内置键盘的固定布局与动作判定。
 *
 * 布局按终端惯例复刻参考图：六行、QWERTY 主键区，图片中含糊的键位解释为
 *   - 第三行首键 = Tab
 *   - 第四行首键 = Caps Lock
 *   - En = Enter
 *   - A/T = Alt
 *   - 右下角箭头 = 右方向键
 * 右下角原来的 Ctrl 改为系统输入法入口，避免内置键盘与系统键盘互相打架。
 *
 * 这里只负责“有哪些键、键被点后是什么动作”；字节序列仍由 settings.js 的
 * parseKey / sequenceFor 统一解析，输入法切换由 KeyboardBar 组件处理。
 */

/* 按键类型：char 直接发字符；named 走终端转义序列；mod 是粘滞修饰键；
 * ime 只切换系统输入法，不向 PTY 发送任何字节。 */
export const IME_KEY = 'SYS_IME'

/* 图片中的键面文字与内部键名分开：F1 这类键名直接作为 named 键，
 * 字符键的键面会显示 Shift 后的第二字符（如 1!）。 */
function charKey(value, label = value) {
  return { kind: 'char', value, label }
}

function namedKey(value, label = value) {
  return { kind: 'named', value, label }
}

function modKey(value, label = value) {
  return { kind: 'mod', value, label }
}

function imeKey() {
  return { kind: 'ime', value: IME_KEY, label: '输入法', icon: 'keyboard', flex: 2 }
}

function row(...keys) {
  return keys
}

const digitChars = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const shiftedDigits = ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')']

/* 固定六行布局。所有键都带一个稳定 id，Vue 渲染和测试都不依赖数组下标。 */
export const KEYBOARD_ROWS = [
  row(
    namedKey('ESC', 'Esc'),
    ...Array.from({ length: 12 }, (_, i) => namedKey('F' + (i + 1))),
  ),
  row(
    charKey('`', '`~'),
    ...digitChars.map((d, i) => charKey(d, d + shiftedDigits[i])),
    charKey('-', '-_'),
    charKey('=', '=+'),
    namedKey('BACKSPACE', '←'),
  ),
  row(
    namedKey('TAB', 'Tab'),
    ...['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map((c) => charKey(c.toLowerCase(), c)),
    charKey('[', '[{'),
    charKey(']', ']}'),
    charKey('\\', '\\|'),
  ),
  row(
    modKey('CAPS', 'Caps'),
    ...['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'].map((c) => charKey(c.toLowerCase(), c)),
    charKey(';', ';:'),
    charKey("'", "'\""),
    namedKey('ENTER', 'Enter'),
  ),
  row(
    modKey('SHIFT', 'Shift'),
    ...['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map((c) => charKey(c.toLowerCase(), c)),
    charKey(',', ','),
    charKey('.', '.>'),
    charKey('/', '/?'),
    namedKey('RIGHT', '→'),
  ),
  row(
    modKey('CTRL', 'Ctrl'),
    modKey('ALT', 'A/T'),
    /* 空格：键面留空（图片里就是一条空白键），但无障碍名不能为空 */
    { kind: 'named', value: 'SPACE', label: '', wide: true, flex: 4, aria: '空格' },
    imeKey(),
  ),
]

/* 将固定布局扁平化成解析后的按键列表；named/mod 键沿用 settings.js 的规范名。 */
export function keyboardActions(parseKey) {
  return KEYBOARD_ROWS.map((r) =>
    r.map((k) => {
      if (k.kind === 'ime') return { ...k, spec: null, mod: null, mods: [] }
      if (k.kind === 'mod') {
        const parsed = parseKey(k.value)
        return { ...k, name: parsed?.name || k.value, mod: parsed?.mod || k.value, mods: [] }
      }
      const parsed = parseKey(k.value)
      return {
        ...k,
        name: parsed?.name || k.value,
        spec: parsed?.spec || null,
        mod: null,
        mods: parsed?.mods || [],
      }
    }),
  )
}

/* 粘滞修饰键与普通键组合后是否真的要发送。IME 键永远不发送。 */
export function isSendable(action) {
  return !!action && action.kind !== 'ime' && (action.kind === 'mod' || !!action.spec)
}

/* 粘滞修饰键：点击自己一次点亮，再点一次取消；点击普通键后消费掉。
 * CAPS 是锁定键（与真实键盘一致）：一直生效到再点一次，
 * 因此 consumeSticky 只清掉 Ctrl / Alt / Shift。
 * 参数与返回都是新数组，便于 Vue 响应式状态直接替换。 */
export const LATCHING_MODS = ['CAPS']

/* 一次普通按键发送后，剩下该继续生效的修饰键（只有锁定键） */
export function consumeSticky(sticky) {
  return (Array.isArray(sticky) ? sticky : []).filter((m) => LATCHING_MODS.includes(m))
}
export function toggleSticky(sticky, mod) {
  const next = Array.isArray(sticky) ? sticky.slice() : []
  const i = next.indexOf(mod)
  if (i >= 0) next.splice(i, 1)
  else next.push(mod)
  return next
}

/* 计算一次普通按键的实际发送序列；IME 键返回空字符串。 */
export function actionSequence(action, sticky, sequenceFor) {
  if (!isSendable(action) || action.kind === 'mod') return ''
  return sequenceFor(action, sticky)
}

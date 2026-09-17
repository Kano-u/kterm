/* 用户设置：唯一真源是服务端 <root>/.kfm-settings.json，前端在内存里缓存一份。
 *
 * 本模块只依赖 api.js / toast.js，不依赖终端模块（避免循环导入）。
 * 「键盘增强」的按键栏数据来自 settings.keys；每个按键名在这里解析为
 * 字节序列（见 parseKey / sequenceOf），按键栏组件只负责渲染与点击。
 */
import { reactive, computed } from 'vue'
import { apiGet, apiOp } from './api.js'
import { toast } from './toast.js'

/* ---------- 规模上限（与服务端 ValidateSettings 保持一致） ---------- */

export const MAX_ROWS = 8
export const MAX_PER_ROW = 24
export const MAX_KEY_LEN = 24
export const MAX_STARTUP_LEN = 512

/* 启动命令模板中的服务地址占位符（与服务端 fs.URLPlaceholder 一致） */
export const URL_PLACEHOLDER = '{url}'

/* ---------- 默认设置：两行移动端终端常用键 ---------- */

export const DEFAULT_KEYS = [
  ['ESC', 'TAB', 'CTRL', 'ALT', '-', 'UP', 'ENTER'],
  ['INS', 'END', 'SHIFT', ':', 'LEFT', 'DOWN', 'RIGHT'],
]

export const DEFAULT_KEY_TEXT = JSON.stringify(DEFAULT_KEYS, null, 2)

/* 当前设置（响应式）：应用启动时从服务端拉取，失败则保持内置默认 */
export const settings = reactive({
  keys: DEFAULT_KEYS.map((r) => r.slice()),
  keyBarEnabled: true, // 键盘增强总开关（设置页中的折叠项）
  startupCommand: '', // 启动命令模板（空 = 启动时不执行任何东西）
  loaded: false,
})

/* 解析后的按键栏数据：[[{name,label,mod,spec}, ...], ...] */
export const keyRows = computed(() => parseRows(settings.keys))

export function applySettings(s) {
  if (!s) return
  if (Array.isArray(s.keys) && s.keys.length) {
    settings.keys = s.keys.map((row) => (Array.isArray(row) ? row.map(String) : []))
  }
  settings.keyBarEnabled = s.keyBarEnabled !== false
  settings.startupCommand = typeof s.startupCommand === 'string' ? s.startupCommand : ''
}

/* 启动时拉取设置：任何失败都退回内置默认，不阻塞主流程 */
export async function loadSettings() {
  try {
    const res = await apiGet('/api/settings')
    applySettings(res.settings)
    if (res.warning) toast(res.warning)
  } catch (err) {
    toast('读取设置失败，已使用默认设置：' + err.message)
  } finally {
    settings.loaded = true
  }
}

/* 保存设置：服务端校验通过后回落盘结果，并即时生效（终端无需重连）。
 *
 * 「部分更新」语义由这里保证：未提供的字段取当前生效值，
 * 因此单独保存键盘页不会把启动命令清空（服务端整包覆盖）。 */
export async function saveSettings(next) {
  const body = {
    keys: next.keys ?? settings.keys,
    keyBarEnabled: (next.keyBarEnabled ?? settings.keyBarEnabled) !== false,
    startupCommand: next.startupCommand ?? settings.startupCommand,
  }
  const res = await apiOp('/api/settings', body)
  applySettings(res.settings)
  return settings
}

/* ========== 启动命令（启动时自动执行，例如 termux-open-url） ==========
 *
 * 模板按空白拆分为 argv，支持单/双引号包裹含空格的参数；
 * 其中的 {url} 替换为服务地址，没有 {url} 时把地址追加到末尾。
 * 命令不经过 shell，因此管道/重定向等元字符不会被解释。 */

/* 解析结果：{argv} 或 {error}（中文提示）。空模板 → {argv: []} */
export function parseStartupCommand(text, url = 'http://127.0.0.1:8080') {
  const src = String(text ?? '').trim()
  if (!src) return { argv: [] }
  if ([...src].length > MAX_STARTUP_LEN) {
    return { error: `启动命令过长（最多 ${MAX_STARTUP_LEN} 字）` }
  }
  if (/[\r\n\0]/.test(src)) return { error: '启动命令不能包含换行' }

  const argv = []
  let cur = ''
  let started = false
  let inSingle = false
  let inDouble = false
  const flush = () => {
    if (!started) return
    argv.push(cur)
    cur = ''
    started = false
  }
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inSingle) {
      if (c === "'") inSingle = false
      else cur += c
      continue
    }
    if (inDouble) {
      if (c === '"') inDouble = false
      else if (c === '\\' && (src[i + 1] === '"' || src[i + 1] === '\\')) cur += src[++i]
      else cur += c
      continue
    }
    if (c === "'") { inSingle = true; started = true; continue }
    if (c === '"') { inDouble = true; started = true; continue }
    if (c === ' ' || c === '\t') { flush(); continue }
    cur += c
    started = true
  }
  if (inSingle || inDouble) return { error: '启动命令的引号没有闭合' }
  flush()
  if (!argv.length || argv[0] === '') return { error: '启动命令为空' }

  let hasPlaceholder = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].includes(URL_PLACEHOLDER)) {
      hasPlaceholder = true
      argv[i] = argv[i].split(URL_PLACEHOLDER).join(url)
    }
  }
  if (!hasPlaceholder && url) argv.push(url)
  return { argv }
}

/* argv → 展示文本（预览用；含空格/引号的参数加引号） */
export function argvToText(argv) {
  return (argv || [])
    .map((a) => (/[\s'"]/.test(a) ? '"' + a.replace(/(["\\])/g, '\\$1') + '"' : a))
    .join(' ')
}

/* ========== 按键名 → 字节序列 ========== */

/* 可粘滞的修饰键 */
const MOD_NAMES = { CTRL: 'CTRL', CONTROL: 'CTRL', ALT: 'ALT', SHIFT: 'SHIFT' }

/* 别名 → 规范名（大小写不敏感） */
const ALIASES = {
  ESC: 'ESC', ESCAPE: 'ESC',
  TAB: 'TAB',
  ENTER: 'ENTER', RETURN: 'ENTER',
  UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT',
  INS: 'INS', INSERT: 'INS', END: 'END', HOME: 'HOME',
  DEL: 'DEL', DELETE: 'DEL',
  PGUP: 'PGUP', PAGEUP: 'PGUP', PGDN: 'PGDN', PAGEDOWN: 'PGDN',
  BACKSPACE: 'BACKSPACE', BS: 'BACKSPACE', SPACE: 'SPACE',
}

/* 无修饰键时各功能键的字节序列 */
const NAMED_SEQ = {
  ESC: '\x1b',
  TAB: '\t',
  ENTER: '\r',
  BACKSPACE: '\x7f',
  SPACE: ' ',
  UP: '\x1b[A', DOWN: '\x1b[B', RIGHT: '\x1b[C', LEFT: '\x1b[D',
  HOME: '\x1b[H', END: '\x1b[F',
  INS: '\x1b[2~', DEL: '\x1b[3~', PGUP: '\x1b[5~', PGDN: '\x1b[6~',
}

/* 带修饰键时改用 xterm 惯用的数字参数形式（CSI 1;<mod><final> / CSI <n>;<mod>~） */
const CSI_FINAL = { UP: 'A', DOWN: 'B', RIGHT: 'C', LEFT: 'D', HOME: 'H', END: 'F' }
const CSI_TILDE = { INS: 2, DEL: 3, PGUP: 5, PGDN: 6 }

/* Shift 后字符的北美键盘映射（仅单字符键需要） */
const SHIFT_SYMBOLS = {
  '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*',
  '9': '(', '0': ')', '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|',
  ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '`': '~',
}

/* 单字符的 ctrl 组合结果；无法映射时返回 null */
function ctrlChar(ch) {
  if (ch === ' ') return '\x00'
  if (ch === '?') return '\x7f'
  const c = ch.charCodeAt(0)
  if ((c >= 0x40 && c < 0x7f) || (c >= 0x61 && c <= 0x7a)) {
    return String.fromCharCode(c & 0x1f)
  }
  return null
}

function shiftChar(ch) {
  if (ch.length === 1) {
    if (ch >= 'a' && ch <= 'z') return ch.toUpperCase()
    if (SHIFT_SYMBOLS[ch]) return SHIFT_SYMBOLS[ch]
  }
  return ch
}

/* spec: {kind:'char'|'named'|'text', value} + mods */
function sequenceOf(spec, mods) {
  const has = (m) => mods.includes(m)
  if (spec.kind === 'named') {
    const name = spec.value
    if (mods.length && (CSI_FINAL[name] || CSI_TILDE[name])) {
      const mod = 1 + (has('SHIFT') ? 1 : 0) + (has('ALT') ? 2 : 0) + (has('CTRL') ? 4 : 0)
      return CSI_TILDE[name]
        ? `\x1b[${CSI_TILDE[name]};${mod}~`
        : `\x1b[1;${mod}${CSI_FINAL[name]}`
    }
    const seq = NAMED_SEQ[name] ?? name
    return has('ALT') ? '\x1b' + seq : seq
  }
  // char / text
  let out = spec.value
  if (spec.kind === 'char' && has('SHIFT')) out = shiftChar(out)
  if (has('CTRL')) {
    const c = spec.kind === 'char' ? ctrlChar(out) : null
    if (c !== null) out = c
  }
  return has('ALT') ? '\x1b' + out : out
}

/* 解析「单个键」（不含 + 组合写法）：返回 {name, spec} */
function parseSingle(tok) {
  const chars = [...tok]
  if (chars.length === 1) return { name: tok, spec: { kind: 'char', value: tok } }
  const canonical = ALIASES[tok.toUpperCase()]
  if (canonical) return { name: canonical, spec: { kind: 'named', value: canonical } }
  // 未知的多字符名：原样发送（例如 F1 → 发送 "F1"）
  return { name: tok, spec: { kind: 'text', value: tok } }
}

/**
 * 解析一个按键名。返回值：
 *   {name, label, mod}                 粘滞修饰键（CTRL / ALT / SHIFT）
 *   {name, label, mod:null, spec, mods} 普通键（mods 为内建组合，如 CTRL+C）
 * 无法解析（空）时返回 null。
 */
export function parseKey(rawName) {
  const raw = String(rawName ?? '').trim()
  if (!raw) return null
  if ([...raw].length === 1) {
    const s = parseSingle(raw)
    return { name: s.name, label: s.name, mod: null, spec: s.spec, mods: [] }
  }
  const upper = raw.toUpperCase()
  if (MOD_NAMES[upper]) {
    return { name: MOD_NAMES[upper], label: MOD_NAMES[upper], mod: MOD_NAMES[upper] }
  }
  // 组合写法：CTRL+C、CTRL+ALT+DEL
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length > 1) {
    const mods = []
    let allMods = true
    for (const p of parts.slice(0, -1)) {
      const m = MOD_NAMES[p.toUpperCase()]
      if (m) mods.push(m)
      else { allMods = false; break }
    }
    const last = parts[parts.length - 1]
    if (allMods && mods.length && last) {
      const inner = parseSingle(last)
      const name = mods.join('+') + '+' + inner.name
      return { name, label: name, mod: null, spec: inner.spec, mods }
    }
  }
  const s = parseSingle(raw)
  return { name: s.name, label: s.name, mod: null, spec: s.spec, mods: [] }
}

/* 一个按键在给定粘滞修饰键下实际发送的字节序列 */
export function sequenceFor(parsed, sticky = []) {
  if (!parsed || parsed.mod || !parsed.spec) return ''
  return sequenceOf(parsed.spec, [...parsed.mods, ...sticky])
}

/* 键盘布局（二维名字数组）→ 解析后的行 */
export function parseRows(keys) {
  if (!Array.isArray(keys)) return []
  return keys.map((row) =>
    (Array.isArray(row) ? row : []).map(parseKey).filter(Boolean),
  )
}

/* 解析后的行 → 规范化文本（保存后回填文本框用） */
export function rowsToText(rows) {
  return JSON.stringify(rows.map((row) => row.map((k) => k.name)), null, 2)
}

/* ========== 设置页的文本 <-> 布局 互转 ========== */

/* 宽容化：把单引号/反引号字符串转成双引号，并去掉尾随逗号。
 * 逐字符扫描，跳过字符串内部，避免误改内容里的引号。 */
function relaxText(src) {
  let out = ''
  let quote = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') {
        out += c + (src[i + 1] ?? '')
        i++
        continue
      }
      if (c === quote) quote = null
      out += c
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      out += '"'
      continue
    }
    out += c
  }
  return out.replace(/,(\s*[\]}])/g, '$1')
}

/**
 * 解析设置页文本框内容。
 * 返回 {rows} 或 {error}（error 为中文提示）。
 * 允许单引号 / 换行缩进 / 尾随逗号；按键名大小写不敏感。
 */
export function parseKeyText(text) {
  const src = String(text ?? '').trim()
  if (!src) return { error: '按键设置不能为空' }
  let data
  try {
    data = JSON.parse(src)
  } catch {
    try {
      data = JSON.parse(relaxText(src))
    } catch {
      return { error: '格式错误：应为形如 [["ESC","TAB"],["UP","DOWN"]] 的二维数组' }
    }
  }
  if (!Array.isArray(data)) return { error: '最外层必须是数组：每一行是一个按键数组' }
  if (data.length === 0) return { error: '至少需要一行按键' }
  if (data.length > MAX_ROWS) return { error: `按键行数过多（最多 ${MAX_ROWS} 行）` }

  const rows = []
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    if (!Array.isArray(row)) return { error: `第 ${i + 1} 行不是数组` }
    if (row.length === 0) return { error: `第 ${i + 1} 行没有任何按键` }
    if (row.length > MAX_PER_ROW) return { error: `第 ${i + 1} 行按键过多（每行最多 ${MAX_PER_ROW} 个）` }
    const out = []
    for (let j = 0; j < row.length; j++) {
      const item = row[j]
      if (typeof item !== 'string') return { error: `第 ${i + 1} 行第 ${j + 1} 个按键名必须是字符串` }
      if (/\s/.test(item)) return { error: `第 ${i + 1} 行第 ${j + 1} 个按键名不能包含空白字符` }
      const parsed = parseKey(item)
      if (!parsed) return { error: `第 ${i + 1} 行第 ${j + 1} 个按键名为空` }
      if ([...parsed.name].length > MAX_KEY_LEN) {
        return { error: `按键名过长（最多 ${MAX_KEY_LEN} 字）：${parsed.name}` }
      }
      out.push(parsed)
    }
    rows.push(out)
  }
  return { rows }
}

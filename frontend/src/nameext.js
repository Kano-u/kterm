/* 新建面板的「常用扩展名」快捷块。
 *
 * 手机上敲出 `.json` 要在软键盘上切两次布局，所以给一排一点即得的扩展名。
 * 点击的语义只有一条：**把扩展名填进输入框，不创建任何东西**（创建仍旧由
 * 「文件」按钮触发，避免误触直接落盘）。
 *
 * applyExt 的规则（纯函数，便于单测）：
 *   - 输入框末尾已有扩展名 → 替换它（`note.txt` + `.md` → `note.md`）；
 *   - 否则追加（`note` + `.md` → `note.md`；空输入 + `.md` → `.md`）；
 *   - 以点开头的隐藏文件名（`.gitignore`）不算「有扩展名」，按追加处理，
 *     否则会被换成 `.md` 而丢掉名字；
 *   - 光标一律停在**主名末尾**（扩展名之前），这样「打主名 → 点扩展名 →
 *     接着打主名」都顺手，不会把新字符打到扩展名后面。
 */

/* 内置的常用扩展名（与 editor-lang.js 的语法包/纯文本判定一致，
 * 这几种都能在编辑器里正常打开）。 */
export const EXT_PRESETS = ['.txt', '.md', '.json', '.py', '.css']

const PRESET_SET = new Set(EXT_PRESETS)

/* 末尾扩展名的起始下标；返回 -1 表示「没有可替换的扩展名」。
 * 点必须在首位之后（排除 .gitignore 这类隐藏文件名），且点后不能再有斜杠
 * （排除 `a.b/c` 这种把目录名里的点误当扩展名的情况）。 */
export function extStart(value) {
  const s = String(value ?? '')
  const i = s.lastIndexOf('.')
  if (i <= 0) return -1
  if (s.slice(i).includes('/') || s.slice(i).includes('\\')) return -1
  return i
}

/**
 * 把扩展名应用到当前输入内容。
 * @returns {{value: string, caret: number}} 新内容 + 建议的光标位置
 */
export function applyExt(value, ext) {
  const base = String(value ?? '')
  const e = String(ext ?? '')
  // 输入框里当前就只有某个快捷扩展名（先点了 .txt 又想改成 .md）→ 整个换掉，
  // 否则会被当成隐藏文件名而追加成 '.txt.md'。
  if (PRESET_SET.has(base)) return { value: e, caret: 0 }
  const i = extStart(base)
  const name = i > 0 ? base.slice(0, i) : base
  return { value: name + e, caret: name.length }
}

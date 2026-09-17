/* 编辑器语言映射 + 自写的 M3 深色主题。
 *
 * 语言包与主题样式全部通过动态 import 懒加载：只有真正打开编辑器时才下载，
 * 首屏（文件列表 `/api/list` 视图）零开销。Vite 的 `import()` 天然 code-split。
 */

/* 超过此大小关闭语法高亮（纯文本编辑），保证大文件的输入流畅度。
 * 与 editor.js 的 highlight 判定共用。 */
export const HIGHLIGHT_MAX = 512 << 10 // 512 KiB

/* ---------- 扩展名 → 语言（懒加载器） ---------- */

const LOADERS = {
  js: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  mjs: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  cjs: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  ts: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  tsx: () =>
    import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true, jsx: true })),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  md: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  htm: () => import('@codemirror/lang-html').then((m) => m.html()),
  vue: () => import('@codemirror/lang-html').then((m) => m.html()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  scss: () => import('@codemirror/lang-css').then((m) => m.css()),
  less: () => import('@codemirror/lang-css').then((m) => m.css()),
  py: () => import('@codemirror/lang-python').then((m) => m.python()),
  pyw: () => import('@codemirror/lang-python').then((m) => m.python()),
  go: () => import('@codemirror/lang-go').then((m) => m.go()),
  c: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  h: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  hpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  cc: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  cpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  cxx: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  java: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
}

/* 无语法包、但明确是纯文本的扩展名（入口按钮据此放行） */
const PLAIN_EXTS = new Set([
  'txt', 'log', 'csv', 'tsv', 'ini', 'conf', 'cfg', 'toml', 'yaml', 'yml', 'xml',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'sql', 'env', 'gitignore',
  'gitattributes', 'editorconfig', 'dockerfile', 'makefile', 'mk', 'diff', 'patch',
  'properties', 'lock', 'sum', 'mod', 'rs', 'rb', 'php', 'pl', 'lua', 'kt', 'kts',
  'swift', 'dart', 'scala', 'clj', 'ex', 'exs', 'hs', 'ml', 'r', 'tex', 'vue',
])

/* 无扩展名的文本文件名（常见项目文件） */
const PLAIN_NAMES = new Set([
  'makefile', 'dockerfile', 'license', 'readme', 'changelog', 'authors',
  '.gitignore', '.gitattributes', '.editorconfig', '.env', '.npmrc', '.prettierrc',
  '.eslintrc', '.babelrc', '.dockerignore', '.bashrc', '.zshrc', '.profile',
])

/* 扩展名（小写，不含点） */
export function extOf(name) {
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase()
}

/* 是否为可编辑的文本文件（EntrySheet 的「编辑」入口判定）。
 * 图片等已知二进制类型直接拒绝；未知扩展名按文本放行——真正的二进制探测在服务端。 */
export function isTextName(name) {
  if (!name) return false
  const lower = name.toLowerCase()
  if (PLAIN_NAMES.has(lower)) return true
  const ext = extOf(name)
  if (ext === '') return false
  if (LOADERS[ext] || PLAIN_EXTS.has(ext)) return true
  // 已知二进制扩展名：明确拒绝
  if (/^(png|jpe?g|gif|webp|bmp|svg|ico|heic|heif|tiff?|mp[34]|m4a|wav|flac|ogg|opus|avi|mkv|mov|webm|zip|gz|tgz|bz2|xz|7z|rar|tar|jar|apk|ipa|exe|dll|so|dylib|bin|dat|db|sqlite|pdf|doc[xm]?|xls[xm]?|ppt[xm]?|woff2?|ttf|otf|eot|class|o|a|obj|pdb|wasm)$/.test(ext)) {
    return false
  }
  return true
}

/* 按文件名加载语言扩展；无匹配返回 null（纯文本）。任何加载失败都降级为纯文本。 */
export async function languageFor(name) {
  const loader = LOADERS[extOf(name)]
  if (!loader) return null
  try {
    return await loader()
  } catch {
    return null
  }
}

/* ---------- M3 深色主题（复用 style.css 的令牌值） ---------- */

/* 与 style.css @theme 中的颜色保持一致；改令牌时这里同步。 */
export const CM_TOKENS = {
  background: '#2e2c36', // surface-1
  foreground: '#e6e0e9', // on-surface
  caret: '#d0bcff', // primary
  selection: 'rgba(208, 188, 255, 0.28)',
  selectionMatch: 'rgba(208, 188, 255, 0.16)',
  gutter: '#2e2c36',
  gutterText: '#938f99', // outline
  activeLine: 'rgba(230, 224, 233, 0.045)',
  panel: '#34323d', // surface-2
  outline: '#5b5666', // outline-variant
  primary: '#d0bcff',
  error: '#f2b8b5',
  keyword: '#d0bcff', // primary
  string: '#b6f0c0',
  number: '#f5e0a3',
  comment: '#9c96a8',
  type: '#a7e6ea',
  func: '#c2d7ff',
  variable: '#e6e0e9',
  operator: '#cac4d0',
  invalid: '#ffb4ab',
}

/* 主题样式的类名统一前缀，便于测试与覆盖 */
export const CM_THEME_SPECS = [
  { tag: 'keyword', color: CM_TOKENS.keyword },
  { tag: 'string', color: CM_TOKENS.string },
  { tag: 'number', color: CM_TOKENS.number },
  { tag: 'comment', color: CM_TOKENS.comment },
  { tag: 'typeName', color: CM_TOKENS.type },
  { tag: 'function', color: CM_TOKENS.func },
]

/* 构建 CM 主题扩展（动态 import；调用方在挂载编辑器时 await 一次）。
 * 不引 @codemirror/theme-one-dark：这里 ~60 行即可对齐 M3 深色令牌。 */
export async function m3Theme() {
  const [{ EditorView }, { HighlightStyle, syntaxHighlighting }, { tags }] = await Promise.all([
    import('@codemirror/view'),
    import('@codemirror/language'),
    import('@lezer/highlight'),
  ])
  const theme = EditorView.theme(
    {
      '&': { color: CM_TOKENS.foreground, backgroundColor: CM_TOKENS.background, height: '100%' },
      '.cm-content': { caretColor: CM_TOKENS.caret, padding: '8px 0' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: CM_TOKENS.caret, borderLeftWidth: '2px' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: CM_TOKENS.selection,
      },
      '.cm-selectionMatch': { backgroundColor: CM_TOKENS.selectionMatch },
      '.cm-activeLine': { backgroundColor: CM_TOKENS.activeLine },
      '.cm-gutters': {
        backgroundColor: CM_TOKENS.gutter,
        color: CM_TOKENS.gutterText,
        border: 'none',
        borderRight: '1px solid ' + CM_TOKENS.outline,
      },
      '.cm-activeLineGutter': { backgroundColor: CM_TOKENS.activeLine, color: CM_TOKENS.foreground },
      '.cm-foldPlaceholder': {
        backgroundColor: CM_TOKENS.panel,
        border: '1px solid ' + CM_TOKENS.outline,
        color: CM_TOKENS.foreground,
      },
      '.cm-panels': {
        backgroundColor: CM_TOKENS.panel,
        color: CM_TOKENS.foreground,
        border: 'none',
      },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid ' + CM_TOKENS.outline },
      '.cm-panel input, .cm-panel button': {
        backgroundColor: CM_TOKENS.background,
        color: CM_TOKENS.foreground,
        border: '1px solid ' + CM_TOKENS.outline,
        borderRadius: '6px',
        padding: '2px 6px',
        margin: '3px',
        outline: 'none',
      },
      '.cm-panel input:focus': { borderColor: CM_TOKENS.primary },
      '.cm-searchMatch': { backgroundColor: 'rgba(245, 224, 163, 0.28)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(208, 188, 255, 0.45)' },
      '.cm-tooltip': {
        backgroundColor: CM_TOKENS.panel,
        border: '1px solid ' + CM_TOKENS.outline,
        color: CM_TOKENS.foreground,
      },
      '.cm-scroller': { fontFamily: 'ui-monospace, Consolas, "Courier New", monospace' },
      '&.cm-focused': { outline: 'none' },
    },
    { dark: true },
  )
  const highlight = HighlightStyle.define([
    { tag: tags.keyword, color: CM_TOKENS.keyword },
    { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: CM_TOKENS.foreground },
    { tag: [tags.function(tags.variableName), tags.labelName], color: CM_TOKENS.func },
    { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: CM_TOKENS.number },
    { tag: [tags.definition(tags.name), tags.separator], color: CM_TOKENS.func },
    { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: CM_TOKENS.type },
    { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: CM_TOKENS.operator },
    { tag: [tags.meta, tags.comment], color: CM_TOKENS.comment, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: CM_TOKENS.type, textDecoration: 'underline' },
    { tag: tags.heading, fontWeight: 'bold', color: CM_TOKENS.primary },
    { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: CM_TOKENS.number },
    { tag: [tags.processingInstruction, tags.string, tags.inserted], color: CM_TOKENS.string },
    { tag: tags.invalid, color: CM_TOKENS.invalid },
  ])
  return [theme, syntaxHighlighting(highlight)]
}

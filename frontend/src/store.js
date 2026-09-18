import { reactive } from 'vue'

const STATE_KEY = 'kfm-state'

export let nextTabId = 1

export function newTab(path = '') {
  return {
    id: nextTabId++,
    path, // 展示路径：'' = 起始目录 | 相对路径 | 绝对路径（'/' 分隔）
    abs: '', // 当前 path 的绝对路径（由 /api/list 附带，面包屑用）
    history: [path],
    histIdx: 0,
    cache: null, // {path, entries}
    loading: false,
  }
}

/* 记录一次目录列举结果（路径 / 绝对路径 / 条目），导航各路径共用 */
export function applyListing(tab, data) {
  tab.path = data.path || ''
  tab.abs = data.abs || ''
  tab.cache = { path: tab.path, entries: data.entries || [] }
}

export const state = reactive({
  tabs: [newTab()],
  activeTabId: 1,
  sort: { field: 'name', asc: true },
  showHidden: false,
  clipboard: null, // {mode:'copy'|'cut', srcPath, names[]}（不持久化）
  multi: { active: false, sel: new Set() }, // 多选（仅当前 tab，切换/导航时重置）
  search: { active: false, query: '', results: null, truncated: false, busy: false }, // 搜索（不持久化）
  view: 'files', // 底部任务栏视图：'files' | 'term' | 'editor' | 'settings'（不持久化）
  settingsPage: '', // 设置页内的子页：'' = 列表 | 'startup'（见 settingsnav.SETTINGS_PAGES，不持久化）
  keyboardBar: false, // 系统软键盘是否弹出（viewport.js 维护，不持久化）
  mobileKeyboard: false, // 是否窄屏（≤768px）；内置键盘显示条件之一，viewport.js 维护
  imeActive: false, // 系统输入法是否接管 xterm 隐藏输入框（不持久化）
  keyboardInset: 0, // 被软键盘遮挡的高度（px）
  terminals: new Map(), // tabId -> {status,busy,degraded,ws}（不持久化，见 terminal.js）
  editors: new Map(), // tabId -> {relPath,name,dirty,...}（不持久化，见 editor.js）
  bootError: '',
  startDir: '', // 起始目录绝对路径（/api/root，仅用于路径栏展示，不参与解析）
})

export function activeTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0]
}

/* ---------- 路径工具 ----------
 * 服务端约定：所有 path 均为 `/` 分隔的展示路径。
 *   - ''      起始目录（程序启动时的 cwd）
 *   - 'a/b'   相对起始目录的相对路径（允许 '..'，可越出起始目录）
 *   - '/a/b'  POSIX 绝对路径
 *   - 'C:/a'  Windows 绝对路径
 * 访问范围不受限，因此这里不再有「越界」概念。 */

/* Windows 盘符绝对路径（C:/…） */
export function isWinAbs(p) {
  return /^[a-zA-Z]:\//.test(p)
}

/* 任意绝对路径（POSIX / Windows） */
export function isAbsPath(p) {
  return p.startsWith('/') || isWinAbs(p)
}

/* 拼接子路径 */
export function joinPath(base, name) {
  if (!base) return name
  return base.endsWith('/') ? base + name : base + '/' + name
}

/* 上级目录：返回 null 表示已到文件系统根，没有更上一层
 * （'' 的含义是「起始目录」，不能用来表示「无上级」）。 */
export function parentPath(p) {
  if (!p) return null
  if (/^\/+$/.test(p)) return null // '/' 已是文件系统根
  const s = p.replace(/\/+$/, '')
  if (/^[a-zA-Z]:$/.test(s)) return null // C: / C:/ 盘符根
  if (isWinAbs(s)) {
    const i = s.lastIndexOf('/')
    return i <= 2 ? s.slice(0, 3) : s.slice(0, i) // C:/x → C:/
  }
  if (s.startsWith('/')) {
    if (s === '') return null // '/' 已是文件系统根
    const i = s.lastIndexOf('/')
    return i <= 0 ? '/' : s.slice(0, i)
  }
  const i = s.lastIndexOf('/')
  return i < 0 ? '' : s.slice(0, i) // 'a' 的上级是起始目录
}

/* ---------- 持久化 ---------- */

export function saveState() {
  try {
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        tabs: state.tabs.map((t) => ({ id: t.id, path: t.path, abs: t.abs, history: t.history, histIdx: t.histIdx })),
        activeTabId: state.activeTabId,
        sort: state.sort,
        showHidden: state.showHidden,
      }),
    )
  } catch {
    /* 存储不可用时忽略 */
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return false
    const s = JSON.parse(raw)
    if (!Array.isArray(s.tabs) || s.tabs.length === 0) return false
    nextTabId = s.tabs.reduce((m, t) => Math.max(m, t.id || 0), 0) + 1
    state.tabs = s.tabs.map((t) => {
      const tab = newTab(t.path || '')
      tab.id = t.id || tab.id
      tab.abs = t.abs || ''
      if (Array.isArray(t.history) && t.history.length) {
        tab.history = t.history
        tab.histIdx = Math.min(Math.max(t.histIdx || 0, 0), t.history.length - 1)
        tab.path = tab.history[tab.histIdx]
      }
      return tab
    })
    state.activeTabId = s.tabs.some((t) => t.id === s.activeTabId)
      ? s.activeTabId
      : state.tabs[0].id
    if (s.sort && s.sort.field) state.sort = { field: s.sort.field, asc: s.sort.asc !== false }
    state.showHidden = !!s.showHidden
    return true
  } catch {
    return false
  }
}

/* 恢复时校验路径是否存在，不存在回退到 root */
export async function validateRestoredTabs(apiList) {
  await Promise.all(
    state.tabs.map(async (t) => {
      try {
        const data = await apiList(t.path)
        applyListing(t, data)
      } catch {
        if (t.path !== '') {
          t.path = ''
          t.history = ['']
          t.histIdx = 0
          try {
            const data = await apiList('')
            applyListing(t, data)
          } catch {
            t.abs = ''
            t.cache = { path: '', entries: [] }
          }
        }
      }
    }),
  )
}

/* ---------- 排序（拼音 + 数字自然序，目录永远在前） ---------- */

function makeCollator() {
  const opts = { numeric: true, sensitivity: 'base' }
  for (const loc of ['zh-Hans-CN', 'zh']) {
    try {
      if (Intl.Collator.supportedLocalesOf([loc]).length) {
        return new Intl.Collator(loc, opts)
      }
    } catch {
      /* 降级 */
    }
  }
  try {
    return new Intl.Collator(opts)
  } catch {
    /* ignore */
  }
  return { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) }
}
const collator = makeCollator()

function extOf(name) {
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase() // 隐藏文件 .xx 无扩展名
}

const comparators = {
  name: (a, b) => collator.compare(a.name, b.name),
  size: (a, b) => (a.isDir ? 0 : a.size) - (b.isDir ? 0 : b.size),
  mtime: (a, b) => a.mtime - b.mtime,
  type: (a, b) => {
    const ea = a.isDir ? '' : extOf(a.name)
    const eb = b.isDir ? '' : extOf(b.name)
    if (ea === '' && eb !== '') return -1
    if (eb === '' && ea !== '') return 1
    const c = collator.compare(ea, eb)
    return c !== 0 ? c : collator.compare(a.name, b.name)
  },
}

export function sortEntries(entries, sort) {
  const cmp = comparators[sort.field] || comparators.name
  return entries.slice().sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1 // 目录永远排前
    const c = cmp(a, b)
    return sort.asc ? c : -c
  })
}

/* 当前 tab 过滤 + 排序后的可见条目。
 * 记忆化：目录上千条目时每次重渲染不必重复 filter+sort。
 * key 由缓存数组引用 + 排序参数 + 隐藏开关构成，依赖未变直接返回旧数组
 * （tab.cache 每次导航/刷新都是新数组引用，引用比较即可感知变化）。 */
let _shownKey = null
let _shownVal = []
export function shownEntries() {
  const tab = activeTab()
  const entries = tab.cache && tab.cache.path === tab.path ? tab.cache.entries : null
  const key = entries + '|' + state.sort.field + '|' + state.sort.asc + '|' + state.showHidden
  if (_shownKey === key) return _shownVal
  if (!entries) {
    _shownKey = null
    return (_shownVal = [])
  }
  const shown = entries.filter((e) => state.showHidden || !isHidden(e.name))
  _shownKey = key
  return (_shownVal = sortEntries(shown, state.sort))
}

/* ---------- 搜索 ---------- */

/* 搜索模式（搜索结果页）的可见条目：结果同样按当前排序生效。同样记忆化。 */
let _searchKey = null
let _searchVal = []
export function shownSearchResults() {
  const s = state.search
  if (!s.results) return []
  const key = s.results + '|' + state.sort.field + '|' + state.sort.asc + '|' + state.showHidden
  if (_searchKey === key) return _searchVal
  const shown = s.results.filter((h) => state.showHidden || !isHidden(h.name))
  _searchKey = key
  return (_searchVal = sortEntries(shown, state.sort))
}

export function resetSearch() {
  state.search.active = false
  state.search.query = ''
  state.search.results = null
  state.search.truncated = false
  state.search.busy = false
}

/* ---------- 多选 ---------- */

export function enterMultiSelect(firstName) {
  state.multi.active = true
  state.multi.sel.clear()
  if (firstName) state.multi.sel.add(firstName)
}

export function exitMultiSelect() {
  state.multi.active = false
  state.multi.sel.clear()
}

export function toggleSelect(name) {
  if (state.multi.sel.has(name)) state.multi.sel.delete(name)
  else state.multi.sel.add(name)
  if (state.multi.sel.size === 0) exitMultiSelect()
}

export function pruneSelection(shown) {
  if (!state.multi.active) return
  const names = new Set(shown.map((e) => e.name))
  for (const n of [...state.multi.sel]) {
    if (!names.has(n)) state.multi.sel.delete(n)
  }
  if (state.multi.sel.size === 0) exitMultiSelect()
}

/* ---------- 工具 ---------- */

export function isHidden(name) {
  return name.startsWith('.') || name === 'lost+found'
}

export function baseName(path) {
  if (!path) return state.startDir ? startDirName() : '起始目录'
  const s = path.replace(/\/+$/, '')
  if (isWinAbs(s) && /^[a-zA-Z]:$/.test(s)) return s // 盘符根
  return s.split('/').pop() || '/'
}

/* 起始目录的显示名（最后一段） */
function startDirName() {
  const s = state.startDir.replace(/[\\/]+$/, '')
  return s.split(/[\\/]/).pop() || state.startDir || '起始目录'
}
export { startDirName }

export function fmtSize(n) {
  if (n < 1024) return n + ' B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do {
    n /= 1024
    i++
  } while (n >= 1024 && i < units.length - 1)
  return n.toFixed(n >= 10 ? 0 : 1) + ' ' + units[i]
}

export function fmtTime(ms) {
  const d = new Date(ms)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

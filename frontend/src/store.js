import { reactive } from 'vue'

const STATE_KEY = 'kfm-state'

export let nextTabId = 1

export function newTab(path = '') {
  return {
    id: nextTabId++,
    path, // 相对 root 的路径（'' = root）
    history: [path],
    histIdx: 0,
    cache: null, // {path, entries}
    loading: false,
  }
}

export const state = reactive({
  tabs: [newTab()],
  activeTabId: 1,
  sort: { field: 'name', asc: true },
  showHidden: false,
  clipboard: null, // {mode:'copy'|'cut', srcPath, names[]}（不持久化）
  multi: { active: false, sel: new Set() }, // 多选（仅当前 tab，切换/导航时重置）
  search: { active: false, query: '', results: null, truncated: false, busy: false }, // 搜索（不持久化）
  view: 'files', // 底部任务栏视图：'files' | 'term' | 'settings'（不持久化）
  settingsPage: '', // 设置页内的子页：'' = 设置列表 | 'keyboard'（不持久化）
  keyboardBar: false, // 软键盘是否弹出（viewport.js 维护，不持久化）
  keyboardInset: 0, // 被软键盘遮挡的高度（px）
  terminals: new Map(), // tabId -> {status,busy,outsideRoot,ws}（不持久化，见 terminal.js）
  bootError: '',
})

export function activeTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0]
}

/* ---------- 持久化 ---------- */

export function saveState() {
  try {
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        tabs: state.tabs.map((t) => ({ id: t.id, path: t.path, history: t.history, histIdx: t.histIdx })),
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
        t.cache = { path: data.path || '', entries: data.entries || [] }
      } catch {
        if (t.path !== '') {
          t.path = ''
          t.history = ['']
          t.histIdx = 0
          try {
            const data = await apiList('')
            t.cache = { path: '', entries: data.entries || [] }
          } catch {
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

/* 当前 tab 过滤 + 排序后的可见条目 */
export function shownEntries() {
  const tab = activeTab()
  const entries = tab.cache && tab.cache.path === tab.path ? tab.cache.entries : []
  return sortEntries(
    entries.filter((e) => state.showHidden || !isHidden(e.name)),
    state.sort,
  )
}

/* ---------- 搜索 ---------- */

/* 搜索模式（搜索结果页）的可见条目：结果同样按当前排序生效 */
export function shownSearchResults() {
  const s = state.search
  if (!s.results) return []
  return sortEntries(
    s.results.filter((h) => state.showHidden || !isHidden(h.name)),
    state.sort,
  )
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
  return path ? (path.split('/').pop() || path) : '根目录'
}

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

export function iconFor(e) {
  if (e.isDir) return '📁'
  if (/\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(e.name)) return '🖼️'
  return '📄'
}

/* Tab 标题：label + dirty */
export function tabTitle(t) {
  return t.path === activeTab().path ? '' : '● '
}

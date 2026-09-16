/* kfm M1：标签页与导航历史、返回手势、localStorage 持久化、路径缓存 */
'use strict';

const STATE_KEY = 'kfm-state';
let nextTabId = 1;

function newTab(path = '') {
  return {
    id: nextTabId++,
    path,                      // 相对 root 的路径（'' = root）
    history: [path],           // 导航历史栈
    histIdx: 0,                // 当前在 history 中的位置
    cache: null,               // {path, entries} 已加载目录缓存
    search: { active: false, query: '', results: [] },
  };
}

let state = {
  tabs: [newTab()],
  activeTabId: 1,
  sort: { field: 'name', asc: true },
  showHidden: false,
};

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0];
}

/* ---------- 持久化 ---------- */

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      tabs: state.tabs.map((t) => ({ id: t.id, path: t.path, history: t.history, histIdx: t.histIdx })),
      activeTabId: state.activeTabId,
      sort: state.sort,
      showHidden: state.showHidden,
    }));
  } catch (e) { /* 存储不可用时忽略 */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!Array.isArray(s.tabs) || s.tabs.length === 0) return false;
    nextTabId = s.tabs.reduce((m, t) => Math.max(m, t.id || 0), 0) + 1;
    state.tabs = s.tabs.map((t) => {
      const tab = newTab(t.path || '');
      tab.id = t.id || tab.id;
      if (Array.isArray(t.history) && t.history.length) {
        tab.history = t.history;
        tab.histIdx = Math.min(Math.max(t.histIdx || 0, 0), t.history.length - 1);
        tab.path = tab.history[tab.histIdx];
      }
      return tab;
    });
    state.activeTabId = s.tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : state.tabs[0].id;
    if (s.sort && s.sort.field) state.sort = { field: s.sort.field, asc: s.sort.asc !== false };
    state.showHidden = !!s.showHidden;
    return true;
  } catch (e) {
    return false;
  }
}

/* 恢复时校验路径是否存在，不存在回退到 root */
async function validateRestoredTabs() {
  await Promise.all(state.tabs.map(async (t) => {
    try {
      const data = await apiList(t.path);
      t.cache = { path: data.path || '', entries: data.entries || [] };
    } catch (e) {
      if (t.path !== '') {
        t.path = '';
        t.history = [''];
        t.histIdx = 0;
        try {
          const data = await apiList('');
          t.cache = { path: '', entries: data.entries || [] };
        } catch (e2) { t.cache = { path: '', entries: [] }; }
      }
    }
  }));
}

/* ---------- API ---------- */

async function apiList(path) {
  const res = await fetch('/api/list?path=' + encodeURIComponent(path));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

/* 写操作：同步请求 + loading 遮罩 */
async function apiOp(url, body) {
  showLoading(true);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '操作失败');
    return data;
  } finally {
    showLoading(false);
  }
}

let loadingCount = 0;
function showLoading(on) {
  loadingCount += on ? 1 : -1;
  if (loadingCount < 0) loadingCount = 0;
  document.getElementById('loading').hidden = loadingCount === 0;
}

/* ---------- 通用输入对话框（M3） ---------- */

const $dialogBackdrop = document.getElementById('dialog-backdrop');
const $dialogInput = document.getElementById('dialog-input');
const $dialogTitle = document.getElementById('dialog-title');
const $dialogFileBtn = document.getElementById('dialog-file');
const $dialogDirBtn = document.getElementById('dialog-dir');

let dialogResolve = null;

/**
 * 打开输入对话框，返回 Promise<string|null>；取消时 resolve(null)。
 * opts: { title, value, selectBase, mode: 'text'|'new' }
 * mode='new' 时显示「文件/文件夹」创建按钮，resolve('file'|'dir')
 */
function promptDialog(opts) {
  $dialogTitle.textContent = opts.title || '请输入';
  $dialogInput.value = opts.value || '';
  const isNew = opts.mode === 'new';
  document.getElementById('dialog-ok').hidden = isNew;
  $dialogFileBtn.hidden = !isNew;
  $dialogDirBtn.hidden = !isNew;
  $dialogBackdrop.hidden = false;
  $dialogInput.focus();
  // 选中主名（不含扩展名），方便改名
  if (opts.selectBase) {
    const v = $dialogInput.value;
    const dot = v.lastIndexOf('.');
    $dialogInput.setSelectionRange(0, dot > 0 ? dot : v.length);
  }
  return new Promise((resolve) => { dialogResolve = resolve; });
}

function closeDialog(value) {
  $dialogBackdrop.hidden = true;
  if (dialogResolve) { dialogResolve(value); dialogResolve = null; }
}

function inputName() {
  const v = $dialogInput.value.trim();
  if (!v) { toast('名称不能为空'); return null; }
  return v;
}

document.getElementById('dialog-ok').addEventListener('click', () => {
  const v = inputName();
  if (v !== null) closeDialog(v);
});
$dialogFileBtn.addEventListener('click', () => {
  const v = inputName();
  if (v !== null) closeDialog({ name: v, kind: 'file' });
});
$dialogDirBtn.addEventListener('click', () => {
  const v = inputName();
  if (v !== null) closeDialog({ name: v, kind: 'dir' });
});
document.getElementById('dialog-cancel').addEventListener('click', () => closeDialog(null));
document.getElementById('dialog-dot').addEventListener('click', () => {
  // 在光标处插入 "." 并保持焦点
  const start = $dialogInput.selectionStart ?? $dialogInput.value.length;
  const end = $dialogInput.selectionEnd ?? start;
  $dialogInput.value = $dialogInput.value.slice(0, start) + '.' + $dialogInput.value.slice(end);
  const pos = start + 1;
  $dialogInput.setSelectionRange(pos, pos);
  $dialogInput.focus();
});
$dialogInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    // 新建模式下 Enter 默认创建文件夹
    if (!$dialogDirBtn.hidden) $dialogDirBtn.click();
    else document.getElementById('dialog-ok').click();
  }
  if (ev.key === 'Escape') closeDialog(null);
});
$dialogBackdrop.addEventListener('click', (ev) => { if (ev.target === $dialogBackdrop) closeDialog(null); });

/* ---------- 底部操作面板（M3） ---------- */

const $panelBackdrop = document.getElementById('panel-backdrop');
let panelEntry = null;

function showPanel(entry) {
  panelEntry = entry;
  document.getElementById('sheet-title').textContent = entry.name;
  document.getElementById('sheet-detail').textContent =
    (entry.isDir ? '文件夹' : '文件') + '\n大小：' + fmtSize(entry.size) + '\n修改时间：' + fmtTime(entry.mtime);
  $panelBackdrop.hidden = false;
}

function hidePanel() {
  $panelBackdrop.hidden = true;
  panelEntry = null;
}

document.getElementById('sheet-cancel').addEventListener('click', hidePanel);
$panelBackdrop.addEventListener('click', (ev) => { if (ev.target === $panelBackdrop) hidePanel(); });
document.getElementById('sheet-rename').addEventListener('click', () => {
  if (!panelEntry) return;
  const entry = panelEntry;
  hidePanel();
  renameEntry(entry);
});

async function renameEntry(entry) {
  const newName = await promptDialog({
    title: '重命名',
    value: entry.name,
    okText: '重命名',
    selectBase: true,
  });
  if (newName === null || newName === entry.name) return;
  const tab = activeTab();
  try {
    await apiOp('/api/rename', { path: tab.path, oldName: entry.name, newName });
    toast('已重命名为 ' + newName);
    await refreshActive();
  } catch (err) {
    toast(err.message);
  }
}

/* 刷新当前 tab 的列表（写操作成功后调用） */
async function refreshActive() {
  const tab = activeTab();
  try {
    const data = await apiList(tab.path);
    tab.path = data.path || '';
    tab.cache = { path: tab.path, entries: data.entries || [] };
    saveState();
    renderAll();
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- ⋯ 菜单（M3） ---------- */

const $menu = document.getElementById('menu');
document.getElementById('btn-menu').addEventListener('click', (ev) => {
  ev.stopPropagation();
  $menu.hidden = !$menu.hidden;
});
document.addEventListener('click', (ev) => {
  if (!$menu.hidden && !$menu.contains(ev.target)) $menu.hidden = true;
});

document.getElementById('menu-new').addEventListener('click', async () => {
  $menu.hidden = true;
  const result = await promptDialog({ title: '新建', mode: 'new' });
  if (result === null) return;
  const tab = activeTab();
  try {
    if (result.kind === 'dir') {
      await apiOp('/api/mkdir', { path: tab.path, name: result.name });
      toast('已创建文件夹 ' + result.name);
    } else {
      await apiOp('/api/create', { path: tab.path, name: result.name });
      toast('已创建文件 ' + result.name);
    }
    await refreshActive();
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById('menu-trash').addEventListener('click', () => {
  $menu.hidden = true;
  toast('回收站功能将在后续版本提供');
});

/* ---------- 工具 ---------- */

const $list = document.getElementById('list');
const $breadcrumb = document.getElementById('breadcrumb');
const $toggleHidden = document.getElementById('toggle-hidden');
const $toast = document.getElementById('toast');
const $tabbar = document.getElementById('tabbar');
const $btnBack = document.getElementById('nav-back');
const $btnFwd = document.getElementById('nav-fwd');

let toastTimer = null;
function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.hidden = true; }, 2500);
}

function iconFor(e) {
  if (e.isDir) return '📁';
  if (/\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(e.name)) return '🖼️';
  return '📄';
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return n.toFixed(n >= 10 ? 0 : 1) + ' ' + units[i];
}

function fmtTime(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function isHidden(name) {
  return name.startsWith('.') || name === 'lost+found';
}

function baseName(path) {
  return path ? (path.split('/').pop() || path) : '根目录';
}

/* ---------- 排序（M2） ---------- */

/* collator 降级链：zh-Hans-CN（拼音）→ zh → 默认 locale */
function makeCollator() {
  const opts = { numeric: true, sensitivity: 'base' };
  for (const loc of ['zh-Hans-CN', 'zh']) {
    try {
      if (Intl.Collator.supportedLocalesOf([loc]).length) {
        return new Intl.Collator(loc, opts);
      }
    } catch (e) { /* 降级 */ }
  }
  try { return new Intl.Collator(opts); } catch (e) { /* ignore */ }
  return { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) };
}
const collator = makeCollator();

const SORT_FIELDS = [
  { key: 'name', label: '名称' },
  { key: 'size', label: '大小' },
  { key: 'mtime', label: '修改时间' },
  { key: 'type', label: '类型' },
];

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase(); // 隐藏文件 .xx 无扩展名
}

/* 各字段比较：a、b 为 {name,isDir,size,mtime}，比较前目录永远在前 */
const comparators = {
  name: (a, b) => collator.compare(a.name, b.name),
  size: (a, b) => (a.isDir ? 0 : a.size) - (b.isDir ? 0 : b.size),
  mtime: (a, b) => a.mtime - b.mtime,
  type: (a, b) => {
    const ea = a.isDir ? '' : extOf(a.name);
    const eb = b.isDir ? '' : extOf(b.name);
    if (ea === '' && eb !== '') return -1;   // 无扩展名排最前（目录已在外层处理）
    if (eb === '' && ea !== '') return 1;
    const c = collator.compare(ea, eb);
    return c !== 0 ? c : collator.compare(a.name, b.name);
  },
};

function sortEntries(entries, sort) {
  const cmp = comparators[sort.field] || comparators.name;
  return entries.slice().sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // 目录永远排前
    const c = cmp(a, b);
    return sort.asc ? c : -c;
  });
}

function renderSortbar() {
  const bar = document.getElementById('sortbar');
  bar.textContent = '';
  for (const f of SORT_FIELDS) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    const active = state.sort.field === f.key;
    if (active) chip.classList.add('active');
    chip.textContent = active ? f.label + (state.sort.asc ? ' ↑' : ' ↓') : f.label;
    chip.setAttribute('aria-pressed', String(active));
    chip.addEventListener('click', () => {
      if (state.sort.field === f.key) state.sort.asc = !state.sort.asc;
      else state.sort = { field: f.key, asc: true };
      saveState();
      renderSortbar();
      renderList(); // 纯前端重排，零延迟
    });
    bar.appendChild(chip);
  }
}

/* ---------- 渲染：标签栏 ---------- */

function renderTabs() {
  $tabbar.textContent = '';
  for (const t of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === state.activeTabId ? ' active' : '');
    el.dataset.tabId = t.id;

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = baseName(t.path);
    el.appendChild(label);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = '关闭标签';
    close.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeTab(t.id);
    });
    el.appendChild(close);

    el.addEventListener('click', () => switchTab(t.id));
    $tabbar.appendChild(el);
  }

  const add = document.createElement('button');
  add.className = 'tab-add';
  add.textContent = '[+]';
  add.title = '新建标签';
  add.addEventListener('click', addTab);
  $tabbar.appendChild(add);

  const act = activeTab();
  $btnBack.disabled = act.histIdx <= 0;
  $btnFwd.disabled = act.histIdx >= act.history.length - 1;
  $tabbar.scrollLeft = $tabbar.scrollWidth;
}

/* ---------- 渲染：面包屑 / 列表 ---------- */

function renderBreadcrumb() {
  const tab = activeTab();
  $breadcrumb.textContent = '';
  const addCrumb = (label, path, current) => {
    const b = document.createElement('button');
    b.className = 'crumb';
    b.textContent = label;
    if (current) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', () => navigate(path));
    $breadcrumb.appendChild(b);
  };
  addCrumb('🏠', '', tab.path === '');
  const parts = tab.path ? tab.path.split('/') : [];
  let acc = '';
  parts.forEach((p, i) => {
    acc = acc ? acc + '/' + p : p;
    const s = document.createElement('span');
    s.className = 'crumb sep';
    s.textContent = '›';
    $breadcrumb.appendChild(s);
    addCrumb(p, acc, i === parts.length - 1);
  });
  $breadcrumb.scrollLeft = $breadcrumb.scrollWidth;
}

function renderList() {
  const tab = activeTab();
  $list.textContent = '';
  const entries = (tab.cache && tab.cache.path === tab.path) ? tab.cache.entries : [];
  const shown = sortEntries(
    entries.filter((e) => state.showHidden || !isHidden(e.name)),
    state.sort,
  );
  if (shown.length === 0) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = '空文件夹';
    $list.appendChild(d);
    return;
  }
  for (const e of shown) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.name = e.name;

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = iconFor(e);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = e.name;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = e.isDir ? '' : fmtSize(e.size) + ' · ' + fmtTime(e.mtime);

    row.append(icon, name, meta);
    row.addEventListener('click', () => {
      const child = tab.path ? tab.path + '/' + e.name : e.name;
      if (e.isDir) navigate(child);
      else showPanel(e);
    });
    $list.appendChild(row);
  }
}

function renderAll() {
  renderTabs();
  renderSortbar();
  renderBreadcrumb();
  renderList();
}

/* ---------- 导航（含 history pushState / popstate） ---------- */

/* 进入新目录：更新 tab 栈 + pushState */
async function navigate(path) {
  const tab = activeTab();
  try {
    const data = await apiList(path);
    tab.path = data.path || '';
    tab.cache = { path: tab.path, entries: data.entries || [] };
    // 截断前进分支，压入新记录
    tab.history = tab.history.slice(0, tab.histIdx + 1);
    if (tab.history[tab.histIdx] !== tab.path) {
      tab.history.push(tab.path);
      tab.histIdx++;
    }
    history.pushState({ tabId: tab.id, path: tab.path }, '');
    saveState();
    renderAll();
  } catch (err) {
    toast(err.message);
  }
}

/* 沿 tab 自身历史前进/后退（工具栏 ‹ ›） */
async function tabGo(delta) {
  const tab = activeTab();
  const idx = tab.histIdx + delta;
  if (idx < 0 || idx >= tab.history.length) return;
  const target = tab.history[idx];
  try {
    const data = await apiList(target);
    tab.histIdx = idx;
    tab.path = data.path || target;
    tab.cache = { path: tab.path, entries: data.entries || [] };
    history.pushState({ tabId: tab.id, path: tab.path }, '');
    saveState();
    renderAll();
  } catch (err) {
    toast(err.message);
  }
}

/* Android 返回手势 / 浏览器后退：恢复对应 tab 的上一路径 */
window.addEventListener('popstate', (ev) => {
  const s = ev.state;
  let tab = null;
  if (s && s.tabId) tab = state.tabs.find((t) => t.id === s.tabId);
  if (!tab) tab = activeTab();

  const path = s && typeof s.path === 'string' ? s.path : tab.path;
  const idx = tab.history.indexOf(path);
  if (idx >= 0) tab.histIdx = idx;

  state.activeTabId = tab.id;
  restorePath(tab, path);
});

async function restorePath(tab, path) {
  try {
    const data = await apiList(path);
    tab.path = data.path || '';
    tab.cache = { path: tab.path, entries: data.entries || [] };
  } catch (err) {
    toast(err.message);
  }
  saveState();
  renderAll();
}

/* ---------- 标签操作 ---------- */

async function addTab() {
  const tab = newTab();
  try {
    const data = await apiList('');
    tab.cache = { path: '', entries: data.entries || [] };
  } catch (err) {
    tab.cache = { path: '', entries: [] };
    toast(err.message);
  }
  state.tabs.push(tab);
  state.activeTabId = tab.id;
  history.pushState({ tabId: tab.id, path: '' }, '');
  saveState();
  renderAll();
}

function closeTab(id) {
  if (state.tabs.length <= 1) return; // 至少保留一个标签
  const idx = state.tabs.findIndex((t) => t.id === id);
  state.tabs.splice(idx, 1);
  if (state.activeTabId === id) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)];
    state.activeTabId = next.id;
  }
  saveState();
  renderAll();
}

/* 切换标签：有缓存直接用，不重新请求 */
function switchTab(id) {
  if (id === state.activeTabId) return;
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  state.activeTabId = id;
  if (!tab.cache) {
    // 无缓存（如恢复后首次切换）才请求
    apiList(tab.path).then((data) => {
      tab.path = data.path || '';
      tab.cache = { path: tab.path, entries: data.entries || [] };
      saveState();
      renderAll();
    }).catch((err) => toast(err.message));
  }
  history.pushState({ tabId: id, path: tab.path }, '');
  saveState();
  renderAll();
}

/* ---------- 事件 ---------- */

$toggleHidden.addEventListener('click', () => {
  state.showHidden = !state.showHidden;
  $toggleHidden.classList.toggle('active', state.showHidden);
  saveState();
  renderList();
});

$btnBack.addEventListener('click', () => tabGo(-1));
$btnFwd.addEventListener('click', () => tabGo(1));

/* ---------- 启动 ---------- */

(async function init() {
  const restored = loadState();
  $toggleHidden.classList.toggle('active', state.showHidden);
  if (restored) {
    await validateRestoredTabs();
  } else {
    const tab = activeTab();
    try {
      const data = await apiList('');
      tab.cache = { path: '', entries: data.entries || [] };
    } catch (err) {
      toast(err.message);
    }
  }
  const act = activeTab();
  history.replaceState({ tabId: act.id, path: act.path }, '');
  renderAll();
})();

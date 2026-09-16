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
  const shown = entries.filter((e) => state.showHidden || !isHidden(e.name));
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
    meta.textContent = e.isDir ? '' : fmtSize(e.size);

    row.append(icon, name, meta);
    row.addEventListener('click', () => {
      const child = tab.path ? tab.path + '/' + e.name : e.name;
      if (e.isDir) navigate(child);
      else toast('文件：' + e.name + '（' + fmtSize(e.size) + '，' + fmtTime(e.mtime) + '）');
    });
    $list.appendChild(row);
  }
}

function renderAll() {
  renderTabs();
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

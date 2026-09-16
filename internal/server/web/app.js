/* kfm M0 最小版：浏览目录、面包屑导航、隐藏文件开关、错误 toast */
'use strict';

const state = {
  path: '',          // 相对 root 的路径（'' = root）
  entries: [],
  showHidden: false,
};

const $list = document.getElementById('list');
const $breadcrumb = document.getElementById('breadcrumb');
const $toggleHidden = document.getElementById('toggle-hidden');
const $toast = document.getElementById('toast');

let toastTimer = null;
function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $toast.hidden = true; }, 2500);
}

async function apiList(path) {
  const res = await fetch('/api/list?path=' + encodeURIComponent(path));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
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

function renderBreadcrumb() {
  $breadcrumb.textContent = '';
  const addCrumb = (label, path, current) => {
    const b = document.createElement('button');
    b.className = 'crumb';
    b.textContent = label;
    if (current) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', () => navigate(path));
    $breadcrumb.appendChild(b);
  };
  addCrumb('🏠', '', state.path === '');
  const parts = state.path ? state.path.split('/') : [];
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
  $list.textContent = '';
  const shown = state.entries.filter((e) => state.showHidden || !isHidden(e.name));
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
      const child = state.path ? state.path + '/' + e.name : e.name;
      if (e.isDir) navigate(child);
      else toast('文件：' + e.name + '（' + fmtSize(e.size) + '，' + fmtTime(e.mtime) + '）');
    });
    $list.appendChild(row);
  }
}

async function navigate(path) {
  try {
    const data = await apiList(path);
    state.path = data.path || '';
    state.entries = data.entries || [];
    renderBreadcrumb();
    renderList();
  } catch (err) {
    toast(err.message);
  }
}

$toggleHidden.addEventListener('click', () => {
  state.showHidden = !state.showHidden;
  $toggleHidden.classList.toggle('active', state.showHidden);
  renderList();
});

navigate('');

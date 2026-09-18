<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import Icon from './Icon.vue'
import { state, activeTab, saveState, isAbsPath, parentPath } from '../store.js'
import { apiList, apiGet } from '../api.js'
import { navigate, startSearch, onSearchInput, endSearch, doCreate } from '../actions.js'
import { ask } from '../dialog.js'
import { activeBusy } from '../terminal.js'
import TrashPanel from './TrashPanel.vue'

/* 排序字段：工具栏「排序」按钮点开后以列表形式呈现 */
const SORT_FIELDS = [
  { key: 'name', label: '名称', icon: 'text_fields' },
  { key: 'size', label: '大小', icon: 'sd_card' },
  { key: 'mtime', label: '修改时间', icon: 'schedule' },
  { key: 'type', label: '类型', icon: 'category' },
]

/* 当前标签：用函数声明（提升）而不是 const 箭头函数 —— 下面带 immediate 的
 * watch 会在 setup 阶段立即执行，此时 const 还处于 TDZ，会直接抛错。 */
function tab() {
  return activeTab()
}

const menu = ref(false)
const sortMenu = ref(false)
const searchEl = ref(null)
const gotoEl = ref(null)
const trashOpen = ref(false)
const gotoOpen = ref(false)
const gotoValue = ref('')
const gotoErr = ref('')
const gotoBusy = ref(false)

/* 路径栏：从当前目录的绝对路径拆出各级段（从文件系统根 '/' 或 'C:/' 开始）。
 * 绝对路径由 /api/list 随列表返回并记录在 tab.abs；老状态缺失时补拉一次。 */
const absOf = computed(() => {
  const t = tab()
  if (isAbsPath(t.path)) return t.path
  return t.abs || ''
})
const crumbs = computed(() => {
  const abs = absOf.value
  if (!abs) return []
  const parts = abs.split('/').filter(Boolean)
  const out = []
  let acc = ''
  parts.forEach((part, i) => {
    if (i === 0 && /^[a-zA-Z]:$/.test(part)) acc = part + '/'
    else if (i === 0) acc = '/' + part
    else acc = acc.replace(/\/$/, '') + '/' + part
    out.push({ label: part, path: acc })
  })
  return out
})

/* 起始目录的显示名（相对路径无面包屑时的文案） */
const startName = computed(() => {
  const s = (state.startDir || '').replace(/[\\/]+$/, '')
  return s.split(/[\\/]/).pop() || '起始目录'
})

/* 面包屑可能很长（绝对路径自根展开），路径变化后滚到最右侧显示当前目录 */
const navEl = ref(null)
watch(() => [state.activeTabId, tab().path], async () => {
  await nextTick()
  const el = navEl.value
  if (el) el.scrollLeft = el.scrollWidth
})

/* 老状态（无 tab.abs）补拉一次绝对路径，令面包屑可展现完整层级 */
async function ensureAbs() {
  const t = tab()
  if (!t.path || isAbsPath(t.path) || t.abs) return
  try {
    const d = await apiGet('/api/list?path=' + encodeURIComponent(t.path))
    if (t.path === (d && d.path)) t.abs = d.abs || ''
  } catch {
    /* 取不到就只显示起始目录入口 */
  }
}
watch(() => [state.activeTabId, tab().path, tab().abs], ensureAbs, { immediate: true })

/* 上级目录：
 *   - 相对 / 绝对路径直接逐级向上（访问范围不受限，可越过起始目录）；
 *   - 起始目录（''）的上级取自起始目录的绝对路径，文件系统根处返回 null（禁用按钮）。 */
const up = computed(() => {
  const t = tab()
  if (t.path) return parentPath(t.path)
  return absOf.value ? parentPath(absOf.value) : null
})

/* 打开「前往路径」对话框（绝对路径或相对起始目录的相对路径） */
function openGoto() {
  closeMenu()
  gotoValue.value = tab().path
  gotoErr.value = ''
  gotoOpen.value = true
  nextTick(() => {
    if (gotoEl.value) {
      gotoEl.value.focus()
      gotoEl.value.select()
    }
  })
}

async function submitGoto() {
  const v = gotoValue.value.trim()
  if (!v) return
  gotoBusy.value = true
  try {
    const d = await apiList(v)
    gotoOpen.value = false
    await navigate(d.path)
  } catch (err) {
    gotoErr.value = err.message
  } finally {
    gotoBusy.value = false
  }
}

const searchQuery = computed({
  get: () => state.search.query,
  set: (v) => onSearchInput(v),
})

const sortLabel = computed(
  () => (SORT_FIELDS.find((f) => f.key === state.sort.field) || SORT_FIELDS[0]).label,
)

function closeMenu() {
  menu.value = false
}
function closeSortMenu() {
  sortMenu.value = false
}
function onDocClick() {
  closeMenu()
  closeSortMenu()
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))


/* 隐藏文件开关 */
function toggleHidden() {
  closeMenu()
  state.showHidden = !state.showHidden
  saveState()
}

/* 排序：选中字段（换字段重置为升序），再次点选当前字段则切换升降序 */
function onSort(key) {
  if (state.sort.field === key) state.sort.asc = !state.sort.asc
  else state.sort = { field: key, asc: true }
  saveState()
  closeSortMenu()
}

/* 排序方向单独切换 */
function onToggleAsc() {
  state.sort.asc = !state.sort.asc
  saveState()
  closeSortMenu()
}

function toggleSortMenu() {
  closeMenu()
  sortMenu.value = !sortMenu.value
}

function toggleMoreMenu() {
  closeSortMenu()
  menu.value = !menu.value
}

/* 新建：弹输入框（文件 / 文件夹）；终端运行中禁用 */
async function onNew() {
  closeMenu()
  const result = await ask({ title: '新建', mode: 'new' })
  if (result) await doCreate(result)
}

function onTrash() {
  closeMenu()
  trashOpen.value = true
}

function startSearchMode() {
  closeMenu()
  startSearch()
  // 等输入框渲染完成后聚焦
  nextTick(() => searchEl.value && searchEl.value.focus())
}

function cancelSearch() {
  endSearch()
}
</script>

<template>
  <header class="relative flex-none bg-surface">
    <div class="flex items-center gap-1 px-1 py-2 pt-[calc(env(safe-area-inset-top)+8px)]">
      <template v-if="!state.search.active">
        <!-- 上一级（已到文件系统根时禁用） -->
        <button
          class="state-layer flex h-10 w-10 flex-none items-center justify-center rounded-full text-on-surface-variant transition-opacity disabled:pointer-events-none disabled:opacity-35"
          :disabled="up === null"
          :title="up === null ? '已到文件系统根' : '上一级'"
          aria-label="上一级"
          @click="up !== null && navigate(up)"
        >
          <Icon name="arrow_upward" />
        </button>

        <nav
          ref="navEl"
          class="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap no-scrollbar"
          aria-label="路径"
        >
          <!-- 起始目录：无面包屑（相对路径且未取到绝对路径）时的兜底入口 -->
          <button
            v-if="crumbs.length === 0"
            class="state-layer flex flex-none items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-on-surface"
            :title="state.startDir || '起始目录'"
            @click="navigate('')"
          >
            <Icon name="home" :size="18" :filled="true" />
            <span class="max-w-[24vw] truncate">{{ startName }}</span>
          </button>
          <template v-for="(c, i) in crumbs" :key="i">
            <span v-if="i > 0" class="material-symbols-outlined text-on-surface-variant" style="font-size: 18px">chevron_right</span>
            <button
              class="state-layer flex flex-none items-center gap-1.5 rounded-full px-3 py-2 text-sm text-on-surface-variant"
              :class="i === crumbs.length - 1 ? '!font-medium !text-on-surface' : ''"
              :aria-current="i === crumbs.length - 1 ? 'page' : undefined"
              :title="c.path"
              @click="navigate(c.path)"
            >
              <span class="max-w-[24vw] truncate">{{ c.label }}</span>
            </button>
          </template>
        </nav>

        <!-- 前往路径：直接输入绝对路径或相对路径 -->
        <button
          class="state-layer flex h-10 w-10 flex-none items-center justify-center rounded-full text-on-surface-variant"
          title="前往路径"
          aria-label="前往路径"
          @click.stop="openGoto"
        >
          <Icon name="edit_location" />
        </button>

        <!-- 排序按钮：点开后弹出排序列表 -->
        <div class="relative flex-none">
          <button
            class="state-layer flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant"
            :class="sortMenu ? '!text-primary' : ''"
            :title="`排序：${sortLabel}（${state.sort.asc ? '升序' : '降序'}）`"
            aria-haspopup="menu"
            :aria-expanded="sortMenu"
            @click.stop="toggleSortMenu"
          >
            <Icon name="sort" />
          </button>
          <div
            v-if="sortMenu"
            class="absolute right-0 top-full z-40 mt-1 w-52 origin-top-right rounded-xl bg-surface-2 py-2 shadow-[0_3px_10px_rgba(0,0,0,0.5)] m3-pop"
            @click.stop
          >
            <div class="px-4 pt-1 pb-2 text-xs font-medium text-on-surface-variant">排序方式</div>
            <button
              v-for="f in SORT_FIELDS"
              :key="f.key"
              class="state-layer flex w-full items-center gap-3 px-4 py-3 text-left text-sm"
              :class="state.sort.field === f.key ? 'font-medium text-primary' : 'text-on-surface'"
              @click="onSort(f.key)"
            >
              <Icon :name="f.icon" :size="20" />
              <span class="min-w-0 flex-1 truncate">{{ f.label }}</span>
              <span
                v-if="state.sort.field === f.key"
                class="material-symbols-outlined flex-none"
                style="font-size: 18px"
              >{{ state.sort.asc ? 'arrow_upward' : 'arrow_downward' }}</span>
            </button>
            <button
              class="state-layer flex w-full items-center gap-3 border-t border-outline-variant/40 px-4 py-3 text-left text-sm text-on-surface"
              title="仅切换升序/降序"
              @click="onToggleAsc"
            >
              <Icon :name="state.sort.asc ? 'arrow_upward' : 'arrow_downward'" :size="20" />
              {{ state.sort.asc ? '改为降序' : '改为升序' }}
            </button>
          </div>
        </div>

        <!-- 搜索：直接进入搜索模式 -->
        <button
          class="state-layer flex h-10 w-10 flex-none items-center justify-center rounded-full text-on-surface-variant"
          title="搜索"
          @click="startSearchMode"
        >
          <Icon name="search" />
        </button>
      </template>

      <!-- 搜索模式：面包屑行切换为输入框 -->
      <template v-else>
        <span class="material-symbols-outlined mx-2 flex-none text-on-surface-variant">search</span>
        <input
          ref="searchEl"
          v-model="searchQuery"
          type="search"
          placeholder="搜索当前目录（含子目录）…"
          class="h-10 min-w-0 flex-1 rounded-full bg-surface-3 px-4 text-sm text-on-surface caret-primary outline-none placeholder:text-on-surface-variant/70 [&::-webkit-search-cancel-button]:hidden"
        >
        <button
          class="state-layer flex h-10 flex-none items-center rounded-full px-3 text-sm text-primary"
          @click="cancelSearch"
        >
          取消
        </button>
      </template>

      <!-- ⋯ 更多操作（搜索模式下隐藏） -->
      <div v-if="!state.search.active" class="relative flex-none">
        <button
          class="state-layer flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant"
          :class="menu ? '!text-primary' : ''"
          title="更多操作"
          aria-haspopup="menu"
          :aria-expanded="menu"
          @click.stop="toggleMoreMenu"
        >
          <Icon name="more_vert" />
        </button>
        <div
          v-if="menu"
          class="absolute right-0 top-full z-40 mt-1 w-52 origin-top-right rounded-xl bg-surface-2 py-2 shadow-[0_3px_10px_rgba(0,0,0,0.5)] m3-pop"
          @click.stop
        >
          <button
            class="state-layer flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-on-surface transition-opacity disabled:pointer-events-none disabled:opacity-35"
            :disabled="activeBusy()"
            :title="activeBusy() ? '终端正在运行命令' : '新建'"
            @click="onNew"
          >
            <Icon name="add" :size="20" />
            新建
          </button>
          <button
            class="state-layer flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-on-surface"
            @click="toggleHidden"
          >
            <Icon :name="state.showHidden ? 'visibility' : 'visibility_off'" :size="20" />
            {{ state.showHidden ? '隐藏隐藏文件' : '显示隐藏文件' }}
          </button>
          <button
            class="state-layer flex w-full items-center gap-3 border-t border-outline-variant/40 px-4 py-3 text-left text-sm text-on-surface"
            @click="onTrash"
          >
            <Icon name="delete" :size="20" />
            回收站
          </button>
        </div>
      </div>
    </div>

    <!-- 回收站面板 -->
    <TrashPanel v-if="trashOpen" @close="trashOpen = false" />

    <!-- 前往路径对话框 -->
    <Teleport to="body">
      <div
        v-if="gotoOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        @click.self="gotoOpen = false"
      >
        <div
          role="dialog"
          aria-modal="true"
          class="m3-pop w-full max-w-md rounded-[28px] bg-surface-2 p-5 pb-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
        >
          <div class="mb-1 text-xl font-normal text-on-surface">前往路径</div>
          <p class="mb-3 text-xs leading-relaxed text-on-surface-variant">
            可输入绝对路径（如 <code>/sdcard</code>、<code>C:/Users</code>），或相对起始目录的相对路径。
          </p>
          <input
            ref="gotoEl"
            v-model="gotoValue"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="绝对路径或相对路径"
            class="h-14 w-full rounded-xl bg-surface-3 px-4 text-[15px] text-on-surface caret-primary outline-none focus:ring-2 focus:ring-primary/60"
            @keydown.enter.prevent="submitGoto"
            @keydown.esc="gotoOpen = false"
          >
          <p v-if="gotoErr" class="mt-2 text-xs text-error">{{ gotoErr }}</p>
          <div class="mt-4 flex items-center justify-end gap-1">
            <button
              class="state-layer flex h-11 flex-none items-center rounded-full px-3.5 text-sm font-medium text-primary"
              @click="gotoOpen = false"
            >
              取消
            </button>
            <button
              class="state-layer flex h-11 flex-none items-center rounded-full px-3.5 text-sm font-medium text-primary transition-opacity disabled:pointer-events-none disabled:opacity-40"
              :disabled="gotoBusy"
              @click="submitGoto"
            >
              前往
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </header>
</template>

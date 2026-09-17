<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import Icon from './Icon.vue'
import { state, activeTab, saveState } from '../store.js'
import { navigate, startSearch, onSearchInput, endSearch } from '../actions.js'
import { ask } from '../dialog.js'
import { doCreate } from '../actions.js'
import { activeBusy } from '../terminal.js'
import TrashPanel from './TrashPanel.vue'

/* 排序字段（原 Sortbar，已并入顶部工具栏） */
const SORT_FIELDS = [
  { key: 'name', label: '名称', icon: 'text_fields' },
  { key: 'size', label: '大小', icon: 'sd_card' },
  { key: 'mtime', label: '修改时间', icon: 'schedule' },
  { key: 'type', label: '类型', icon: 'category' },
]

const menu = ref(false)
const searchEl = ref(null)
const trashOpen = ref(false)
const searchQuery = computed({
  get: () => state.search.query,
  set: (v) => onSearchInput(v),
})

function closeMenu() {
  menu.value = false
}
function onDocClick() {
  closeMenu()
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

const tab = () => activeTab()

/* 面包屑段 */
function crumbList() {
  const parts = tab().path ? tab().path.split('/') : []
  let acc = ''
  const out = [{ label: '根目录', path: '', icon: 'home' }]
  for (const p of parts) {
    acc = acc ? acc + '/' + p : p
    out.push({ label: p, path: acc })
  }
  return out
}

/* 隐藏文件开关 */
function toggleHidden() {
  closeMenu()
  state.showHidden = !state.showHidden
  saveState()
}

/* 排序：同字段切换升降序，换字段重置为升序 */
function onSort(key) {
  if (state.sort.field === key) state.sort.asc = !state.sort.asc
  else state.sort = { field: key, asc: true }
  saveState()
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
        <nav
          class="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap no-scrollbar"
          aria-label="路径"
        >
          <template v-for="(c, i) in crumbList()" :key="i">
            <span v-if="i > 0" class="material-symbols-outlined text-on-surface-variant" style="font-size: 18px">chevron_right</span>
            <button
              class="state-layer flex flex-none items-center gap-1.5 rounded-full px-3 py-2 text-sm text-on-surface-variant"
              :class="i === crumbList().length - 1 ? '!font-medium !text-on-surface' : ''"
              :aria-current="i === crumbList().length - 1 ? 'page' : undefined"
              @click="navigate(c.path)"
            >
              <Icon v-if="c.icon" :name="c.icon" :size="18" :filled="i === 0" />
              <span class="max-w-[24vw] truncate">{{ c.label }}</span>
            </button>
          </template>
        </nav>
        <button
          class="state-layer flex h-12 w-12 flex-none items-center justify-center rounded-full text-on-surface-variant"
          title="搜索"
          @click="startSearchMode"
        >
          <Icon name="search" />
        </button>
      </template>
      <template v-else>
        <span class="material-symbols-outlined mx-2 flex-none text-on-surface-variant">search</span>
        <input
          ref="searchEl"
          v-model="searchQuery"
          type="search"
          placeholder="搜索当前目录（含子目录）…"
          class="h-12 min-w-0 flex-1 rounded-full bg-surface-3 px-4 text-sm text-on-surface caret-primary outline-none placeholder:text-on-surface-variant/70 [&::-webkit-search-cancel-button]:hidden"
        >
        <button
          class="state-layer flex h-12 flex-none items-center rounded-full px-4 text-sm text-primary"
          @click="cancelSearch"
        >
          取消
        </button>
      </template>
      <button
        class="state-layer relative flex h-12 w-12 flex-none items-center justify-center rounded-full text-on-surface-variant"
        title="更多操作"
        aria-haspopup="menu"
        @click.stop="menu = !menu"
      >
        <Icon name="more_vert" />
      </button>
    </div>

    <!-- 排序行：与路径行同属顶部工具栏 -->
    <div
      class="flex items-center gap-2 overflow-x-auto px-3 pb-2.5 whitespace-nowrap no-scrollbar"
      role="toolbar"
      aria-label="排序"
    >
      <button
        v-for="f in SORT_FIELDS"
        :key="f.key"
        class="state-layer flex h-8 flex-none items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors"
        :class="
          state.sort.field === f.key
            ? 'border-transparent bg-secondary-container font-medium text-on-secondary-container'
            : 'border-outline-variant/50 text-on-surface-variant'
        "
        :aria-pressed="state.sort.field === f.key"
        @click="onSort(f.key)"
      >
        <span v-if="state.sort.field === f.key" class="material-symbols-outlined" style="font-size: 16px">
          {{ state.sort.asc ? 'arrow_upward' : 'arrow_downward' }}
        </span>
        {{ f.label }}
      </button>
    </div>

    <!-- ⋯ 菜单（M3 菜单容器） -->
    <div
      v-if="menu"
      class="absolute right-2 z-40 w-52 origin-top-right rounded-xl bg-surface-2 py-2 shadow-[0_3px_10px_rgba(0,0,0,0.5)] m3-pop"
      style="top: calc(env(safe-area-inset-top) + 116px)"
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

    <!-- 回收站面板 -->
    <TrashPanel v-if="trashOpen" @close="trashOpen = false" />
  </header>
</template>

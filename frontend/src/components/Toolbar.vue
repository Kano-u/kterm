<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import Icon from './Icon.vue'
import { state, activeTab } from '../store.js'
import { navigate, startSearch, onSearchInput, endSearch } from '../actions.js'
import { ask } from '../dialog.js'
import { doCreate } from '../actions.js'
import TrashPanel from './TrashPanel.vue'

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
  state.showHidden = !state.showHidden
}

/* 新建：弹输入框（文件 / 文件夹） */
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
    <div class="flex items-center gap-1 px-1 py-2">
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
      </template>
      <template v-else>
        <span class="material-symbols-outlined mx-2 flex-none text-on-surface-variant">search</span>
        <input
          ref="searchEl"
          v-model="searchQuery"
          type="search"
          placeholder="搜索当前目录（含子目录）…"
          class="h-12 min-w-0 flex-1 rounded-full bg-surface-3 px-4 text-sm text-on-surface caret-primary outline-none placeholder:text-on-surface-variant/70 dark:[&::-webkit-search-cancel-button]:hidden"
        >
        <button
          class="state-layer flex h-12 flex-none items-center rounded-full px-4 text-sm text-primary"
          @click="cancelSearch"
        >
          取消
        </button>
      </template>
      <template v-if="!state.search.active">
        <button
          class="state-layer flex h-12 w-12 flex-none items-center justify-center rounded-full text-on-surface-variant"
          :class="state.showHidden ? '!text-primary' : ''"
          title="显示/隐藏隐藏文件"
          @click="toggleHidden"
        >
          <Icon name="visibility" :filled="state.showHidden" />
        </button>
        <button
          class="state-layer relative flex h-12 w-12 flex-none items-center justify-center rounded-full text-on-surface-variant"
          title="更多操作"
          aria-haspopup="menu"
          @click.stop="menu = !menu"
        >
          <Icon name="more_vert" />
        </button>
      </template>
    </div>

    <!-- ⋯ 菜单（M3 菜单容器） -->
    <div
      v-if="menu"
      class="absolute right-2 z-40 w-52 origin-top-right rounded-xl bg-surface-2 py-2 shadow-[0_3px_10px_rgba(0,0,0,0.2),0_6px_24px_rgba(0,0,0,0.12)] m3-pop dark:shadow-[0_3px_10px_rgba(0,0,0,0.5)]"
      style="top: calc(env(safe-area-inset-top) + 60px + 40px)"
    >
      <button
        class="state-layer flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-on-surface"
        @click="onNew"
      >
        <Icon name="add" :size="20" />
        新建
      </button>
      <button
        class="state-layer flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-on-surface"
        @click="onTrash"
      >
        <Icon name="delete" :size="20" />
        回收站
      </button>
      <button
        class="state-layer flex w-full items-center gap-3 border-t border-outline-variant/40 px-4 py-3 text-left text-sm text-on-surface"
        @click="startSearchMode"
      >
        <Icon name="search" :size="20" />
        搜索
      </button>
    </div>

    <!-- 回收站面板 -->
    <TrashPanel v-if="trashOpen" @close="trashOpen = false" />
  </header>
</template>

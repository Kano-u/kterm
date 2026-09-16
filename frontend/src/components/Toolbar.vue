<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { state, activeTab } from '../store.js'
import { navigate } from '../actions.js'
import { toast } from '../toast.js'
import { ask } from '../dialog.js'
import { doCreate } from '../actions.js'

const menu = ref(false)
const searchMode = ref(false)
const query = ref('')

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
  const out = [{ label: '🏠', path: '' }]
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
  toast('回收站功能将在后续版本提供')
}

function startSearch() {
  closeMenu()
  searchMode.value = true
  query.value = ''
  // TODO(M6): 接入 /api/search 防抖搜索
}

function endSearch() {
  searchMode.value = false
  query.value = ''
}
</script>

<template>
  <header class="flex-none border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
    <div class="flex items-center gap-1.5 px-3 py-2">
      <template v-if="!searchMode">
        <nav
          class="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap no-scrollbar"
          aria-label="路径"
        >
          <template v-for="(c, i) in crumbList()" :key="i">
            <span v-if="i > 0" class="px-0.5 text-zinc-400 dark:text-zinc-600">›</span>
            <button
              class="rounded px-1 py-2.5 text-indigo-600 dark:text-indigo-400 press"
              :class="i === crumbList().length - 1 ? '!font-semibold !text-zinc-900 dark:!text-zinc-100' : ''"
              :aria-current="i === crumbList().length - 1 ? 'page' : undefined"
              @click="navigate(c.path)"
            >
              {{ c.label }}
            </button>
          </template>
        </nav>
      </template>
      <template v-else>
        <input
          v-model="query"
          type="search"
          placeholder="搜索当前目录（含子目录）…"
          class="h-11 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:[&::-webkit-search-cancel-button]:hidden"
        >
        <button class="h-11 flex-none px-3 text-sm text-zinc-500 press" @click="endSearch">取消</button>
      </template>

      <button
        class="h-11 w-11 flex-none rounded-lg text-lg press"
        :class="state.showHidden ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 dark:text-zinc-400'"
        title="显示/隐藏隐藏文件"
        @click="toggleHidden"
      >
        👁
      </button>
      <button
        class="relative h-11 w-11 flex-none rounded-lg text-lg text-zinc-600 dark:text-zinc-300 press"
        title="更多操作"
        aria-haspopup="menu"
        @click.stop="menu = !menu"
      >
        ⋯
      </button>
    </div>

    <!-- ⋯ 下拉菜单 -->
    <div
      v-if="menu"
      class="absolute right-2 z-40 w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800 pop-in"
      style="top: calc(env(safe-area-inset-top) + 96px)"
    >
      <button class="block w-full px-4 text-left text-sm leading-12 press" @click="onNew">
        ✏️ 新建
      </button>
      <button
        class="block w-full px-4 text-left text-sm leading-12 text-zinc-400 press disabled:opacity-50"
        disabled
        @click="onTrash"
      >
        🗑 回收站
      </button>
      <button
        class="block w-full border-t border-zinc-100 px-4 text-left text-sm leading-12 press dark:border-zinc-700"
        @click="startSearch"
      >
        🔍 搜索
      </button>
    </div>
  </header>
</template>

<script setup>
import { state, activeTab } from '../store.js'
import { navigate, tabGo } from '../actions.js'

const SORT_FIELDS = [
  { key: 'name', label: '名称' },
  { key: 'size', label: '大小' },
  { key: 'mtime', label: '修改时间' },
  { key: 'type', label: '类型' },
]

function onChip(key) {
  if (state.sort.field === key) state.sort.asc = !state.sort.asc
  else state.sort = { field: key, asc: true }
}
</script>

<template>
  <div
    class="flex flex-none items-center gap-2 overflow-x-auto border-b border-zinc-200 bg-white px-3 py-1.5 whitespace-nowrap no-scrollbar dark:border-zinc-800 dark:bg-zinc-900"
    role="toolbar"
    aria-label="排序"
  >
    <button
      v-for="f in SORT_FIELDS"
      :key="f.key"
      class="flex h-9 min-h-9 flex-none items-center rounded-full px-3.5 text-[13px] press"
      :class="
        state.sort.field === f.key
          ? 'bg-indigo-600 text-white'
          : 'border border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400'
      "
      :aria-pressed="state.sort.field === f.key"
      @click="onChip(f.key)"
    >
      {{ f.label }}
      <span v-if="state.sort.field === f.key" class="ml-0.5">{{ state.sort.asc ? '↑' : '↓' }}</span>
    </button>
  </div>
</template>

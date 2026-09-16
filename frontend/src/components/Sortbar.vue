<script setup>
import { state } from '../store.js'
import { saveState } from '../store.js'
import Icon from './Icon.vue'

const SORT_FIELDS = [
  { key: 'name', label: '名称', icon: 'text_fields' },
  { key: 'size', label: '大小', icon: 'sd_card' },
  { key: 'mtime', label: '修改时间', icon: 'schedule' },
  { key: 'type', label: '类型', icon: 'category' },
]

function onChip(key) {
  if (state.sort.field === key) state.sort.asc = !state.sort.asc
  else state.sort = { field: key, asc: true }
  saveState()
}
</script>

<template>
  <div
    class="flex flex-none items-center gap-2 overflow-x-auto bg-surface px-3 py-2.5 whitespace-nowrap no-scrollbar"
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
      @click="onChip(f.key)"
    >
      <span v-if="state.sort.field === f.key" class="material-symbols-outlined" style="font-size: 16px">
        {{ state.sort.asc ? 'arrow_upward' : 'arrow_downward' }}
      </span>
      {{ f.label }}
    </button>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onUnmounted } from 'vue'
import EntrySheet from './EntrySheet.vue'
import {
  state, activeTab, shownEntries, pruneSelection,
  enterMultiSelect, exitMultiSelect, toggleSelect, iconFor,
  fmtSize, fmtTime, saveState,
} from '../store.js'
import { navigate } from '../actions.js'

const listEl = ref(null)
const sheetEntry = ref(null)

const shown = () => shownEntries()
const tab = () => activeTab()

/* 长按进入多选（500ms，移动即取消） */
let pressTimer = null
let pressMoved = false

function onContextmenu(ev) {
  ev.preventDefault()
}

function onPointerdown(ev) {
  const row = ev.target.closest('[data-row]')
  if (!row || state.multi.active) return
  pressMoved = false
  const name = row.dataset.row
  pressTimer = setTimeout(() => {
    pressTimer = null
    if (!pressMoved) {
      if (navigator.vibrate) navigator.vibrate(30)
      enterMultiSelect(name)
    }
  }, 500)
}

function cancelPress() {
  pressMoved = true
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}
function onPointerup() {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

/* 列表变化时同步多选集合（删除/粘贴后自动清掉已不存在的选中项） */
watch(shown, pruneSelection, { flush: 'sync' })

onUnmounted(() => {
  document.removeEventListener('pointermove', cancelPress)
})

function onClickRow(e) {
  const tab0 = tab()
  if (state.multi.active) {
    toggleSelect(e.name)
    return
  }
  if (e.isDir) {
    navigate(tab0.path ? tab0.path + '/' + e.name : e.name)
  } else {
    sheetEntry.value = e
  }
}
</script>

<template>
  <main
    ref="listEl"
    class="relative flex-1 overflow-y-auto overscroll-contain"
    @contextmenu="onContextmenu"
    @pointerdown="onPointerdown"
    @pointermove="cancelPress"
    @pointerup="onPointerup"
    @pointercancel="cancelPress"
    @scroll.passive="cancelPress"
  >
    <div
      v-if="shown().length === 0"
      class="fade-in px-4 py-12 text-center text-sm text-zinc-400 dark:text-zinc-500"
    >
      空文件夹
    </div>

    <div
      v-for="e in shown()"
      :key="e.name"
      :data-row="e.name"
      class="flex min-h-14 cursor-pointer items-center gap-3 border-b border-zinc-100 px-4 select-none dark:border-zinc-800/70 press"
      :class="
        state.multi.active && state.multi.sel.has(e.name)
          ? 'bg-indigo-600/10 dark:bg-indigo-400/15 shadow-[inset_3px_0_0_0_var(--color-indigo-600)]'
          : 'bg-white dark:bg-zinc-900'
      "
      @click="onClickRow(e)"
    >
      <!-- 多选圆圈 -->
      <span
        v-if="state.multi.active"
        class="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 text-[13px] leading-none"
        :class="
          state.multi.sel.has(e.name)
            ? 'border-indigo-600 bg-indigo-600 text-white'
            : 'border-zinc-400 text-transparent dark:border-zinc-500'
        "
      >
        ✓
      </span>

      <span class="w-7 flex-none text-center text-[22px]">{{ iconFor(e) }}</span>
      <span class="min-w-0 flex-1 truncate">{{ e.name }}</span>
      <span v-if="!e.isDir" class="flex-none text-xs text-zinc-400 dark:text-zinc-500">
        {{ fmtSize(e.size) }} · {{ fmtTime(e.mtime) }}
      </span>
    </div>

    <!-- 单击文件：底部详情/操作面板 -->
    <EntrySheet v-if="sheetEntry" :entry="sheetEntry" @close="sheetEntry = null" />
  </main>
</template>

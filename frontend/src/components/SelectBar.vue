<script setup>
import { state, shownEntries, enterMultiSelect, exitMultiSelect, toggleSelect } from '../store.js'
import { copySelection, cutSelection } from '../actions.js'
import { toast } from '../toast.js'

function selectAll() {
  const names = shownEntries().map((e) => e.name)
  const allIn = names.every((n) => state.multi.sel.has(n))
  if (allIn) {
    exitMultiSelect()
  } else {
    names.forEach((n) => state.multi.sel.add(n))
  }
}

function onDelete() {
  toast('删除功能将在后续版本提供')
}
</script>

<template>
  <div
    v-if="state.multi.active"
    class="fixed bottom-0 left-0 right-0 z-40 flex items-center gap-2 border-t border-zinc-200 bg-white/95 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)] shadow-[0_-4px_16px_rgba(0,0,0,0.15)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
  >
    <span class="min-w-0 flex-1 truncate text-sm font-semibold">
      已选 {{ state.multi.sel.size }} 项
    </span>
    <button class="h-11 flex-none rounded-xl bg-zinc-100 px-3.5 text-sm dark:bg-zinc-800 press" @click="selectAll">
      全选
    </button>
    <button class="h-11 flex-none rounded-xl bg-zinc-100 px-3.5 text-sm dark:bg-zinc-800 press" @click="copySelection">
      复制
    </button>
    <button class="h-11 flex-none rounded-xl bg-zinc-100 px-3.5 text-sm dark:bg-zinc-800 press" @click="cutSelection">
      移动
    </button>
    <button class="h-11 flex-none rounded-xl bg-zinc-100 px-3.5 text-sm text-red-600 dark:bg-zinc-800 dark:text-red-400 press" @click="onDelete">
      删除
    </button>
    <button class="h-11 w-11 flex-none rounded-xl bg-zinc-100 text-sm dark:bg-zinc-800 press" @click="exitMultiSelect()">
      ✕
    </button>
  </div>
</template>

<script setup>
import { state } from '../store.js'
import { pasteClipboard, clearClipboard } from '../actions.js'
</script>

<template>
  <div
    v-if="state.clipboard && !state.multi.active"
    class="fixed bottom-0 left-0 right-0 z-30 flex items-center gap-2 border-t border-zinc-200 bg-white/95 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)] shadow-[0_-4px_16px_rgba(0,0,0,0.15)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
  >
    <span class="min-w-0 flex-1 truncate text-sm font-semibold">
      {{ state.clipboard.mode === 'copy' ? '已复制' : '已剪切' }} {{ state.clipboard.names.length }} 项
    </span>
    <button
      class="h-11 flex-none rounded-xl bg-zinc-100 px-4 text-sm dark:bg-zinc-800 press"
      @click="clearClipboard"
    >
      清空
    </button>
    <button
      class="h-11 flex-none rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white press"
      @click="pasteClipboard"
    >
      粘贴
    </button>
  </div>
</template>

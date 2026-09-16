<script setup>
import { state } from '../store.js'
import { pasteClipboard, clearClipboard } from '../actions.js'
import Icon from './Icon.vue'
</script>

<template>
  <div
    v-if="state.clipboard && !state.multi.active"
    class="m3-elevate fixed bottom-0 left-0 right-0 z-30 flex items-center gap-2 border-t border-outline-variant/40 bg-surface-3 px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)]"
  >
    <span class="ml-2 flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
      <Icon :name="state.clipboard.mode === 'copy' ? 'content_copy' : 'content_cut'" />
    </span>
    <span class="min-w-0 flex-1 truncate text-sm font-medium text-on-surface">
      {{ state.clipboard.mode === 'copy' ? '已复制' : '已剪切' }} {{ state.clipboard.names.length }} 项
    </span>
    <button
      class="state-layer flex h-11 flex-none items-center rounded-full px-4 text-sm text-on-surface-variant"
      @click="clearClipboard"
    >
      清空
    </button>
    <button
      class="state-layer flex h-11 flex-none items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-medium text-on-primary"
      @click="pasteClipboard"
    >
      <Icon name="content_paste" :size="20" />
      粘贴
    </button>
  </div>
</template>

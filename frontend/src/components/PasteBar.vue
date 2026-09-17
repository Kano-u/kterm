<script setup>
import { state } from '../store.js'
import { pasteClipboard, clearClipboard } from '../actions.js'
import { activeBusy } from '../terminal.js'
import Icon from './Icon.vue'
</script>

<template>
  <div
    v-if="state.clipboard && !state.multi.active"
    class="m3-elevate fixed bottom-0 left-0 right-0 z-30 flex items-center gap-2 border-t border-outline-variant/40 bg-surface-3 px-1.5 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+6px)]"
  >
    <span class="ml-1.5 flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
      <Icon :name="state.clipboard.mode === 'copy' ? 'content_copy' : 'content_cut'" />
    </span>
    <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-on-surface">
      {{ state.clipboard.mode === 'copy' ? '已复制' : '已剪切' }} {{ state.clipboard.names.length }} 项
    </span>
    <button
      class="state-layer flex h-10 flex-none items-center rounded-full px-3 text-[13px] text-on-surface-variant"
      @click="clearClipboard"
    >
      清空
    </button>
    <button
      class="state-layer flex h-10 flex-none items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-medium text-on-primary transition-opacity disabled:pointer-events-none disabled:opacity-40"
      :disabled="activeBusy()"
      :title="activeBusy() ? '终端正在运行命令' : '粘贴'"
      @click="pasteClipboard"
    >
      <Icon name="content_paste" :size="20" />
      粘贴
    </button>
  </div>
</template>

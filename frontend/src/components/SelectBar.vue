<script setup>
import { state, shownEntries, enterMultiSelect, exitMultiSelect, toggleSelect } from '../store.js'
import { copySelection, cutSelection } from '../actions.js'
import { toast } from '../toast.js'
import Icon from './Icon.vue'

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
    class="m3-elevate fixed bottom-0 left-0 right-0 z-40 flex items-center gap-1 border-t border-outline-variant/40 bg-surface-3 px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)]"
  >
    <span class="min-w-0 flex-1 truncate pl-2 text-sm font-medium text-on-surface">
      已选 {{ state.multi.sel.size }} 项
    </span>
    <button
      class="state-layer flex h-11 flex-none items-center gap-1.5 rounded-full px-3 text-sm text-on-surface"
      @click="selectAll"
    >
      <Icon name="select_all" :size="20" />
      全选
    </button>
    <button
      class="state-layer flex h-11 flex-none items-center gap-1.5 rounded-full px-3 text-sm text-primary"
      @click="copySelection"
    >
      <Icon name="content_copy" :size="20" />
      复制
    </button>
    <button
      class="state-layer flex h-11 flex-none items-center gap-1.5 rounded-full px-3 text-sm text-primary"
      @click="cutSelection"
    >
      <Icon name="content_cut" :size="20" />
      移动
    </button>
    <button
      class="state-layer flex h-11 flex-none items-center gap-1.5 rounded-full px-3 text-sm text-error"
      @click="onDelete"
    >
      <Icon name="delete" :size="20" />
      删除
    </button>
    <button
      class="state-layer flex h-11 w-11 flex-none items-center justify-center rounded-full text-on-surface-variant"
      @click="exitMultiSelect()"
    >
      <Icon name="close" :size="20" />
    </button>
  </div>
</template>

<script setup>
import { state, shownEntries, enterMultiSelect, exitMultiSelect, toggleSelect } from '../store.js'
import { copySelection, cutSelection, confirmDelete } from '../actions.js'
import { activeBusy } from '../terminal.js'
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

async function onDelete() {
  if (state.multi.sel.size === 0) return
  await confirmDelete([...state.multi.sel])
}
</script>

<template>
  <div
    v-if="state.multi.active"
    class="m3-elevate fixed bottom-0 left-0 right-0 z-40 flex items-center gap-0.5 border-t border-outline-variant/40 bg-surface-3 px-1.5 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+6px)]"
  >
    <span class="min-w-0 flex-1 truncate pl-1.5 text-[13px] font-medium text-on-surface">
      已选 {{ state.multi.sel.size }} 项
    </span>
    <button
      class="state-layer flex h-10 flex-none items-center rounded-full px-2.5 text-[13px] text-on-surface"
      @click="selectAll"
    >
      <Icon name="select_all" :size="20" />
      全选
    </button>
    <button
      class="state-layer flex h-10 flex-none items-center rounded-full px-2.5 text-[13px] text-primary"
      @click="copySelection"
    >
      <Icon name="content_copy" :size="20" />
      复制
    </button>
    <button
      class="state-layer flex h-10 flex-none items-center rounded-full px-2.5 text-[13px] text-primary transition-opacity disabled:pointer-events-none disabled:opacity-35"
      :disabled="activeBusy()"
      :title="activeBusy() ? '终端正在运行命令' : '剪切'"
      @click="cutSelection"
    >
      <Icon name="content_cut" :size="20" />
      移动
    </button>
    <button
      class="state-layer flex h-10 flex-none items-center rounded-full px-2.5 text-[13px] text-error transition-opacity disabled:pointer-events-none disabled:opacity-35"
      :disabled="activeBusy()"
      :title="activeBusy() ? '终端正在运行命令' : '删除'"
      @click="onDelete"
    >
      <Icon name="delete" :size="20" />
      删除
    </button>
    <button
      class="state-layer flex h-10 w-10 flex-none items-center justify-center rounded-full text-on-surface-variant"
      @click="exitMultiSelect()"
    >
      <Icon name="close" :size="20" />
    </button>
  </div>
</template>

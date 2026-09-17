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
    data-bottom-bar
    class="m3-elevate fixed bottom-0 left-0 right-0 z-40 border-t border-outline-variant/40 bg-surface-3 px-1.5 pt-0.5 pb-[calc(env(safe-area-inset-bottom)+4px)]"
  >
    <!-- 计数单独占一行：与四个操作按钮同行时，窄屏（360px）下计数是唯一可压缩的
         元素，会被 truncate 成「已...」。单独一行后文字完整显示，按钮也能铺满宽度。 -->
    <div class="truncate px-2 pb-0.5 text-[12px] font-medium text-on-surface-variant">
      已选 {{ state.multi.sel.size }} 项
    </div>
    <div class="flex items-center gap-0.5">
      <button
        class="state-layer flex h-10 min-w-0 flex-1 basis-0 items-center justify-center gap-1 rounded-full text-[13px] text-on-surface"
        @click="selectAll"
      >
        <Icon name="select_all" :size="20" />
        <span class="truncate">全选</span>
      </button>
      <button
        class="state-layer flex h-10 min-w-0 flex-1 basis-0 items-center justify-center gap-1 rounded-full text-[13px] text-primary"
        @click="copySelection"
      >
        <Icon name="content_copy" :size="20" />
        <span class="truncate">复制</span>
      </button>
      <button
        class="state-layer flex h-10 min-w-0 flex-1 basis-0 items-center justify-center gap-1 rounded-full text-[13px] text-primary transition-opacity disabled:pointer-events-none disabled:opacity-35"
        :disabled="activeBusy()"
        :title="activeBusy() ? '终端正在运行命令' : '剪切'"
        @click="cutSelection"
      >
        <Icon name="content_cut" :size="20" />
        <span class="truncate">移动</span>
      </button>
      <button
        class="state-layer flex h-10 min-w-0 flex-1 basis-0 items-center justify-center gap-1 rounded-full text-[13px] text-error transition-opacity disabled:pointer-events-none disabled:opacity-35"
        :disabled="activeBusy()"
        :title="activeBusy() ? '终端正在运行命令' : '删除'"
        @click="onDelete"
      >
        <Icon name="delete" :size="20" />
        <span class="truncate">删除</span>
      </button>
      <button
        class="state-layer flex h-10 w-10 flex-none items-center justify-center rounded-full text-on-surface-variant"
        title="退出多选"
        aria-label="退出多选"
        @click="exitMultiSelect()"
      >
        <Icon name="close" :size="20" />
      </button>
    </div>
  </div>
</template>

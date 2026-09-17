<script setup>
import { state, baseName, tabTitle } from '../store.js'
import { addTab, closeTab, switchTab } from '../actions.js'
import { isBusy } from '../terminal.js'
import Icon from './Icon.vue'

/* T3：该标签绑定的终端有命令在运行时锁定关闭按钮（仍可切换标签） */
function locked(id) {
  return isBusy(id)
}
</script>

<template>
  <nav
    class="flex flex-none items-center gap-1 overflow-x-auto bg-surface px-2 py-2 no-scrollbar"
    aria-label="标签页"
  >
    <div
      v-for="t in state.tabs"
      :key="t.id"
      class="ripple state-layer flex max-w-[38vw] flex-none cursor-pointer items-center gap-1 rounded-full py-2 pl-4 pr-1.5 transition-colors"
      :class="
        t.id === state.activeTabId
          ? 'bg-primary-container text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant'
      "
      @click="switchTab(t.id)"
    >
      <span v-if="tabTitle(t)" class="material-symbols-outlined text-primary" style="font-size: 10px">circle</span>
      <span
        v-if="locked(t.id)"
        class="material-symbols-outlined flex-none animate-spin text-primary"
        style="font-size: 14px"
        title="终端正在运行命令"
      >progress_activity</span>
      <span class="truncate text-sm leading-tight">{{ baseName(t.path) }}</span>
      <button
        class="state-layer -mr-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full transition-opacity disabled:pointer-events-none disabled:opacity-30"
        :class="locked(t.id) ? 'cursor-not-allowed' : ''"
        :disabled="locked(t.id)"
        :title="locked(t.id) ? '终端正在运行命令，无法关闭' : '关闭标签'"
        @click.stop="closeTab(t.id)"
      >
        <Icon name="close" :size="16" />
      </button>
    </div>
    <button
      class="state-layer flex h-10 w-10 flex-none items-center justify-center rounded-full text-primary"
      title="新建标签"
      @click="addTab()"
    >
      <Icon name="add" />
    </button>
  </nav>
</template>

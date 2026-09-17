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
  <!-- 移动端优先：标签行固定 40px 高（py-1 + h-8），字号 13px；
       标签宽度自适应平分可用宽度（flex-1），窄于 6.5rem 后转为横向滚动，
       既能撑满屏幕、减少空白，也把纵向空间留给文件列表 -->
  <nav
    class="flex flex-none items-center gap-1 overflow-x-auto bg-surface px-1 py-1 no-scrollbar"
    aria-label="标签页"
  >
    <div
      v-for="t in state.tabs"
      :key="t.id"
      class="ripple state-layer flex h-8 min-w-[6.5rem] flex-1 basis-0 cursor-pointer items-center gap-1 rounded-none pl-2.5 pr-0.5 transition-colors"
      :class="
        t.id === state.activeTabId
          ? 'bg-primary-container text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant'
      "
      @click="switchTab(t.id)"
    >
      <span v-if="tabTitle(t)" class="material-symbols-outlined flex-none text-primary" style="font-size: 8px">circle</span>
      <span
        v-if="locked(t.id)"
        class="material-symbols-outlined flex-none animate-spin text-primary"
        style="font-size: 13px"
        title="终端正在运行命令"
      >progress_activity</span>
      <span class="min-w-0 truncate text-[13px] leading-none">{{ baseName(t.path) }}</span>
      <button
        class="state-layer flex h-7 w-7 flex-none items-center justify-center rounded-full transition-opacity disabled:pointer-events-none disabled:opacity-30"
        :class="locked(t.id) ? 'cursor-not-allowed' : ''"
        :disabled="locked(t.id)"
        :title="locked(t.id) ? '终端正在运行命令，无法关闭' : '关闭标签'"
        @click.stop="closeTab(t.id)"
      >
        <Icon name="close" :size="15" />
      </button>
    </div>
    <button
      class="state-layer flex h-8 w-8 flex-none items-center justify-center rounded-none text-primary"
      title="新建标签"
      @click="addTab()"
    >
      <Icon name="add" :size="20" />
    </button>
  </nav>
</template>

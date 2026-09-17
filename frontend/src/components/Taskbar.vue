<script setup>
import { state, activeTab } from '../store.js'
import { activeTerm, setView, isTermOpen, closeTerminal } from '../terminal.js'

/* 当前标签是否已打开终端（底部「终端」按钮显示 × 关闭入口） */
function termOpen() {
  return isTermOpen(activeTab().id)
}
function busy() {
  return !!activeTerm()?.busy
}
/* 关闭终端会话：不切换视图（由 closeTerminal 内部决定退回文件视图） */
function closeTerm(e) {
  e.stopPropagation()
  closeTerminal(activeTab().id)
}
</script>

<template>
  <nav
    class="flex flex-none items-center justify-center gap-2 bg-surface px-2 py-1.5 pb-[calc(env(safe-area-inset-bottom)+6px)]"
    aria-label="视图切换"
  >
    <button
      class="state-layer flex h-9 min-w-24 flex-none items-center justify-center gap-1.5 rounded-full px-4 text-[13px] transition-colors"
      :class="
        state.view === 'files'
          ? 'bg-primary-container font-medium text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant'
      "
      @click="setView('files')"
    >
      <span class="material-symbols-outlined" style="font-size: 18px">folder</span>
      文件
    </button>
    <!-- 与标签页同构：外层容器负责切换视图，内层 × 负责关闭会话
         （不用嵌套 button，避免无效 HTML 与点击冒泡问题） -->
    <div
      class="state-layer relative flex h-9 min-w-24 flex-none cursor-pointer items-center justify-center gap-1.5 rounded-full pl-4 text-[13px] transition-colors"
      :class="[
        state.view === 'term'
          ? 'bg-primary-container font-medium text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant',
        termOpen() && !busy() ? 'pr-1' : 'pr-4',
      ]"
      role="button"
      tabindex="0"
      title="终端"
      @click="setView('term')"
    >
      <span class="material-symbols-outlined" style="font-size: 18px">terminal</span>
      终端
      <!-- 运行中：转圈（此时不显示 ×，先中断命令才能关闭） -->
      <span
        v-if="busy()"
        class="material-symbols-outlined animate-spin text-primary"
        style="font-size: 16px"
      >progress_activity</span>
      <!-- 已打开终端：小 × 关闭入口（与文件标签页关闭按钮同一交互） -->
      <button
        v-else-if="termOpen()"
        class="state-layer flex h-7 w-7 flex-none items-center justify-center rounded-full"
        title="关闭终端"
        aria-label="关闭终端"
        @click="closeTerm"
      >
        <span class="material-symbols-outlined" style="font-size: 15px">close</span>
      </button>
    </div>
  </nav>
</template>

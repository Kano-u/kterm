<script setup>
/* Taskbar：底部任务栏（文件 / 终端 / 设置）。
 *
 * 软键盘弹出时整条任务栏被 KeyboardBar 顶替（只有终端视图有此行为），
 * 因此这里用一个整块容器统一控制显隐。
 */
import { state, activeTab } from '../store.js'
import { activeTerm, setView, isTermOpen, closeTerminal } from '../terminal.js'
import { keyBarVisible, keyBarHidable } from '../keybar.js'
import Icon from './Icon.vue'

/* 按键栏已接管底部时隐藏任务栏 */
const keyboardTakeover = keyBarVisible

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

/* 「收起」后从任务栏唤回按键栏（软键盘开/合会自动清除该手动覆盖） */
function showKeyBar() {
  state.keyBarManual = true
}
</script>

<template>
  <nav
    v-if="!keyboardTakeover"
    class="flex flex-none items-center justify-center gap-2 bg-surface px-2 py-1.5 pb-[calc(env(safe-area-inset-bottom)+6px)]"
    aria-label="视图切换"
  >
    <button
      class="state-layer flex h-9 min-w-20 flex-none items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors"
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
      class="state-layer relative flex h-9 min-w-20 flex-none cursor-pointer items-center justify-center gap-1.5 rounded-full pl-3.5 text-[13px] transition-colors"
      :class="[
        state.view === 'term'
          ? 'bg-primary-container font-medium text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant',
        termOpen() && !busy() ? 'pr-1' : 'pr-3.5',
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
    <!-- 按键栏当前未显示时：任务栏提供唤出入口
         （auto 模式软键盘检测失灵时的保险，以及 always 模式手动收起后） -->
    <button
      v-if="keyBarHidable"
      class="state-layer flex h-9 flex-none items-center gap-1.5 rounded-full bg-surface-3 px-3.5 text-[13px] text-on-surface-variant"
      title="显示按键栏"
      @click="showKeyBar"
    >
      <Icon name="keyboard" :size="18" />
      按键
    </button>
    <!-- 设置 -->
    <button
      class="state-layer flex h-9 min-w-20 flex-none items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors"
      :class="
        state.view === 'settings'
          ? 'bg-primary-container font-medium text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant'
      "
      @click="setView('settings')"
    >
      <Icon name="settings" :size="18" />
      设置
    </button>
  </nav>
</template>

<script setup>
/* Taskbar：底部任务栏（文件 / 终端 / 设置）。
 *
 * 窄屏终端的内置键盘出现时整条任务栏被顶替（taskbarVisible 统一判定）。
 */
import { computed } from 'vue'
import { state, activeTab } from '../store.js'
import { activeTerm, setView, isTermOpen, closeTerminal } from '../terminal.js'
import { isEditorOpen, editorDirty, activeEditor, closeEditor } from '../editor.js'
import { enterSettings, leaveSettings } from '../settingsnav.js'
import { taskbarVisible } from '../keybar.js'
import { openBuiltIn } from '../ime.js'
import Icon from './Icon.vue'

/* 系统输入法接管时（resizes-visual 宿主上）软键盘会盖住页面底部，
 * 任务栏里的“内置键盘”入口靠这段 margin 抬到系统键盘之上。
 * 内置键盘显示时任务栏整条不渲染，所以不需要再乘 keyBarVisible。 */
const imeInset = computed(() => (state.imeActive ? state.keyboardInset : 0))


/* 设置页里点「文件/终端/编辑」：先退回该视图（会一次退掉设置页的历史记录） */
async function goFiles() {
  if (state.view === 'settings') await leaveSettings('files')
  else setView('files')
}
async function goTerm() {
  if (state.view === 'settings') await leaveSettings('term')
  else setView('term')
}
async function goEditor() {
  if (state.view === 'settings') await leaveSettings('editor')
  else setView('editor')
}

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

/* 当前标签是否已打开编辑会话（底部「编辑」按钮的显示条件）+ dirty 圆点 */
function editorOpen() {
  return isEditorOpen(activeTab().id)
}
function editorDot() {
  return editorDirty(activeTab().id)
}
function editorName() {
  const e = activeEditor()
  return e ? e.name : ''
}
function closeEditorSession(e) {
  e.stopPropagation()
  closeEditor(activeTab().id)
}

/* 系统输入法接管时，任务栏显示“内置键盘”按钮切回。 */
function backToBuiltIn() {
  openBuiltIn()
}
</script>

<template>
  <nav
    v-if="taskbarVisible"
    data-bottom-bar
    class="flex flex-none items-center justify-center gap-2 bg-surface px-2 py-1.5 pb-[calc(env(safe-area-inset-bottom)+6px)]"
    :style="imeInset ? { marginBottom: imeInset + 'px' } : null"
    aria-label="视图切换"
  >
    <button
      class="state-layer flex h-9 min-w-16 flex-none items-center justify-center gap-1.5 rounded-full px-3 text-[13px] transition-colors"
      :class="
        state.view === 'files'
          ? 'bg-primary-container font-medium text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant'
      "
      @click="goFiles"
    >
      <span class="material-symbols-outlined" style="font-size: 18px">folder</span>
      文件
    </button>
    <button
      v-if="state.imeActive"
      class="state-layer flex h-9 min-w-16 flex-none items-center justify-center gap-1.5 rounded-full bg-primary-container px-3 text-[13px] font-medium text-on-primary-container"
      @click="backToBuiltIn"
    >
      <span class="material-symbols-outlined" style="font-size: 18px">keyboard</span>
      内置键盘
    </button>
    <!-- 编辑：仅当该标签已打开编辑会话时出现；dirty 时带圆点，× 关闭会话 -->
    <div
      v-if="editorOpen()"
      class="state-layer relative flex h-9 min-w-16 flex-none cursor-pointer items-center justify-center gap-1.5 rounded-full pl-3 pr-1 text-[13px] transition-colors"
      :class="
        state.view === 'editor'
          ? 'bg-primary-container font-medium text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant'
      "
      role="button"
      tabindex="0"
      :title="'编辑 ' + editorName()"
      @click="goEditor"
    >
      <span class="material-symbols-outlined" style="font-size: 18px">edit_document</span>
      编辑
      <span v-if="editorDot()" class="h-2 w-2 flex-none rounded-full bg-primary" title="有未保存的修改" />
      <button
        class="state-layer flex h-7 w-7 flex-none items-center justify-center rounded-full"
        title="关闭编辑器"
        aria-label="关闭编辑器"
        @click="closeEditorSession"
      >
        <span class="material-symbols-outlined" style="font-size: 15px">close</span>
      </button>
    </div>
    <!-- 与标签页同构：外层容器负责切换视图，内层 × 负责关闭会话
         （不用嵌套 button，避免无效 HTML 与点击冒泡问题） -->
    <div
      class="state-layer relative flex h-9 min-w-16 flex-none cursor-pointer items-center justify-center gap-1.5 rounded-full pl-3 text-[13px] transition-colors"
      :class="[
        state.view === 'term'
          ? 'bg-primary-container font-medium text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant',
        termOpen() && !busy() ? 'pr-1' : 'pr-3',
      ]"
      role="button"
      tabindex="0"
      title="终端"
      @click="goTerm"
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
    <!-- 设置 -->
    <button
      class="state-layer flex h-9 min-w-16 flex-none items-center justify-center gap-1.5 rounded-full px-3 text-[13px] transition-colors"
      :class="
        state.view === 'settings'
          ? 'bg-primary-container font-medium text-on-primary-container'
          : 'bg-surface-3 text-on-surface-variant'
      "
      @click="enterSettings"
    >
      <Icon name="settings" :size="18" />
      设置
    </button>
  </nav>
</template>

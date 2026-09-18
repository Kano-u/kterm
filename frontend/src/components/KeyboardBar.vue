<script setup>
/* KeyboardBar：窄屏终端的内置键盘。
 *
 * 布局固定（见 vkeyboard.js），不再读取 settings.keys；每个按键点击后直接通过
 * sendInput 把字节序列写进当前标签的 PTY。CTRL / ALT / SHIFT 是粘滞修饰键，
 * 点亮后与下一个普通键组合发送，用后即消；CAPS 是锁定键，一直生效到再点一次。
 *
 * 右下角“输入法”不发送任何 PTY 字节：它切换到系统输入法，内置键盘收起，
 * 任务栏重新出现，用户可在任务栏上切回内置键盘。
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { state, activeTab } from '../store.js'
import { parseKey, sequenceFor } from '../settings.js'
import { keyboardActions, actionSequence, toggleSticky, consumeSticky, isSendable } from '../vkeyboard.js'
import { sendInput } from '../terminal.js'
import { keyBarVisible } from '../keybar.js'
import { openIme, openBuiltIn } from '../ime.js'
import Icon from './Icon.vue'

const sticky = ref([])
const rows = keyboardActions(parseKey)
const ready = computed(() => state.terminals.get(state.activeTabId)?.status === 'running')

function clearSticky() {
  sticky.value = []
}

function onKey(k) {
  if (!ready.value && k.kind !== 'ime') return
  if (k.kind === 'mod') {
    sticky.value = toggleSticky(sticky.value, k.mod)
    return
  }
  if (k.kind === 'ime') {
    clearSticky()
    openIme()
    return
  }
  if (!isSendable(k)) return
  const seq = actionSequence(k, sticky.value, sequenceFor)
  sticky.value = consumeSticky(sticky.value) // 只留锁定键（Caps）
  if (seq) sendInput(activeTab().id, seq)
}

/* 切换标签 / 会话结束 / 离开终端视图时清掉粘滞修饰键。
 * 本组件只在“内置键盘显示中”挂载，所以 imeActive 时它已被卸载，系统输入法
 * 的收尾统一由 App.vue 的 watch 调 resetImeState 完成（那里不会漏状态）。 */
watch(() => [state.activeTabId, state.view, ready.value], clearSticky)

/* 内置键盘出现时把焦点还给 xterm，并（重）写 inputmode=none：
 * 从系统输入法切回时 textarea 上可能还留着被移除过的属性。 */
onMounted(openBuiltIn)
onUnmounted(() => {
  /* 仅清理状态；任务栏会在系统输入法接管期间提供“内置键盘”入口。 */
  clearSticky()
})

function keyClass(k) {
  const on = k.kind === 'mod' && sticky.value.includes(k.mod)
  return on ? 'bg-primary text-on-primary' : 'bg-surface-3 text-on-surface'
}

/* 空格与输入法键比普通键宽：flex-grow 用 key 自带的 flex 权重（默认 1），
 * 所有键 basis-0 且 min-w-0，窄屏下不会被长标签（如 F10）撑出去。 */
function keyStyle(k) {
  return { flexGrow: String(k.flex || 1) }
}
</script>

<template>
  <div
    v-if="keyBarVisible"
    data-bottom-bar
    class="flex flex-none flex-col gap-px border-t border-outline-variant/40 bg-surface px-0.5 pt-0.5 pb-[calc(env(safe-area-inset-bottom)+2px)]"
    aria-label="终端内置键盘"
  >
    <div v-for="(row, i) in rows" :key="i" class="flex min-h-0 items-stretch gap-px">
      <button
        v-for="(k, j) in row"
        :key="k.value + '-' + i + '-' + j"
        type="button"
        tabindex="-1"
        class="state-layer flex h-7 min-w-0 basis-0 items-center justify-center overflow-hidden rounded-md px-0.5 text-[11px] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-35"
        :class="keyClass(k)"
        :style="keyStyle(k)"
        :disabled="!ready && k.kind !== 'ime'"
        :title="k.aria || k.label"
        :aria-label="k.aria || k.label"
        @mousedown.prevent
        @click="onKey(k)"
      >
        <Icon v-if="k.icon" :name="k.icon" :size="14" />
        <span v-else class="truncate">{{ k.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
/* KeyboardBar：「键盘增强」按键栏。
 *
 * 只在终端视图 + 软键盘弹出时出现（顶替底部任务栏），因此不留任何额外按钮，
 * 高度/字号尽量紧凑，把屏幕留给终端。
 *
 * 点击按键即通过 WS 把字节序列发送到当前标签的 PTY（映射见 settings.js）。
 * CTRL / ALT / SHIFT 是粘滞修饰键：点亮后与下一个按键组合成一次发送，用后即消；
 * 再次点击自己取消。终端会话未就绪时整条禁用。
 */
import { ref, computed, watch } from 'vue'
import { state, activeTab } from '../store.js'
import { keyRows, sequenceFor } from '../settings.js'
import { sendInput } from '../terminal.js'

const sticky = ref([])

/* 当前标签的终端是否可发送输入 */
const ready = computed(() => state.terminals.get(state.activeTabId)?.status === 'running')

function clearSticky() {
  sticky.value = []
}

function onKey(k) {
  if (!ready.value) return
  if (k.mod) {
    const i = sticky.value.indexOf(k.mod)
    if (i >= 0) sticky.value.splice(i, 1)
    else sticky.value.push(k.mod)
    return
  }
  const seq = sequenceFor(k, sticky.value)
  clearSticky()
  if (seq) sendInput(activeTab().id, seq)
}

/* 切换标签 / 会话结束（ready 转 false）时清掉粘滞修饰键 */
watch(() => state.activeTabId, clearSticky)
watch(ready, (ok) => {
  if (!ok) clearSticky()
})
</script>

<template>
  <!-- 紧凑布局：每行按键等宽铺满整行，行数由设置决定；
       被软键盘遮住时（resizes-visual 宿主）用 margin-bottom 抬高到键盘上方 -->
  <div
    class="flex flex-none flex-col gap-0.5 border-t border-outline-variant/40 bg-surface px-0.5 pt-0.5 pb-[calc(env(safe-area-inset-bottom)+2px)]"
    :style="state.keyboardInset ? { marginBottom: state.keyboardInset + 'px' } : null"
    aria-label="终端按键栏"
  >
    <div v-for="(row, i) in keyRows" :key="i" class="flex items-stretch gap-0.5">
      <button
        v-for="(k, j) in row"
        :key="k.name + '-' + j"
        type="button"
        tabindex="-1"
        class="state-layer flex h-7 min-w-0 flex-1 basis-0 items-center justify-center overflow-hidden rounded-md px-0.5 text-[11px] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-35"
        :class="
          k.mod && sticky.includes(k.mod)
            ? 'bg-primary text-on-primary'
            : 'bg-surface-3 text-on-surface'
        "
        :disabled="!ready"
        :title="k.name"
        @mousedown.prevent
        @click="onKey(k)"
      >
        <span class="truncate">{{ k.label }}</span>
      </button>
    </div>
  </div>
</template>

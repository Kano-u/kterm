<script setup>
/* KeyboardBar：「键盘增强」按键栏。
 *
 * 点击按键即通过 WS 把字节序列发送到当前标签的 PTY（映射见 settings.js）。
 * CTRL / ALT / SHIFT 是粘滞修饰键：点亮后与下一个按键组合成一次发送，用后即消；
 * 再次点击自己取消。终端会话未就绪时整条禁用。
 *
 * 显隐由 keybar.js 单点判定（与底部任务栏互斥）；「收起」置 keyBarManual=false，
 * 之后可从任务栏的「按键」按钮唤回。软键盘遮挡时（resizes-visual 宿主）用
 * margin-bottom 抬高到键盘上方。
 */
import { ref, computed, watch } from 'vue'
import { state, activeTab } from '../store.js'
import { keyRows, sequenceFor } from '../settings.js'
import { sendInput, lockKeyBar } from '../terminal.js'

const sticky = ref([])

/* 当前标签的终端是否可发送输入 */
const ready = computed(() => state.terminals.get(state.activeTabId)?.status === 'running')

/* 粘滞状态同步给全局：让 Taskbar 在修饰键按下时不要抢回底部 */
function syncSticky() {
  lockKeyBar.value = sticky.value.length > 0
}

function clearSticky() {
  sticky.value = []
  syncSticky()
}

function onKey(k) {
  if (!ready.value) return
  if (k.mod) {
    const i = sticky.value.indexOf(k.mod)
    if (i >= 0) sticky.value.splice(i, 1)
    else sticky.value.push(k.mod)
    syncSticky()
    return
  }
  const seq = sequenceFor(k, sticky.value)
  clearSticky()
  if (seq) sendInput(activeTab().id, seq)
}

/* 收起按键栏：还原底部任务栏（顺带清掉粘滞修饰键） */
function collapse() {
  clearSticky()
  state.keyBarManual = false
}

/* 切换标签 / 会话结束（ready 转 false）时清掉粘滞修饰键 */
watch(() => state.activeTabId, clearSticky)
watch(ready, (ok) => {
  if (!ok) clearSticky()
})
</script>

<template>
  <div
    class="flex max-h-[38dvh] flex-none flex-col gap-1 border-t border-outline-variant/40 bg-surface px-1 pt-1 pb-[calc(env(safe-area-inset-bottom)+6px)]"
    :style="state.keyboardInset ? { marginBottom: state.keyboardInset + 'px' } : null"
    aria-label="终端按键栏"
  >
    <!-- 状态提示 + 收起入口 -->
    <div class="flex flex-none items-center gap-2 px-1">
      <span class="min-w-0 flex-1 truncate text-[11px] text-on-surface-variant">
        <template v-if="sticky.length">已按下 {{ sticky.join(' + ') }}：点下一个键组合（再点修饰键取消）</template>
        <template v-else-if="!ready">终端未就绪</template>
        <template v-else>点击按键发送到终端</template>
      </span>
      <button
        class="state-layer flex h-7 flex-none items-center gap-1 rounded-full px-2.5 text-[11px] text-on-surface-variant"
        title="收起按键栏，显示底部任务栏"
        @click="collapse"
      >
        <span class="material-symbols-outlined" style="font-size: 16px">keyboard_hide</span>
        收起
      </button>
    </div>

    <!-- 每一行按键：行内横向滚动，行数由设置决定 -->
    <div
      v-for="(row, i) in keyRows"
      :key="i"
      class="flex flex-none items-stretch gap-1 overflow-x-auto no-scrollbar"
    >
      <button
        v-for="(k, j) in row"
        :key="k.name + '-' + j"
        type="button"
        tabindex="-1"
        class="state-layer flex h-9 min-w-11 flex-none items-center justify-center rounded-lg px-2.5 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-35"
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
        {{ k.label }}
      </button>
    </div>
  </div>
</template>

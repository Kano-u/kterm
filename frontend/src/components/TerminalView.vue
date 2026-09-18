<script setup>
/* TerminalView：管理每个 tabId 的 xterm 实例（层叠 + v-show，切回时 refit）。
 * WebSocket 建连与消息分发在 terminal.js，本组件负责 xterm 与 DOM。
 */
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { state, activeTab } from '../store.js'
import { connectTerminal, removeTerm, sendInput, sendResize } from '../terminal.js'
import { attachTouchScroll } from '../touchscroll.js'
import { applyInputMode } from '../inputmode.js'
import { syncInputModes } from '../ime.js'

const layersEl = ref(null)
const layerCount = ref(0) // 用于空态提示的显隐
/* tabId -> {el, term, fit, resizeObs, detachTouch} */
const xs = new Map()

/* 终端配色：固定深色，与 M3 dark 令牌一致（surface-1 = #2e2c36）。
 * 不用 matchMedia：整体 UI 已固定深色，终端若跟随系统可能出现白底黑字。 */
const TERM_THEME = {
  background: '#2e2c36',
  foreground: '#e6e0e9',
  cursor: '#d0bcff',
  cursorAccent: '#2e2c36',
  selectionBackground: 'rgba(208, 188, 255, 0.28)',
  scrollbarSliderBackground: 'rgba(202, 196, 208, 0.2)',
  scrollbarSliderHoverBackground: 'rgba(202, 196, 208, 0.35)',
  scrollbarSliderActiveBackground: 'rgba(202, 196, 208, 0.45)',
  black: '#4a4654',
  red: '#f2b8b5',
  green: '#b6f0c0',
  yellow: '#f5e0a3',
  blue: '#a8c7fa',
  magenta: '#e8b8e8',
  cyan: '#a7e6ea',
  white: '#e6e0e9',
  brightBlack: '#7a7488',
  brightRed: '#ffb4ab',
  brightGreen: '#c8f7cf',
  brightYellow: '#fff0b3',
  brightBlue: '#c2d7ff',
  brightMagenta: '#f5c8f5',
  brightCyan: '#bdf0f3',
  brightWhite: '#ffffff',
}

function createXterm(tabId) {
  const el = document.createElement('div')
  // term-touch：touch-action: none，让浏览器不接管纵向手势，
  //   否则 touchmove 会变成不可取消，触摸滚动无法生效（见 touchscroll.js）
  // term-gutter：左右留白，避开曲面屏的物理弯折（见 style.css）
  el.className = 'absolute inset-0 term-touch term-gutter'
  el.style.display = 'none'
  layersEl.value.appendChild(el)

  const term = new Terminal({
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 13,
    cursorBlink: true,
    allowProposedApi: true,
    theme: TERM_THEME,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(el)
  /* 窄屏内置键盘出现时抑制系统软键盘；右下角输入法键会临时移除它。 */
  applyInputMode(term.textarea, state.mobileKeyboard && state.view === 'term' && !state.imeActive)
  term.onData((d) => sendInput(tabId, d))
  // xterm 6 内部只处理 wheel，移动端拖动需要自己实现（含惯性）
  const detachTouch = attachTouchScroll(el, term)

  const resizeObs = new ResizeObserver(() => {
    if (el.style.display !== 'none') {
      try {
        fit.fit()
        sendResize(tabId, term.cols, term.rows)
      } catch { /* 尺寸为 0 时忽略 */ }
    }
  })
  resizeObs.observe(el)

  const x = { el, term, fit, resizeObs, detachTouch }
  xs.set(tabId, x)
  layerCount.value = xs.size
  return x
}

function showLayer(tabId) {
  for (const [id, x] of xs) {
    const show = id === tabId
    x.el.style.display = show ? 'block' : 'none'
    if (show) {
      nextTick(() => {
        try {
          x.fit.fit()
          // 同步 PTY 尺寸
          sendResize(tabId, x.term.cols, x.term.rows)
        } catch { /* 尺寸为 0 时忽略 */ }
        x.term.focus()
        // 新建的层可能没赶上 inputmode 同步（多标签层叠），补一次
        syncInputModes()
      })
    }
  }
}

/* 建连（惰性）：状态非 ended 才连接。先创建 xterm 层再建连，
 * 保证输出帧到达时已有实例可写入。 */
function openSession(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab) return
  if (!xs.has(tabId)) createXterm(tabId)
  connectTerminal(tab, {
    onOutput: (data) => {
      const x = xs.get(tabId)
      if (x) x.term.write(data)
    },
    onExit: () => {
      // T4 完整处理（自动切回文件视图）；T1 先清理 xterm 层
      disposeXterm(tabId)
      removeTerm(tabId)
    },
    onClose: () => {
      disposeXterm(tabId)
      removeTerm(tabId)
    },
  })
}

function disposeXterm(tabId) {
  const x = xs.get(tabId)
  if (!x) return
  x.resizeObs.disconnect()
  x.detachTouch()
  x.term.dispose()
  x.el.remove()
  xs.delete(tabId)
  layerCount.value = xs.size
}

/* 窄屏判定 / 系统输入法状态变化时，同步所有层的隐藏输入框。
 * 逐层同步而不是只改当前层：后台标签的 textarea 若留着未抑制状态，
 * 切回该标签时系统键盘会先弹一下再被抑制。 */
watch(
  () => [state.mobileKeyboard, state.imeActive, state.activeTabId, state.view],
  () => syncInputModes(),
  { flush: 'post' },
)

/* 清理已关闭标签遗留的 xterm 层（closeTab 只关闭 WS，DOM 需在此回收） */
watch(
  () => state.tabs.map((t) => t.id).join(','),
  () => {
    const alive = new Set(state.tabs.map((t) => t.id))
    for (const tabId of [...xs.keys()]) {
      if (!alive.has(tabId)) disposeXterm(tabId)
    }
  },
)

/* 会话被外部关闭（底部「终端」按钮的 ×）→ 回收对应 xterm 层 */
watch(
  () => state.terminals.size,
  () => {
    for (const tabId of [...xs.keys()]) {
      if (!state.terminals.has(tabId)) disposeXterm(tabId)
    }
  },
)

/* 激活标签变化 / 视图切换 → 显示对应层并惰性建连 */
watch(
  () => [state.activeTabId, state.view],
  ([tabId, view]) => {
    if (view !== 'term') return
    const entry = state.terminals.get(tabId)
    // 无会话、已结束、或 xterm 层已销毁 → 新建（T4：切标签/重进自动建连）
    if (!entry || entry.status === 'ended' || !xs.has(tabId)) {
      if (entry && entry.status === 'ended') removeTerm(tabId)
      openSession(tabId)
    }
    showLayer(tabId)
  },
  { flush: 'post' },
)

/* 固定深色主题，无需监听系统明暗变化（onMounted/onUnmounted 仅供 xterm 清理）。 */
onUnmounted(() => {
  for (const tabId of [...xs.keys()]) disposeXterm(tabId)
})
</script>

<template>
  <main class="relative min-h-0 flex-1 overflow-hidden bg-surface-1">
    <!-- 空态：无任何会话层时显示 -->
    <div
      v-if="layerCount === 0"
      class="flex h-full items-center justify-center text-sm text-on-surface-variant/70"
    >
      正在连接终端…
    </div>
    <!-- xterm 层叠容器 -->
    <div ref="layersEl" class="absolute inset-0"></div>
  </main>
</template>

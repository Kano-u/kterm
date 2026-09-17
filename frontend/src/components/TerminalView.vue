<script setup>
/* TerminalView：管理每个 tabId 的 xterm 实例（层叠 + v-show，切回时 refit）。
 * WebSocket 建连与消息分发在 terminal.js，本组件负责 xterm 与 DOM。
 */
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { state, activeTab } from '../store.js'
import { connectTerminal, removeTerm, sendInput, sendResize } from '../terminal.js'

const layersEl = ref(null)
const layerCount = ref(0) // 用于空态提示的显隐
/* tabId -> {el, term, fit, resizeObs} */
const xs = new Map()

const darkMq = window.matchMedia('(prefers-color-scheme: dark)')

function termTheme(dark) {
  return dark
    ? { background: '#1b1b1f', foreground: '#e3e2e6', cursor: '#e3e2e6' }
    : { background: '#fef7ff', foreground: '#1d1b20', cursor: '#1d1b20' }
}

function createXterm(tabId) {
  const el = document.createElement('div')
  el.className = 'absolute inset-0'
  el.style.display = 'none'
  layersEl.value.appendChild(el)

  const term = new Terminal({
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 13,
    cursorBlink: true,
    allowProposedApi: true,
    theme: termTheme(darkMq.matches),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(el)
  term.onData((d) => sendInput(tabId, d))

  const resizeObs = new ResizeObserver(() => {
    if (el.style.display !== 'none') {
      try {
        fit.fit()
        sendResize(tabId, term.cols, term.rows)
      } catch { /* 尺寸为 0 时忽略 */ }
    }
  })
  resizeObs.observe(el)

  const x = { el, term, fit, resizeObs }
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
  x.term.dispose()
  x.el.remove()
  xs.delete(tabId)
  layerCount.value = xs.size
}

/* 激活标签变化 / 视图切换 → 显示对应层并惰性建连 */
watch(
  () => [state.activeTabId, state.view],
  ([tabId, view]) => {
    if (view !== 'term') return
    const entry = state.terminals.get(tabId)
    if (!entry || entry.status === 'ended') {
      openSession(tabId)
    }
    showLayer(tabId)
  },
  { flush: 'post' },
)

/* 暗色模式切换即时生效 */
function applyTheme() {
  const theme = termTheme(darkMq.matches)
  for (const x of xs.values()) x.term.options.theme = theme
}
onMounted(() => darkMq.addEventListener('change', applyTheme))
onUnmounted(() => {
  darkMq.removeEventListener('change', applyTheme)
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

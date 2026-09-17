/* 终端会话管理：WebSocket 建连、消息分发、xterm 实例由 TerminalView 持有。
 *
 * state.terminals: Map<tabId, {
 *   status: 'starting' | 'running' | 'ended',
 *   busy: boolean,        // 是否有命令在运行（T3 运行锁定）
 *   degraded: boolean,    // 该 shell 无 OSC 133 集成（cmd），busy 为启发式近似
 *   ws: WebSocket | null,
 * }>
 */
import { reactive } from 'vue'
import { state, activeTab } from './store.js'
import { toast } from './toast.js'

/* 已提示过降级的 tab（cmd 等），避免每次重连重复 toast */
const degradedNotified = new Set()

/* 取某 tab 的终端条目（无则 undefined） */
export function termOf(tabId) {
  return state.terminals.get(tabId)
}

/* 当前激活标签的终端条目 */
export function activeTerm() {
  return state.terminals.get(activeTab().id)
}

/* 该标签是否已打开终端会话（starting/running）——底部「终端」按钮的关闭标记用。
 * 条目仅在真正建连/建 xterm 时创建，会话结束即移除，故存在即「已打开」。 */
export function isTermOpen(tabId) {
  const t = state.terminals.get(tabId)
  return !!t && t.status !== 'ended'
}

/* 创建终端条目（惰性：首次进入终端视图时调用） */
export function ensureTermEntry(tabId) {
  let t = state.terminals.get(tabId)
  if (!t) {
    t = reactive({ status: 'starting', busy: false, degraded: false, ws: null })
    state.terminals.set(tabId, t)
  }
  return t
}

/* 清理终端条目（会话结束 / 连接失败） */
export function removeTerm(tabId) {
  const t = state.terminals.get(tabId)
  if (t && t.ws) {
    try { t.ws.close() } catch { /* ignore */ }
  }
  state.terminals.delete(tabId)
}

/* 建立 WebSocket 连接。onFrame 回调接收解析后的输出帧：
 *   {kind:'output', data:Uint8Array} | {kind:'json', msg:Object} | {kind:'close'}
 * xterm 实例与 DOM 交互全部留在 TerminalView，本模块只管连接与状态。 */
export function connectTerminal(tab, handlers) {
  const entry = ensureTermEntry(tab.id)
  if (entry.ws && (entry.ws.readyState === WebSocket.OPEN || entry.ws.readyState === WebSocket.CONNECTING)) {
    return entry // 已有连接
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${location.host}/api/term/ws?tab=${encodeURIComponent(tab.id)}&path=${encodeURIComponent(tab.path)}`
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  entry.ws = ws
  entry.status = 'starting'

  ws.onopen = () => {
    entry.status = 'running'
    handlers.onOpen && handlers.onOpen()
  }
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      handlers.onOutput && handlers.onOutput(new Uint8Array(ev.data))
      return
    }
    try {
      const msg = JSON.parse(ev.data)
      onJsonMsg(tab, entry, msg, handlers)
    } catch {
      /* 忽略非法帧 */
    }
  }
  ws.onclose = () => {
    if (state.terminals.get(tab.id) === entry) {
      entry.ws = null
      if (entry.status !== 'ended') {
        // 非正常 exit（断网 / 刷新）也按会话结束处理，下次进入新建
        entry.status = 'ended'
        handlers.onClose && handlers.onClose()
      }
    }
  }
  ws.onerror = () => {
    /* onclose 会跟随触发 */
  }
  return entry
}

function onJsonMsg(tab, entry, msg, handlers) {
  switch (msg.t) {
    case 'exit': // T4：shell 退出 → 结束会话并清理
      entry.status = 'ended'
      endSession(tab.id, '终端会话已结束')
      handlers.onExit && handlers.onExit(tab.id)
      break
    case 'error': // 启动失败 / 被其他窗口占用（错误文案已 toast）
      toast(msg.d || '终端启动失败')
      entry.status = 'ended'
      endSession(tab.id, null)
      handlers.onExit && handlers.onExit(tab.id)
      break
    case 'cwd':
      handleTerminalCwd(tab, msg.abs)
      break
    case 'shell': // T3：首帧 shell 信息（降级提示）
      entry.degraded = !!msg.degraded
      if (entry.degraded && !degradedNotified.has(tab.id)) {
        degradedNotified.add(tab.id)
        toast('当前 shell 无运行状态集成，锁定判断为近似结果')
      }
      break
    case 'busy': // T3：运行状态 → 运行锁定
      entry.busy = !!msg.on
      break
  }
}

/* ---------- T4：会话结束处理 ----------
 * shell exit / 连接被拒 / 启动失败后：若用户正停留在该标签的终端视图，
 * 自动切回文件视图（msg 非空时给出提示），避免停留在空白的终端页。 */
function endSession(tabId, msg) {
  if (state.view === 'term' && state.activeTabId === tabId) {
    state.view = 'files'
    if (msg) toast(msg, 'ok')
  }
}

/* 关闭该标签的终端会话（底部终端按钮的 ×）：杀掉 PTY、回到文件视图。
 * xterm 层的回收由 TerminalView 监听 terminals 表变化完成。busy 时不允许（先中断命令）。 */
export function closeTerminal(tabId) {
  if (!state.terminals.has(tabId)) return false
  if (isBusy(tabId)) {
    toast('终端正在运行命令')
    return false
  }
  if (state.view === 'term' && state.activeTabId === tabId) state.view = 'files'
  removeTerm(tabId)
  return true
}

/* ---------- T2：双向目录同步 ----------
 * 终端 OSC 7 上报的 cwd 是绝对路径，统一换算为展示路径（见 store.js 路径工具）。
 * 访问范围不受限，因此终端 cd 到哪里，文件页就跟到哪里。 */

/* 导航回调由外部（App.vue）注入，避免 terminal.js ←→ actions.js 循环导入。
 * 签名 (tab, rel) => Promise */
let navigateTabFn = null

export function setNavigateTab(fn) {
  navigateTabFn = fn
}

/* 绝对路径 → 展示路径：位于起始目录内时用相对路径（'' 表示起始目录本身），
 * 否则用 `/` 分隔的绝对路径。Windows 下 /api/root 与 OSC 7 上报的盘符大小写
 * 可能不一致，比较时统一小写；返回值一律用 OSC 上报的原始大小写。 */
export function absToDisplay(abs, startDir) {
  if (!abs) return ''
  const slash = (s) => s.replace(/\\/g, '/')
  const a = slash(abs)
  if (!startDir) return a
  const root = slash(startDir).replace(/\/+$/, '')
  const lower = a.toLowerCase()
  const rl = root.toLowerCase()
  if (lower === rl) return ''
  if (lower.startsWith(rl + '/')) return a.slice(root.length + 1)
  return a
}

/* 收到 OSC 7 上报（服务端已解析为绝对路径并随 cwd 帧下发）：
 * 换算展示路径并导航过去 —— 访问范围不受限，终端 cd 到哪里文件页就跟到哪里。 */
export function handleTerminalCwd(tab, abs) {
  const rel = absToDisplay(abs, state.startDir)
  if (rel === tab.path) return // 防回环：注入 cd 后的上报与当前一致
  if (!navigateTabFn) return
  // 注意：导航到 tab 自身（终端可能属于后台标签），且标记 fromTerminal，
  // 以免再向其注入 cd（那会在终端里凭空多出一条 cd 命令）。
  Promise.resolve(navigateTabFn(tab, rel)).catch(() => { /* 错误已由 navigate 内部 toast */ })
}

/* 文件页导航 → 向该 tab 的终端注入 cd（展示路径原样传给服务端解析） */
export function sendCd(tabId, rel) {
  const t = state.terminals.get(tabId)
  if (!t || !t.ws || t.ws.readyState !== WebSocket.OPEN) return
  if (t.status !== 'running') return
  t.ws.send(JSON.stringify({ t: 'cd', rel }))
}

/* 发送 JSON 控制帧 */
export function sendFrame(tabId, obj) {
  const t = state.terminals.get(tabId)
  if (t && t.ws && t.ws.readyState === WebSocket.OPEN) {
    t.ws.send(JSON.stringify(obj))
  }
}

/* 发送键入 */
export function sendInput(tabId, data) {
  sendFrame(tabId, { t: 'i', d: data })
}

/* 发送 resize */
export function sendResize(tabId, cols, rows) {
  sendFrame(tabId, { t: 'resize', cols, rows })
}

/* ---------- T3：运行锁定 ---------- */

/* 指定标签的终端是否有命令在运行 */
export function isBusy(tabId) {
  const t = state.terminals.get(tabId)
  return !!(t && t.busy)
}

/* 当前激活文件标签的终端是否正在运行命令 */
export function activeBusy() {
  return isBusy(activeTab().id)
}

/* 允许在 busy 时执行的写操作前置校验：命中则 toast 并返回 false。
 * 服务端 handlers 也会做同样的兜底（拒绝写入 busy 终端目录）。 */
export function ensureUnlocked() {
  if (activeBusy()) {
    toast('终端正在运行命令')
    return false
  }
  return true
}

/* 关闭标签的锁定校验：busy 的终端不能关（先让用户中断命令） */
export function ensureCloseable(tabId) {
  if (isBusy(tabId)) {
    toast('终端正在运行命令')
    return false
  }
  return true
}

/* 是否有任一终端正在运行命令（T4：beforeunload 拦截刷新/关闭页面） */
export function anyBusy() {
  for (const t of state.terminals.values()) {
    if (t.busy) return true
  }
  return false
}

/* 视图切换：进入终端视图时惰性建连（进入编辑器视图时终端只保持已有连接）。 */
export function setView(view) {
  state.view = view
  if (view === 'term') {
    const tab = activeTab()
    const entry = state.terminals.get(tab.id)
    if (!entry || entry.status === 'ended') {
      removeTerm(tab.id)
      state.terminals.delete(tab.id)
    }
  }
}

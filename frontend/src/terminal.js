/* 终端会话管理：WebSocket 建连、消息分发、xterm 实例由 TerminalView 持有。
 *
 * state.terminals: Map<tabId, {
 *   status: 'starting' | 'running' | 'ended',
 *   busy: boolean,        // T3 使用
 *   outsideRoot: boolean, // T2 使用
 *   ws: WebSocket | null,
 * }>
 */
import { reactive } from 'vue'
import { state, activeTab } from './store.js'
import { toast } from './toast.js'

/* 取某 tab 的终端条目（无则 undefined） */
export function termOf(tabId) {
  return state.terminals.get(tabId)
}

/* 当前激活标签的终端条目 */
export function activeTerm() {
  return state.terminals.get(activeTab().id)
}

/* 创建终端条目（惰性：首次进入终端视图时调用） */
export function ensureTermEntry(tabId) {
  let t = state.terminals.get(tabId)
  if (!t) {
    t = reactive({ status: 'starting', busy: false, outsideRoot: false, ws: null })
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
      onJsonMsg(tab.id, entry, msg, handlers)
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

function onJsonMsg(tabId, entry, msg, handlers) {
  switch (msg.t) {
    case 'exit': // shell 退出（T4 完整处理；T1 先标记结束）
      entry.status = 'ended'
      handlers.onExit && handlers.onExit(tabId)
      break
    case 'error':
      toast(msg.d || '终端启动失败')
      entry.status = 'ended'
      handlers.onExit && handlers.onExit(tabId)
      break
    case 'cwd': // T2
    case 'busy': // T3
      break
  }
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

/* 视图切换：进入终端视图时惰性建连 */
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

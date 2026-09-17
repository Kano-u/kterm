/* 终端会话管理：WebSocket 建连、消息分发、xterm 实例由 TerminalView 持有。
 *
 * state.terminals: Map<tabId, {
 *   status: 'starting' | 'running' | 'ended',
 *   busy: boolean,        // 是否有命令在运行（T3 运行锁定）
 *   degraded: boolean,    // 该 shell 无 OSC 133 集成（cmd），busy 为启发式近似
 *   outsideRoot: boolean, // cwd 是否在 root 外（T2）
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

/* 创建终端条目（惰性：首次进入终端视图时调用） */
export function ensureTermEntry(tabId) {
  let t = state.terminals.get(tabId)
  if (!t) {
    t = reactive({ status: 'starting', busy: false, degraded: false, outsideRoot: false, ws: null })
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
    case 'exit': // shell 退出（T4 完整处理；T1 先标记结束）
      entry.status = 'ended'
      handlers.onExit && handlers.onExit(tab.id)
      break
    case 'error':
      toast(msg.d || '终端启动失败')
      entry.status = 'ended'
      handlers.onExit && handlers.onExit(tab.id)
      break
    case 'cwd':
      handleCwd(tab, entry, msg.abs)
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

/* ---------- T2：双向目录同步 ---------- */

/* cwd 换算相对 root 路径。
 * 服务端 /api/list 返回 {"path": "<相对路径>"}，root 绝对路径可由首次列表得知；
 * 这里用「root 内路径必以 rootDir 前缀开头」的约定换算。
 * rootDir 在建连前由 /api/list 的 meta 无法直接获得——改为利用导航接口：
 * tab.path 相对路径 + 终端上报 abs，服务端 Resolve 的逆运算在本端做不了，
 * 因此由服务端保证：cwd abs 一定来自 Resolve 语义；此处仅做前缀剥离。 */
let rootDir = '' // root 绝对路径（首次 cwd 同步时由 /api/root 获取或推断）

/* 导航回调由外部（App.vue）注入，避免 terminal.js ←→ actions.js 循环导入。
 * 签名 (tab, rel) => Promise */
let navigateTabFn = null

export function setNavigateTab(fn) {
  navigateTabFn = fn
}

/* 供 App 启动时注入 root 绝对路径（list 元信息） */
export function setRootDir(abs) {
  rootDir = abs || ''
}

/* abs（绝对路径）→ 相对 root 路径；不在 root 内返回 null */
export function absToRel(abs) {
  if (!rootDir) return null
  // rootDir 与 abs 均为 OS 原生分隔符；先统一分隔符再比较
  const norm = (s) => s.replace(/\\/g, '/')
  const root = norm(rootDir).replace(/\/$/, '')
  const p = norm(abs)
  if (p === root) return ''
  if (p.startsWith(root + '/')) {
    return p.slice(root.length + 1)
  }
  return null
}

/* 收到 OSC 7 上报：换算相对路径，决定文件页是否跟随 */
function handleCwd(tab, entry, abs) {
  const rel = absToRel(abs)
  if (rel === null) {
    // root 外：置标记，文件页不动
    entry.outsideRoot = true
    return
  }
  entry.outsideRoot = false
  if (rel === tab.path) return // 防回环：注入 cd 后的上报与当前一致
  // 终端 cd 到 root 内新目录 → 文件页跟随。
  // 注意：导航到 tab 自身（终端可能属于后台标签），且标记 fromTerminal
  // 以免 navigate 再向其注入 cd（那会在终端里凭空多出一条 cd 命令）。
  if (!navigateTabFn) return
  Promise.resolve(navigateTabFn(tab, rel)).catch(() => { /* 错误已由 navigate 内部 toast */ })
}

/* 文件页导航 → 向该 tab 的终端注入 cd 帧（新路径在 root 内即相对路径本身） */
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

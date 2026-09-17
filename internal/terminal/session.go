package terminal

// Session 是单个终端会话：一个 PTY 进程 + 一条 WebSocket 连接。
//
// 生命周期：WS 建连 → fs.Resolve(relPath) 得初始 cwd → 启动 PTY + shell
// → 三个 goroutine（pty→ws 输出泵 / ws→pty 输入泵 / 退出监听）
// → WS 断开或 shell 退出时杀进程并从 manager 移除。
//
// WS 协议（见 PLAN-terminal.md）：
//
//	C→S text  {"t":"i","d":"<键入>"}              写入 PTY stdin
//	C→S text  {"t":"resize","cols":N,"rows":N}
//	C→S text  {"t":"cd","rel":"a/b"}              文件页导航注入（T2）
//	S→C bin   PTY 原始输出字节
//	S→C text  {"t":"cwd","abs":"C:\\..."}         OSC 7 解析结果（T2）
//	S→C text  {"t":"busy","on":true|false}        OSC 133 解析结果（T3）
//	S→C text  {"t":"exit"}                        shell 进程退出
//
// T0 骨架：仅定义结构与生命周期约定，实现在 T1。
type Session struct {
	tabID string // 客户端文件标签 id（localStorage 持久化的那个）
	wsDir string // 初始工作目录（绝对路径，由 fs.Resolve 得到）
}

package terminal

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/aymanbagabas/go-pty"
	"github.com/coder/websocket"
)

// Session 是单个终端会话：一个 PTY 进程 + 一条 WebSocket 连接。
//
// 生命周期：WS 建连 → fs.Resolve(relPath) 得初始 cwd → 启动 PTY + shell
// → 三个 goroutine（pty→ws 输出泵 / ws→pty 输入泵 / 退出监听）
// → WS 断开或 shell 退出时杀进程并从 manager 移除。
//
// WS 协议（见 PLAN-terminal.md）：
//
//	C→S text  {"t":"i","d":"<键入>"}              写入 PTY stdin（含回车 → busy）
//	C→S text  {"t":"resize","cols":N,"rows":N}
//	C→S text  {"t":"cd","rel":"a/b"}              文件页导航注入（T2 起生效）
//	S→C bin   PTY 原始输出字节（经 OSC 扫描器旁路解析，不吞字节）
//	S→C text  {"t":"shell","kind":...,"degraded":bool}  连接的 shell 信息（T3）
//	S→C text  {"t":"cwd","abs":...}               OSC 7 解析结果（T2）
//	S→C text  {"t":"busy","on":true}              busy 状态变化（T3，见 busy.go）
//	S→C text  {"t":"exit"}                        shell 进程退出
//	S→C text  {"t":"error","d":"..."}             会话建立失败 / 拒绝
type Session struct {
	tabID string     // 客户端文件标签 id（localStorage 持久化的那个）
	cwd   string     // 最新工作目录（绝对路径；OSC 7 上报时更新）
	shell *shellInfo // 探测到的 shell（测试假 PTY 时为 nil）
	mgr   *Manager   // 所属注册表（退出时自行移除、cd 解析用）

	pty pty.Pty
	cmd cmdHandle // shell 进程句柄

	busy bool       // 最新 busy 状态（T3 锁定使用，见 busy.go）
	mu   sync.Mutex // 保护 cwd / busy / integrationStart / integrationEnd / 计时器

	// T3 busy 判定（见 busy.go）：integrationStart 表示 shell 会发 OSC 133;C（命令开始，
	// 状态完全以 133 为准）；integrationEnd 表示会发 133;D（命令结束）。
	// quietTimer / capTimer 仅用于两者皆无的降级 shell（cmd）。
	integrationStart bool
	integrationEnd   bool
	quietTimer       *time.Timer
	capTimer         *time.Timer

	// pushFrame 的目标：当前连接持有的回调（Serve 时设置），无连接时为 nil。
	frameSink func(b []byte)

	// closeOnce 保证退出清理只执行一次（WS 断开 / shell 退出双触发路径）。
	closeOnce sync.Once
	done      chan struct{} // 关闭即表示会话已终止

	// 测试钩子：注入假 pty + 假进程（生产为 nil）。
	newPty func() (pty.Pty, cmdHandle, error)
}

// cmdHandle 抽象 shell 进程：生产为 *pty.Cmd 适配器，测试为假实现。
type cmdHandle interface {
	Wait() error
	Kill() error
}

// ptyCmdAdapter 把 go-pty 的 *pty.Cmd 适配为 cmdHandle。
type ptyCmdAdapter struct{ c *pty.Cmd }

func (a ptyCmdAdapter) Wait() error { return a.c.Wait() }
func (a ptyCmdAdapter) Kill() error {
	if a.c.Process == nil {
		return nil
	}
	return a.c.Process.Kill()
}

// wsConn 是 WebSocket 连接的最小抽象，便于单测注入内存假连接。
type wsConn interface {
	Read() (websocket.MessageType, []byte, error)
	Write(websocket.MessageType, []byte) error
	Close()
}

// SessionDeps 供测试注入假实现；生产环境传 nil 全部用默认。
type SessionDeps struct {
	NewPty func() (pty.Pty, cmdHandle, error)
}

// Start 创建并启动会话：启动 PTY + shell，注册到 manager。
// tabID 已有会话时返回该已有会话与已存在标记（调用方应拒绝连接）。
func Start(m *Manager, tabID, relPath string, deps *SessionDeps) (*Session, bool, error) {
	cwd, err := m.Resolve(relPath)
	if err != nil {
		return nil, false, err
	}
	s := &Session{tabID: tabID, cwd: cwd, mgr: m, done: make(chan struct{})}
	if deps != nil {
		s.newPty = deps.NewPty
	}
	if old := m.Register(s); old != nil {
		return old, true, nil
	}
	if err := s.launch(); err != nil {
		m.Remove(s)
		return nil, false, err
	}
	return s, false, nil
}

// launch 启动 PTY 与 shell 进程。
func (s *Session) launch() error {
	if s.newPty != nil {
		p, c, err := s.newPty()
		if err != nil {
			return err
		}
		s.pty, s.cmd = p, c
		return nil
	}
	sh, err := detectShell()
	if err != nil {
		return errors.New("未找到可用的 shell")
	}
	s.shell = sh
	p, err := pty.New()
	if err != nil {
		return err
	}
	s.pty = p
	cmd := p.Command(sh.path, sh.args...)
	cmd.Dir = s.cwd
	if err := cmd.Start(); err != nil {
		_ = p.Close()
		return err
	}
	s.cmd = ptyCmdAdapter{c: cmd}
	return nil
}

// Serve 进入会话主循环：启动输出泵与退出监听，循环读取 WS 输入。
// 返回即表示连接结束，调用方负责清理（杀 PTY + 从 manager 移除）。
func (s *Session) Serve(ws wsConn) {
	s.frameSink = func(b []byte) { _ = ws.Write(websocket.MessageText, b) }
	s.pushShellInfo()
	go s.pumpOutput(ws)
	go s.watchExit(ws)

	defer func() { s.frameSink = nil }()
	for {
		msgType, data, err := ws.Read()
		if err != nil {
			return
		}
		if msgType != websocket.MessageText {
			continue
		}
		s.handleMessage(data)
	}
}

// inMsg C→S text 帧格式：{"t":"i"|"resize"|"cd","d"/"cols"/"rows"/"rel":...}
type inMsg struct {
	T    string `json:"t"`
	D    string `json:"d"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
	Rel  string `json:"rel"`
}

// handleMessage 分发 C→S 控制帧。
func (s *Session) handleMessage(data []byte) {
	var m inMsg
	if err := json.Unmarshal(data, &m); err != nil {
		return // 忽略非法帧
	}
	switch m.T {
	case "i": // 键入
		if m.D != "" {
			s.writeInput([]byte(m.D))
			s.noteInput([]byte(m.D)) // T3：降级模式下回车 → busy
		}
	case "resize":
		if m.Cols > 0 && m.Rows > 0 {
			_ = s.pty.Resize(m.Cols, m.Rows)
		}
	case "cd": // 文件页导航注入
		abs, err := s.resolveRel(m.Rel)
		if err != nil {
			return
		}
		s.writeInput([]byte(cdCommand(s.shellKind(), abs)))
	}
}

// shellKind 返回探测到的 shell 种类（未知时按运行时 GOOS 推断），
// 决定 cd 注入的语法（见 cdCommand）。
func (s *Session) shellKind() string {
	if s.shell != nil && s.shell.kind != "" {
		return s.shell.kind
	}
	if runtimeGOOS() == "windows" {
		return "powershell" // 未探测到时 Windows 保守回退
	}
	return "sh"
}

// writeInput 写入 PTY stdin（ConPTY 写失败常伴随进程退出，忽略错误由退出监听收尾）。
func (s *Session) writeInput(b []byte) {
	_, _ = s.pty.Write(b)
}

// outCWD S→C {"t":"cwd","abs":...}
type outCWD struct {
	Type string `json:"t"`
	Abs  string `json:"abs"`
}

// outBusy S→C {"t":"busy","on":true}
type outBusy struct {
	Type string `json:"t"`
	On   bool   `json:"on"`
}

// outShell S→C {"t":"shell","kind":"pwsh","degraded":false}
// 前端据此提示 cmd 等无集成 shell 的降级行为。
type outShell struct {
	Type     string `json:"t"`
	Kind     string `json:"kind"`
	Degraded bool   `json:"degraded"`
}

// pushShellInfo 建连后立即告知前端 shell 种类与是否有 OSC 集成能力。
func (s *Session) pushShellInfo() {
	degraded := s.shell != nil && s.shell.degraded
	if b, err := json.Marshal(outShell{Type: "shell", Kind: s.shellKind(), Degraded: degraded}); err == nil {
		s.pushFrame(b)
	}
}

// pumpOutput 从 PTY 读输出，经 OSC 扫描器旁路解析后原样转发（binary 帧）。
// 扫描器不吞字节：emit 收到的字节就是透传给前端的全部输出。
func (s *Session) pumpOutput(ws wsConn) {
	scanner := newOSCScanner(
		func(b []byte) { _ = ws.Write(websocket.MessageBinary, b) },
		s.onOSC7,
		s.onOSC133,
	)
	buf := make([]byte, 32*1024)
	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			scanner.Feed(buf[:n])
			s.noteOutput() // T3：降级模式下按输出静默复位 busy
		}
		if err != nil {
			if err != io.EOF && !errors.Is(err, os.ErrClosed) {
				log.Printf("[terminal] pty read: %v", err)
			}
			return
		}
	}
}

// onOSC7 处理 OSC 7 上报：更新会话 cwd 并推送 {"t":"cwd"}。
func (s *Session) onOSC7(abs string) {
	s.mu.Lock()
	s.cwd = abs
	s.mu.Unlock()
	if b, err := json.Marshal(outCWD{Type: "cwd", Abs: abs}); err == nil {
		s.pushFrame(b)
	}
}

// onOSC133 处理 OSC 133 busy 标记：133;C → busy=true，133;D → busy=false。
// 同时记录 shell 的上报能力（busy.go 据此选择启发式策略）。
func (s *Session) onOSC133(start bool) {
	s.mu.Lock()
	if start {
		s.integrationStart = true
	} else {
		s.integrationEnd = true
	}
	s.mu.Unlock()
	// OSC 133: C 表示命令开始 → busy；D 表示命令结束 → 空闲。
	s.setBusy(start)
}

// pushFrame 把一条 text 帧写到当前连接（Serve 时绑定）；无连接时丢弃。
func (s *Session) pushFrame(b []byte) {
	if f := s.frameSink; f != nil {
		f(b)
	}
}

// Cwd 返回会话最新工作目录（绝对路径）。
func (s *Session) Cwd() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cwd
}

// Busy 返回会话 busy 状态（T3 使用）。
func (s *Session) Busy() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.busy
}

// watchExit 等 shell 进程退出，推送 exit 帧并收尾。
// 写帧后主动关闭连接，使 Serve 的读循环尽快返回、释放会话（幂等）。
func (s *Session) watchExit(ws wsConn) {
	_ = s.cmd.Wait()
	_ = ws.Write(websocket.MessageText, []byte(`{"t":"exit"}`))
	s.terminate()
	ws.Close()
}

// Kill 主动终止会话（WS 断开 / closeTab 时调用）。
func (s *Session) Kill() {
	s.terminate()
}

// Done 返回会话结束信号。
func (s *Session) Done() <-chan struct{} { return s.done }

// terminate 终止进程并从注册表移除、关闭 done；幂等。
func (s *Session) terminate() {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.stopTimersLocked()
		s.mu.Unlock()
		if s.mgr != nil {
			s.mgr.Remove(s)
		}
		close(s.done)
		if s.cmd != nil {
			_ = s.cmd.Kill()
		}
		if s.pty != nil {
			_ = s.pty.Close()
		}
	})
}

// —— 以下为可替换的包级函数，便于单测打桩 ——

var defaultManagerResolve = func(rel string) (string, error) {
	return DefaultManager.Resolve(rel)
}

// resolveRel 用会话所属 manager 解析相对路径；mgr 未注入时回退 DefaultManager。
func (s *Session) resolveRel(rel string) (string, error) {
	if s.mgr != nil {
		return s.mgr.Resolve(rel)
	}
	return defaultManagerResolve(rel)
}

var runtimeGOOS = func() string { return runtime.GOOS }

// cdCommand 生成注入 PTY stdin 的 cd 命令，按 shell 种类区分语法：
//   - powershell/pwsh：Set-Location 单引号（反斜杠原生路径，单引号内无需转义反斜杠；
//     路径内单引号按 PS 规则翻倍）
//   - cmd：cd /d 双引号
//   - posix（bash/zsh/sh）：cd 单引号（路径内单引号按 POSIX 规则 '\”）
func cdCommand(kind, abs string) string {
	switch kind {
	case "pwsh", "powershell":
		return "Set-Location '" + strings.ReplaceAll(abs, "'", "''") + "'\r\n"
	case "cmd":
		return "cd /d \"" + abs + "\"\r\n"
	default:
		return "cd '" + strings.ReplaceAll(abs, "'", "'\\''") + "'\n"
	}
}

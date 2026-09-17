package terminal

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"runtime"
	"sync"

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
//	C→S text  {"t":"i","d":"<键入>"}              写入 PTY stdin
//	C→S text  {"t":"resize","cols":N,"rows":N}
//	C→S text  {"t":"cd","rel":"a/b"}              文件页导航注入（T2 起生效）
//	S→C bin   PTY 原始输出字节
//	S→C text  {"t":"exit"}                        shell 进程退出
//	S→C text  {"t":"error","d":"..."}             会话建立失败 / 拒绝
//	S→C text  {"t":"cwd"|"busy",...}              OSC 解析结果（T2/T3）
type Session struct {
	tabID string // 客户端文件标签 id（localStorage 持久化的那个）
	cwd   string // 初始工作目录（绝对路径，由 fs.Resolve 得到）
	mgr   *Manager // 所属注册表（退出时自行移除、cd 解析用）

	pty pty.Pty
	cmd cmdHandle // shell 进程句柄

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
	go s.pumpOutput(ws)
	go s.watchExit(ws)

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
		}
	case "resize":
		if m.Cols > 0 && m.Rows > 0 {
			_ = s.pty.Resize(m.Cols, m.Rows)
		}
	case "cd": // 文件页导航注入（T2 起由前端发送）
		abs, err := s.resolveRel(m.Rel)
		if err != nil {
			return
		}
		s.writeInput([]byte(cdCommand(runtimeGOOS(), abs)))
	}
}

// writeInput 写入 PTY stdin（ConPTY 写失败常伴随进程退出，忽略错误由退出监听收尾）。
func (s *Session) writeInput(b []byte) {
	_, _ = s.pty.Write(b)
}

// pumpOutput 从 PTY 读输出并原样转发（binary 帧）。
func (s *Session) pumpOutput(ws wsConn) {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			out := buf[:n]
			if werr := ws.Write(websocket.MessageBinary, out); werr != nil {
				return
			}
		}
		if err != nil {
			if err != io.EOF && !errors.Is(err, os.ErrClosed) {
				log.Printf("[terminal] pty read: %v", err)
			}
			return
		}
	}
}

// watchExit 等 shell 进程退出，推送 exit 帧并收尾。
func (s *Session) watchExit(ws wsConn) {
	_ = s.cmd.Wait()
	_ = ws.Write(websocket.MessageText, []byte(`{"t":"exit"}`))
	s.terminate()
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

// cdCommand 生成注入 PTY stdin 的 cd 命令（Windows 用反斜杠绝对路径 + /d）。
func cdCommand(goos, abs string) string {
	if goos == "windows" {
		return "cd /d \"" + abs + "\"\r\n"
	}
	return "cd \"" + abs + "\"\n"
}

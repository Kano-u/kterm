package terminal

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aymanbagabas/go-pty"
	"github.com/coder/websocket"
)

// fakePty 内存 PTY：Write 的内容进入 inCh，Read 从 outCh 取。
type fakePty struct {
	mu     sync.Mutex
	in     [][]byte
	outCh  chan []byte
	closed bool
}

func newFakePty() *fakePty { return &fakePty{outCh: make(chan []byte, 16)} }

func (f *fakePty) Read(p []byte) (int, error) {
	b, ok := <-f.outCh
	if !ok {
		return 0, os.ErrClosed
	}
	n := copy(p, b)
	return n, nil
}

func (f *fakePty) Write(p []byte) (int, error) {
	f.mu.Lock()
	f.in = append(f.in, append([]byte(nil), p...))
	f.mu.Unlock()
	return len(p), nil
}

func (f *fakePty) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.closed {
		f.closed = true
		close(f.outCh)
	}
	return nil
}

func (f *fakePty) written() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var sb strings.Builder
	for _, b := range f.in {
		sb.Write(b)
	}
	return sb.String()
}

// stub 其余 Pty 接口方法。
func (f *fakePty) Name() string                            { return "fake" }
func (f *fakePty) Command(name string, a ...string) *pty.Cmd { return nil }
func (f *fakePty) CommandContext(ctx context.Context, name string, a ...string) *pty.Cmd {
	return nil
}
func (f *fakePty) Resize(w, h int) error                   { return nil }
func (f *fakePty) Fd() uintptr                             { return 0 }

// fakeCmd：Wait 阻塞直到 Kill。
type fakeCmd struct {
	mu       sync.Mutex
	killed   bool
	waitOnce sync.Once
	done     chan struct{}
}

func newFakeCmd() *fakeCmd { return &fakeCmd{done: make(chan struct{})} }

func (c *fakeCmd) Start() error                 { return nil }
func (c *fakeCmd) Wait() error {
	<-c.done
	return nil
}
func (c *fakeCmd) Run() error { return nil }
func (c *fakeCmd) Kill() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.killed {
		c.killed = true
		close(c.done)
	}
	return nil
}

// memoryWS 内存 WebSocket，收集服务端写出的帧。
type memoryWS struct {
	mu      sync.Mutex
	written [][]byte
	readCh  chan []readItem
	closed  bool
}

type readItem struct {
	mt   websocket.MessageType
	data []byte
}

func newMemoryWS() *memoryWS { return &memoryWS{readCh: make(chan []readItem)} }

func (m *memoryWS) Read() (websocket.MessageType, []byte, error) {
	items, ok := <-m.readCh
	if !ok {
		return 0, nil, os.ErrClosed
	}
	it := items[0]
	if len(items) > 1 {
		m.readCh <- items[1:]
	}
	return it.mt, it.data, nil
}

func (m *memoryWS) Write(mt websocket.MessageType, data []byte) error {
	m.mu.Lock()
	m.written = append(m.written, append([]byte(nil), data...))
	m.mu.Unlock()
	return nil
}

func (m *memoryWS) Close() { m.mu.Lock(); m.closed = true; m.mu.Unlock() }

func (m *memoryWS) frames() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.written))
	for i, b := range m.written {
		out[i] = string(b)
	}
	return out
}

func (m *memoryWS) send(text string) {
	m.readCh <- []readItem{{websocket.MessageText, []byte(text)}}
}

// setup 构造 manager + fake pty 会话。
func setupSession(t *testing.T) (*Manager, *Session, *fakePty, *fakeCmd, *memoryWS) {
	t.Helper()
	m := NewManager(func(rel string) (string, error) { return "/fake/root/" + rel, nil })
	fp := newFakePty()
	fc := newFakeCmd()
	deps := &SessionDeps{NewPty: func() (pty.Pty, cmdHandle, error) { return fp, fc, nil }}
	s, exists, err := Start(m, "tab1", "sub", deps)
	if err != nil || exists {
		t.Fatalf("Start: err=%v exists=%v", err, exists)
	}
	return m, s, fp, fc, newMemoryWS()
}

func TestStartResolvesInitialCwd(t *testing.T) {
	m, s, _, _, _ := setupSession(t)
	defer s.Kill()
	if s.cwd != "/fake/root/sub" {
		t.Errorf("cwd = %q, want /fake/root/sub", s.cwd)
	}
	if m.Get("tab1") != s {
		t.Error("session not registered")
	}
}

func TestRegisterRejectsDuplicateTab(t *testing.T) {
	m, s, _, _, _ := setupSession(t)
	defer s.Kill()
	s2 := &Session{tabID: "tab1", done: make(chan struct{})}
	if old := m.Register(s2); old != s {
		t.Errorf("Register duplicate: got old=%v, want existing session", old)
	}
}

func TestServeForwardsInput(t *testing.T) {
	_, s, fp, _, ws := setupSession(t)
	go s.Serve(ws)
	time.Sleep(20 * time.Millisecond)

	ws.send(`{"t":"i","d":"dir\r"}`)
	time.Sleep(20 * time.Millisecond)
	if got := fp.written(); !strings.Contains(got, "dir\r") {
		t.Errorf("input not forwarded, written=%q", got)
	}
	s.Kill()
}

func TestServeResize(t *testing.T) {
	_, s, _, _, ws := setupSession(t)
	go s.Serve(ws)
	time.Sleep(20 * time.Millisecond)
	// 仅验证不 panic；fake Resize 无状态
	ws.send(`{"t":"resize","cols":120,"rows":40}`)
	time.Sleep(20 * time.Millisecond)
	s.Kill()
}

func TestPumpOutputForwardsBinary(t *testing.T) {
	_, s, fp, _, ws := setupSession(t)
	go s.Serve(ws)
	fp.outCh <- []byte("hello output")
	deadline := time.Now().Add(2 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatal("no output frame forwarded")
		}
		for _, f := range ws.frames() {
			if strings.Contains(f, "hello output") {
				s.Kill()
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestExitNotificationAndCleanup(t *testing.T) {
	m, s, _, fc, ws := setupSession(t)
	go s.Serve(ws)
	fc.Kill() // shell 退出
	deadline := time.Now().Add(2 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatal("no exit frame")
		}
		found := false
		for _, f := range ws.frames() {
			if strings.Contains(f, `"t":"exit"`) {
				found = true
			}
		}
		if found {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	// 会话应已从注册表移除
	time.Sleep(50 * time.Millisecond)
	if m.Get("tab1") == s {
		t.Error("session still registered after exit")
	}
}

func TestKillClosesDoneAndRemoves(t *testing.T) {
	m, s, _, _, _ := setupSession(t)
	s.Kill()
	select {
	case <-s.Done():
	case <-time.After(time.Second):
		t.Fatal("Done not closed after Kill")
	}
	time.Sleep(20 * time.Millisecond)
	if m.Get("tab1") == s {
		t.Error("session should be removed after Kill+cleanup")
	}
}

func TestCdInjection(t *testing.T) {
	m, s, fp, _, ws := setupSession(t)
	defer s.Kill()
	go s.Serve(ws)
	time.Sleep(20 * time.Millisecond)

	wantPath, err := m.Resolve("a/b")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	ws.send(`{"t":"cd","rel":"a/b"}`)
	time.Sleep(20 * time.Millisecond)
	got := fp.written()
	if runtimeGOOS() == "windows" {
		want := "cd /d \"" + wantPath + "\""
		if !strings.Contains(got, want) {
			t.Errorf("cd injection on windows: got %q, want contains %q", got, want)
		}
	} else {
		want := "cd \"" + wantPath + "\""
		if !strings.Contains(got, want) {
			t.Errorf("cd injection on unix: got %q, want contains %q", got, want)
		}
	}
}

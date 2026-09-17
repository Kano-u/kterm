package terminal

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aymanbagabas/go-pty"
)

// ---------- OSC 133 → busy ----------

func TestBusyFromOSC133(t *testing.T) {
	_, s, fp, _, ws := setupSession(t)
	defer s.Kill()
	go s.Serve(ws)
	time.Sleep(20 * time.Millisecond)

	if s.Busy() {
		t.Fatal("session should start idle")
	}
	fp.outCh <- []byte("\x1b]133;C\x07")
	waitBusy(t, s, true)
	if !waitFrame(t, ws, `"t":"busy"`, `"on":true`) {
		t.Error("no busy=true frame pushed")
	}

	fp.outCh <- []byte("\x1b]133;D\x07")
	waitBusy(t, s, false)
	if !waitFrame(t, ws, `"t":"busy"`, `"on":false`) {
		t.Error("no busy=false frame pushed")
	}
}

// 完整集成 shell（会发 133;C）下，键入回车不应触发降级 busy：
// busy 完全由 133 决定，避免注入的 cd 把目录误锁。
func TestOSC133StartSuppressesInputHeuristic(t *testing.T) {
	_, s, fp, _, ws := setupSession(t)
	defer s.Kill()
	go s.Serve(ws)
	time.Sleep(20 * time.Millisecond)

	fp.outCh <- []byte("\x1b]133;C\x07\x1b]133;D\x07") // 声明 shell 会发 C 与 D
	waitBusy(t, s, false)
	waitCond(t, func() bool { return s.integrationStart && s.integrationEnd })

	s.noteInput([]byte("dir\r"))
	time.Sleep(30 * time.Millisecond)
	if s.Busy() {
		t.Error("input heuristic must not fire once OSC 133;C was seen")
	}
}

// 仅发 133;D 的 shell（bash：PROMPT_COMMAND 无原生 preexec）：
// 起点靠输入启发式，终点由 133;D 精确复位（不应落入静默降级）。
func TestOSC133EndOnlyUsesHeuristicStart(t *testing.T) {
	oldDelay, oldCap := quietResetDelay, quietResetCap
	quietResetDelay, quietResetCap = 40*time.Millisecond, time.Second
	defer func() { quietResetDelay, quietResetCap = oldDelay, oldCap }()

	_, s, fp, _, ws := setupSession(t)
	defer s.Kill()
	go s.Serve(ws)
	time.Sleep(20 * time.Millisecond)

	fp.outCh <- []byte("\x1b]133;D\x07")
	waitBusy(t, s, false)
	// 确保泵 goroutine 已处理该帧（否则它会晚于下面的 noteInput 复位 busy）
	waitCond(t, func() bool { return s.integrationEnd })

	s.noteInput([]byte("sleep 5\r"))
	if !s.Busy() {
		t.Fatal("heuristic must mark busy when only 133;D is available")
	}
	// 静默窗口（40ms）过去仍应保持 busy：已声明有 133;D，不依赖计时器
	time.Sleep(80 * time.Millisecond)
	if !s.Busy() {
		t.Error("133;D-only shell must not reset via quiet timers")
	}
	// 命令结束：133;D 到达 → 立即复位
	fp.outCh <- []byte("\x1b]133;D\x07")
	waitBusy(t, s, false)
}

func TestBusyFrameNotRepeated(t *testing.T) {
	_, s, fp, _, ws := setupSession(t)
	defer s.Kill()
	go s.Serve(ws)
	time.Sleep(20 * time.Millisecond)

	fp.outCh <- []byte("\x1b]133;C\x07\x1b]133;C\x07")
	waitBusy(t, s, true)
	time.Sleep(30 * time.Millisecond)
	if n := countFrames(ws, `"t":"busy"`); n != 1 {
		t.Errorf("busy frames = %d, want 1 (deduplicated)", n)
	}
}

// ---------- 降级 heuristic（cmd 等无 133 集成） ----------

func TestDegradedBusyOnSubmitAndQuietReset(t *testing.T) {
	oldDelay, oldCap := quietResetDelay, quietResetCap
	quietResetDelay, quietResetCap = 40*time.Millisecond, time.Second
	defer func() { quietResetDelay, quietResetCap = oldDelay, oldCap }()

	_, s, _, _, ws := setupSession(t)
	defer s.Kill()
	go s.Serve(ws)
	time.Sleep(20 * time.Millisecond)

	// 非提交输入不置 busy
	s.noteInput([]byte("dir"))
	time.Sleep(10 * time.Millisecond)
	if s.Busy() {
		t.Error("plain typing must not mark busy")
	}

	s.noteInput([]byte("ping -t 1.1.1.1\r"))
	if !s.Busy() {
		t.Fatal("submitted input should mark busy")
	}

	// 有输出 → 静默窗口被刷新，busy 保持
	time.Sleep(25 * time.Millisecond)
	s.noteOutput()
	time.Sleep(25 * time.Millisecond)
	if !s.Busy() {
		t.Error("output refresh should keep busy before quiet window elapses")
	}

	// 静默到期 → 自动复位（Windows 上调度粒度较大，给足余量）
	deadline := time.Now().Add(2 * time.Second)
	for s.Busy() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if s.Busy() {
		t.Error("busy should reset after output goes quiet")
	}
	if !waitFrame(t, ws, `"t":"busy"`, `"on":false`) {
		t.Error("no busy=false frame after quiet reset")
	}
}

// ---------- manager.BusyPaths / IsBusyPath ----------

func TestBusyPathsAndIsBusyPath(t *testing.T) {
	root := t.TempDir()
	m := NewManager(func(rel string) (string, error) {
		return filepath.Join(root, filepath.FromSlash(rel)), nil
	})
	s, exists, err := Start(m, "tab1", "proj", &SessionDeps{
		NewPty: func() (pty.Pty, cmdHandle, error) { return newFakePty(), newFakeCmd(), nil },
	})
	if err != nil || exists {
		t.Fatalf("Start: err=%v exists=%v", err, exists)
	}
	defer s.Kill()

	projDir := filepath.Join(root, "proj")
	// 空闲会话不上锁
	if got := m.BusyPaths(); len(got) != 0 {
		t.Errorf("idle session locked paths: %v", got)
	}
	if m.IsBusyPath(filepath.Join(projDir, "a.txt")) {
		t.Error("idle session must not lock its cwd")
	}

	// 置 busy（走 OSC 133 路径，顺带验证状态记录）
	s.onOSC133(true)
	paths := m.BusyPaths()
	if len(paths) != 1 || !samePath(paths[0], projDir) {
		t.Fatalf("BusyPaths = %v, want [%s]", paths, projDir)
	}
	if !m.IsBusyPath(projDir) {
		t.Error("busy cwd itself must be locked")
	}
	if !m.IsBusyPath(filepath.Join(projDir, "sub", "deep.txt")) {
		t.Error("descendant of busy cwd must be locked")
	}
	if m.IsBusyPath(root) {
		t.Error("root must not be locked by a busy subdirectory")
	}
	if m.IsBusyPath(filepath.Join(root, "other")) {
		t.Error("sibling directory must not be locked")
	}

	// 命令结束后解锁
	s.onOSC133(false)
	if m.IsBusyPath(projDir) {
		t.Error("cwd must unlock once the command finished")
	}
}

func TestWithinPath(t *testing.T) {
	sep := string(filepath.Separator)
	base := sep + "a" + sep + "b"
	cases := []struct {
		dir, p string
		want   bool
	}{
		{base, base, true},
		{base, base + sep + "c", true},
		{base, base + sep + "c" + sep + "d", true},
		{base, base + sep + "cc", true}, // 前缀相同但不是父目录，仍是后代
		{base, sep + "a", false},
		{base, sep + "a" + sep + "bb", false},
		{base, sep + "x", false},
	}
	for _, c := range cases {
		if got := withinPath(c.dir, c.p); got != c.want {
			t.Errorf("withinPath(%q, %q) = %v, want %v", c.dir, c.p, got, c.want)
		}
	}
}

// ---------- helpers ----------

func waitBusy(t *testing.T, s *Session, want bool) {
	t.Helper()
	waitCond(t, func() bool { return s.Busy() == want })
}

// waitCond 轮询等待条件成立（超时即测试失败）。
func waitCond(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not met before timeout")
}

func hasFrame(ws *memoryWS, parts ...string) bool {
	for _, f := range ws.frames() {
		ok := true
		for _, p := range parts {
			if !strings.Contains(f, p) {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

// waitFrame 轮询等待帧出现（帧写入异步于状态变更）。返回是否等到。
func waitFrame(t *testing.T, ws *memoryWS, parts ...string) bool {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if hasFrame(ws, parts...) {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return false
}

func countFrames(ws *memoryWS, part string) int {
	n := 0
	for _, f := range ws.frames() {
		if strings.Contains(f, part) {
			n++
		}
	}
	return n
}

// samePath 比较路径（Windows 下大小写不敏感）。
func samePath(a, b string) bool {
	if filepath.Separator == '\\' {
		return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
	}
	return filepath.Clean(a) == filepath.Clean(b)
}

package terminal

import (
	"bytes"
	"os"
	"runtime"
	"strings"
	"testing"
)

type scanResult struct {
	out    bytes.Buffer
	cwds   []string
	busies []bool
}

func newScan() (*oscScanner, *scanResult) {
	r := &scanResult{}
	s := newOSCScanner(
		func(b []byte) { r.out.Write(b) },
		func(abs string) { r.cwds = append(r.cwds, abs) },
		func(on bool) { r.busies = append(r.busies, on) },
	)
	return s, r
}

func mustFeed(t *testing.T, s *oscScanner, r *scanResult, chunks ...[]byte) {
	t.Helper()
	for _, c := range chunks {
		s.Feed(c)
	}
	if got := r.out.Bytes(); !bytes.Equal(got, concat(chunks...)) {
		t.Fatalf("passthrough mismatch:\n got %q\nwant %q", got, concat(chunks...))
	}
}

func concat(bs ...[]byte) []byte {
	var out []byte
	for _, b := range bs {
		out = append(out, b...)
	}
	return out
}

func TestOSC7SingleFrame(t *testing.T) {
	s, r := newScan()
	mustFeed(t, s, r, []byte("hello \x1b]7;file:///home/user/docs\x07world"))
	if len(r.cwds) != 1 || r.cwds[0] != nativePath("/home/user/docs") {
		t.Errorf("cwds = %v", r.cwds)
	}
	if len(r.busies) != 0 {
		t.Errorf("unexpected busy events: %v", r.busies)
	}
}

func TestOSC133(t *testing.T) {
	s, r := newScan()
	mustFeed(t, s, r,
		[]byte("\x1b]133;C\x07ping start"),
		[]byte("output...\x1b]133;D\x07prompt$ "))
	want := []bool{true, false}
	if len(r.busies) != len(want) {
		t.Fatalf("busies = %v, want %v", r.busies, want)
	}
	for i, w := range want {
		if r.busies[i] != w {
			t.Errorf("busies[%d] = %v, want %v", i, r.busies[i], w)
		}
	}
}

func TestOSCTerminatedByST(t *testing.T) {
	s, r := newScan()
	mustFeed(t, s, r, []byte("\x1b]7;file:///tmp\x1b\\after"))
	if len(r.cwds) != 1 || r.cwds[0] != nativePath("/tmp") {
		t.Errorf("cwds = %v", r.cwds)
	}
}

func TestOSCAcrossFrameBoundary(t *testing.T) {
	full := "\x1b]7;file:///home/user\x07tail"
	for cut := 1; cut < len(full); cut++ {
		s2, r2 := newScan()
		s2.Feed([]byte(full[:cut]))
		s2.Feed([]byte(full[cut:]))
		if len(r2.cwds) != 1 || r2.cwds[0] != nativePath("/home/user") {
			t.Errorf("cut=%d: cwds = %v", cut, r2.cwds)
		}
		if got := r2.out.String(); got != full {
			t.Errorf("cut=%d: passthrough = %q, want %q", cut, got, full)
		}
	}
}

func TestSTAcrossFrameBoundary(t *testing.T) {
	s, r := newScan()
	mustFeed(t, s, r,
		[]byte("\x1b]7;file:///tmp\x1b"),
		[]byte("\\next"))
	if len(r.cwds) != 1 || r.cwds[0] != nativePath("/tmp") {
		t.Errorf("cwds = %v", r.cwds)
	}
}

func TestIncompleteOSCNotParsed(t *testing.T) {
	s, r := newScan()
	// 只有开头没有终止符：不应触发回调
	s.Feed([]byte("abc\x1b]7;file:///tmp"))
	if len(r.cwds) != 0 {
		t.Errorf("incomplete sequence triggered cwd: %v", r.cwds)
	}
	// 终止符到达后解析
	s.Feed([]byte("\x07"))
	if len(r.cwds) != 1 || r.cwds[0] != nativePath("/tmp") {
		t.Errorf("cwds after terminator = %v", r.cwds)
	}
}

func TestNonOSCEscapePassthrough(t *testing.T) {
	s, r := newScan()
	// CSI（光标移动、颜色）与其他转义原样透传且不误触发
	mustFeed(t, s, r,
		[]byte("\x1b[2J\x1b[1;31mred\x1b[0m"),
		[]byte("\x1b]0;window title\x07"),   // OSC 0 不应触发
		[]byte("\x1b]7;not-a-file-url\x07"), // 非 file URL
	)
	if len(r.cwds) != 0 || len(r.busies) != 0 {
		t.Errorf("unexpected events: cwds=%v busies=%v", r.cwds, r.busies)
	}
}

func TestStandaloneESCCarriedToNextFrame(t *testing.T) {
	s, r := newScan()
	// 帧尾落单 ESC（非序列）透传，下一帧内容不受影响
	mustFeed(t, s, r, []byte("text\x1b"), []byte("[0mmore"))
	if len(r.cwds) != 0 {
		t.Errorf("cwds = %v", r.cwds)
	}
}

func TestUTF8SplitAcrossFrames(t *testing.T) {
	// 中文多字节字符被帧边界切开：透传字节必须完整
	src := "目录列表示例\x1b]7;file:///home/用户/文档\x07结束"
	for cut := 1; cut < len(src); cut++ {
		s2, r2 := newScan()
		s2.Feed([]byte(src[:cut]))
		s2.Feed([]byte(src[cut:]))
		if got := r2.out.String(); got != src {
			t.Errorf("cut=%d: passthrough broken", cut)
		}
		if len(r2.cwds) != 1 || r2.cwds[0] != nativePath("/home/用户/文档") {
			t.Errorf("cut=%d: cwds = %v", cut, r2.cwds)
		}
	}
}

func TestOversizedSequenceDropped(t *testing.T) {
	s, r := newScan()
	big := strings.Repeat("a", oscMaxLen+100)
	s.Feed([]byte("\x1b]7;file:///" + big + "\x07"))
	if len(r.cwds) != 0 {
		t.Errorf("oversized sequence triggered cwd")
	}
	// 超限后扫描器恢复，后续序列正常解析
	s.Feed([]byte("\x1b]7;file:///ok\x07"))
	if len(r.cwds) != 1 || r.cwds[0] != nativePath("/ok") {
		t.Errorf("cwds after recovery = %v", r.cwds)
	}
}

func TestMalformedSequenceNoPanic(t *testing.T) {
	s, r := newScan()
	inputs := [][]byte{
		[]byte("\x1b]"),
		[]byte("\x1b]7;"),
		[]byte("\x1b]7;\x07"),
		[]byte("\x1b]\x07"),
		[]byte("\x1b\x1b\x1b"),
		{0x1b},
		[]byte("\x1b]7;file://\x07"),
		[]byte("\x1b]7;file://evilhost/tmp\x07"),
		[]byte("\x1b]7;%zz\x07"),   // 非法百分号编码
		[]byte("\x1b]133;X\x07"),   // 未知 133 参数
		[]byte("\x1b]abc;def\x07"), // 非数字编号
	}
	for _, in := range inputs {
		s.Feed(in)
	}
	if len(r.cwds) != 0 {
		t.Errorf("malformed sequences triggered cwd: %v", r.cwds)
	}
}

func TestParseOSC7(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"file:///home/u", "/home/u"},
		{"file://localhost/home/u", "/home/u"},
		{"file:///C:/Users/kano", `C:\Users\kano`},
		{"file:///C:/Users/my%20docs", `C:\Users\my docs`},
		{"file://server/share", ""}, // 远程主机
		{"http://x/y", ""},          // 非 file 协议
		{"file://", ""},             // 无路径
		{"", ""},
		{"plain/path", ""},
	}
	if runtime.GOOS == "windows" {
		slash := string(os.PathSeparator)
		cases[0].want = slash + `home` + slash + `u`
		cases[1].want = slash + `home` + slash + `u`
	} else {
		cases[2].want = ""
		cases[3].want = ""
	}
	for _, c := range cases {
		if got := parseOSC7(c.in); got != c.want {
			t.Errorf("parseOSC7(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestScannerInterleaved(t *testing.T) {
	s, r := newScan()
	// 多条 OSC 与普通输出交错，且部分跨帧
	mustFeed(t, s, r,
		[]byte("\x1b]133;D\x07$ \x1b]7;file:///a\x07text"),
		[]byte("\x1b]133;C\x07running\x1b]"),
		[]byte("7;file:///b\x07more"),
	)
	wantCWDs := []string{nativePath("/a"), nativePath("/b")}
	if len(r.cwds) != len(wantCWDs) {
		t.Fatalf("cwds = %v", r.cwds)
	}
	for i, w := range wantCWDs {
		if r.cwds[i] != w {
			t.Errorf("cwds[%d] = %q, want %q", i, r.cwds[i], w)
		}
	}
	if len(r.busies) != 2 || r.busies[0] != false || r.busies[1] != true {
		t.Errorf("busies = %v", r.busies)
	}
}

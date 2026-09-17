package terminal

import (
	"encoding/base64"
	"runtime"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestDetectShell(t *testing.T) {
	sh, err := detectShell()
	if err != nil {
		t.Skipf("no shell found: %v", err)
	}
	if sh.path == "" {
		t.Fatal("shell path is empty")
	}
	switch runtime.GOOS {
	case "windows":
		low := strings.ToLower(sh.path)
		if !strings.HasSuffix(low, "pwsh.exe") && !strings.HasSuffix(low, "powershell.exe") && !strings.HasSuffix(low, "cmd.exe") {
			t.Errorf("unexpected shell on windows: %s", sh.path)
		}
		if strings.HasSuffix(low, "cmd.exe") && !sh.degraded {
			t.Errorf("cmd.exe should be marked degraded")
		}
	default:
		if !strings.HasPrefix(sh.path, "/") {
			t.Errorf("expected absolute path on unix, got %q", sh.path)
		}
	}
}

func TestLookPathAll(t *testing.T) {
	if _, ok := lookPathAll("definitely-not-exist-xyz"); ok {
		t.Error("lookPathAll found a non-existent command")
	}
	// 至少能找到系统自带的一个
	var candidates []string
	if runtime.GOOS == "windows" {
		candidates = []string{"cmd.exe"}
	} else {
		candidates = []string{"sh"}
	}
	if _, ok := lookPathAll(candidates...); !ok {
		t.Errorf("lookPathAll(%v) not found", candidates)
	}
}

// execLookPath 别名导出便于测试（见 shell.go）。
func TestExecLookPathAlias(t *testing.T) {
	if _, err := execLookPath("definitely-not-exist-xyz"); err == nil {
		t.Error("execLookPath should fail for non-existent command")
	}
	if _, err := execLookPath("cmd"); runtime.GOOS == "windows" && err != nil {
		t.Errorf("cmd.exe should be found on windows: %v", err)
	}
}

func TestUnixShellKind(t *testing.T) {
	cases := []struct{ in, want string }{
		{"/bin/bash", "bash"},
		{"/usr/bin/zsh", "zsh"},
		{"/bin/sh", "sh"},
		{"/bin/dash", "sh"},
	}
	for _, c := range cases {
		if got := unixShellKind(c.in); got != c.want {
			t.Errorf("unixShellKind(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestUnixInitScript(t *testing.T) {
	bash := unixInitScript("bash")
	if bash == "" {
		t.Fatal("bash init script empty")
	}
	for _, want := range []string{"__kfm_osc7", "PROMPT_COMMAND", "preexec_functions", "133;D", "133;C", "133;A"} {
		if !strings.Contains(bash, want) {
			t.Errorf("bash init script missing %q", want)
		}
	}
	if zsh := unixInitScript("zsh"); zsh != "" {
		t.Errorf("zsh should not have init script (unsupported), got %q", zsh)
	}
}

func TestPsInitScript(t *testing.T) {
	code := psInitScript()
	if code == "" {
		t.Fatal("PS init script empty")
	}
	for _, want := range []string{"prompt", "__kfmE", "]7;", "]133;D", "]133;A", "file:///", "Get-Location"} {
		if !strings.Contains(code, want) {
			t.Errorf("PS init script missing %q", want)
		}
	}
	if strings.Contains(code, "\x1b") {
		t.Error("init script should not contain raw ESC bytes (由 [char]27 拼接)")
	}
}

func TestEncodePSCommand(t *testing.T) {
	code := psInitScript()
	enc := encodePSCommand(code)
	if enc == "" {
		t.Fatal("encoded command is empty")
	}
	if strings.ContainsAny(enc, " \r\n\t'\"") {
		t.Errorf("base64 payload must not contain shell-special chars: %q", enc)
	}
	// 回解应还原为原脚本（UTF-16LE），证明未丢字/未破坏反斜杠与换行。
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		t.Fatalf("decode base64: %v", err)
	}
	u := make([]uint16, 0, len(raw)/2)
	for i := 0; i+1 < len(raw); i += 2 {
		u = append(u, uint16(raw[i])|uint16(raw[i+1])<<8)
	}
	if got := string(utf16.Decode(u)); got != code {
		t.Errorf("round-trip mismatch:\n got %q\nwant %q", got, code)
	}
}

// 集成片段必须保留正确的反斜杠字面量：
//   - PS 单引号串不转义，'\\' 表示两个字符，-replace 正则中匹配单个反斜杠；
//   - 若误写成 '\'（一个反斜杠）则是未闭合字符串，整段脚本 ParserError 静默失效。
func TestPsInitScriptKeepsBackslash(t *testing.T) {
	code := psInitScript()
	if !strings.Contains(code, `-replace '\\', '/'`) {
		t.Errorf("path normalization must be -replace '\\\\', '/', got:\n%s", code)
	}
	if strings.Contains(code, `-replace '\', '/'`) {
		t.Error("PS literal '\\' is an unterminated string (parse error); need '\\\\'")
	}
}

func TestShellQuote(t *testing.T) {
	if got := shellQuote("/bin/bash"); got != "'/bin/bash'" {
		t.Errorf("shellQuote simple = %q", got)
	}
	if got := shellQuote("a'b"); got != "'a'\\''b'" {
		t.Errorf("shellQuote with quote = %q", got)
	}
}

func TestShellKindField(t *testing.T) {
	sh, err := detectShell()
	if err != nil {
		t.Skipf("no shell found: %v", err)
	}
	if sh.kind == "" {
		t.Error("shell kind is empty")
	}
	if runtime.GOOS == "windows" && sh.kind == "cmd" && !sh.degraded {
		t.Error("cmd must be degraded")
	}
}

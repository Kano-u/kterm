package terminal

import (
	"runtime"
	"strings"
	"testing"
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

package terminal

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// execLookPath 封装 exec.LookPath，便于单测替换。
func execLookPath(name string) (string, error) { return exec.LookPath(name) }

// shellInfo 描述探测到的 shell。
type shellInfo struct {
	path     string   // 可执行文件绝对路径（或 PATH 中可直接找到的名字）
	args     []string // 启动参数
	degraded bool     // true 表示无 OSC 集成能力（cmd）
}

// detectShell 探测 shell：
//   - Windows: pwsh.exe → powershell.exe → cmd.exe
//   - Unix:    $SHELL → bash → sh
func detectShell() (*shellInfo, error) {
	if runtime.GOOS == "windows" {
		return detectShellWindows()
	}
	return detectShellUnix()
}

// lookPathAll 在 PATH 中查找候选名，返回第一个存在的。
func lookPathAll(names ...string) (string, bool) {
	for _, n := range names {
		if p, err := execLookPath(n); err == nil && p != "" {
			return p, true
		}
	}
	return "", false
}

// detectShellWindows 按优先级探测 Windows shell。
func detectShellWindows() (*shellInfo, error) {
	if p, ok := lookPathAll("pwsh.exe", "pwsh"); ok {
		return &shellInfo{path: p, args: []string{"-NoLogo"}}, nil
	}
	if p, ok := lookPathAll("powershell.exe"); ok {
		// Windows PowerShell 5.1：T2 通过 -Command 注入 prompt 包装
		return &shellInfo{path: p, args: []string{"-NoLogo"}}, nil
	}
	if p, ok := lookPathAll("cmd.exe"); ok {
		return &shellInfo{path: p, degraded: true}, nil
	}
	// 极端情况：PATH 不可用，尝试 SystemRoot 下的绝对路径
	if windir := os.Getenv("SystemRoot"); windir != "" {
		for _, cand := range []string{
			filepath.Join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
			filepath.Join(windir, "System32", "cmd.exe"),
		} {
			if st, err := os.Stat(cand); err == nil && !st.IsDir() {
				if strings.HasSuffix(strings.ToLower(cand), "cmd.exe") {
					return &shellInfo{path: cand, degraded: true}, nil
				}
				return &shellInfo{path: cand, args: []string{"-NoLogo"}}, nil
			}
		}
	}
	return nil, os.ErrNotExist
}

// detectShellUnix 探测 Unix shell。
func detectShellUnix() (*shellInfo, error) {
	if sh := os.Getenv("SHELL"); sh != "" && !strings.ContainsRune(sh, 0) {
		if _, err := os.Stat(sh); err == nil {
			return &shellInfo{path: sh}, nil
		}
	}
	if p, ok := lookPathAll("bash"); ok {
		return &shellInfo{path: p}, nil
	}
	if p, ok := lookPathAll("sh"); ok {
		return &shellInfo{path: p}, nil
	}
	return nil, os.ErrNotExist
}

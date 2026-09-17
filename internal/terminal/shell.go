package terminal

import (
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"unicode/utf16"
)

// execLookPath 封装 exec.LookPath，便于单测替换。
func execLookPath(name string) (string, error) { return exec.LookPath(name) }

// shellInfo 描述探测到的 shell。
type shellInfo struct {
	path     string   // 可执行文件绝对路径（或 PATH 中可直接找到的名字）
	args     []string // 启动参数
	degraded bool     // true 表示无 OSC 集成能力（cmd）
	kind     string   // "pwsh" | "powershell" | "cmd" | "bash" | "zsh" | "sh"
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
// pwsh 与 powershell 都需要注入集成片段：
// 实测 pwsh 7.6 在 ConPTY 直连时只输出 OSC 0（窗口标题），ShellIntegration.ps1
// 只在 VS Code / Windows Terminal 等已知宿主下自动加载，因此不能依赖“原生自带”。
func detectShellWindows() (*shellInfo, error) {
	psArgs := func() []string {
		return []string{"-NoLogo", "-NoExit", "-EncodedCommand", encodePSCommand(psInitScript())}
	}
	if p, ok := lookPathAll("pwsh.exe", "pwsh"); ok {
		return &shellInfo{path: p, args: psArgs(), kind: "pwsh"}, nil
	}
	if p, ok := lookPathAll("powershell.exe"); ok {
		return &shellInfo{path: p, args: psArgs(), kind: "powershell"}, nil
	}
	if p, ok := lookPathAll("cmd.exe"); ok {
		return &shellInfo{path: p, degraded: true, kind: "cmd"}, nil
	}
	// 极端情况：PATH 不可用，尝试 SystemRoot 下的绝对路径
	if windir := os.Getenv("SystemRoot"); windir != "" {
		for _, cand := range []string{
			filepath.Join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
			filepath.Join(windir, "System32", "cmd.exe"),
		} {
			if st, err := os.Stat(cand); err == nil && !st.IsDir() {
				if strings.HasSuffix(strings.ToLower(cand), "cmd.exe") {
					return &shellInfo{path: cand, degraded: true, kind: "cmd"}, nil
				}
				return &shellInfo{path: cand, args: psArgs(), kind: "powershell"}, nil
			}
		}
	}
	return nil, os.ErrNotExist
}

// detectShellUnix 探测 Unix shell，并按 bash/zsh 注入集成片段。
func detectShellUnix() (*shellInfo, error) {
	mk := func(p string) *shellInfo {
		kind := unixShellKind(p)
		args := []string{}
		if kind == "bash" {
			// bash：--norc 启动后先执行集成片段，再 exec 回交互 bash
			if code := unixInitScript("bash"); code != "" {
				args = append(args, "--noprofile", "--norc", "-c",
					code+"\nexec "+shellQuote(p)+" -i")
			}
		}
		// zsh/sh：不注入（zsh 需 ZDOTDIR 目录方案，sh 无函数钩子），依赖降级 heuristic
		return &shellInfo{path: p, args: args, kind: kind}
	}
	if sh := os.Getenv("SHELL"); sh != "" && !strings.ContainsRune(sh, 0) {
		if _, err := os.Stat(sh); err == nil {
			return mk(sh), nil
		}
	}
	if p, ok := lookPathAll("bash"); ok {
		return mk(p), nil
	}
	if p, ok := lookPathAll("sh"); ok {
		return mk(p), nil
	}
	return nil, os.ErrNotExist
}

// psInitScript 返回 PowerShell（pwsh 7+ 与 Windows PowerShell 5.1 通用）的启动集成片段。
//
// 重定义 prompt 函数：每次提示符输出前写 OSC 7（cwd 上报）与 OSC 133;D/133;A
// （命令结束/提示符开始，T3 消费），随后回显用户原有 prompt。
//
// 三个关键点（此前均踩坑）：
//   - 必须自行注入。pwsh 虽有内置 shell integration，但仅对 VS Code / Windows
//     Terminal 等已知宿主启用；ConPTY 直连时只发 OSC 0，不会发 OSC 7。
//   - 用 [Console]::Write 直接写控制台，而不是 return 进 prompt 字符串：
//     后者会经过 PSReadLine 的行渲染。
//   - PS 正则中匹配单个反斜杠的字面量必须写成 '\\'（两个字符），因此 Go 源码
//     raw string 里需要四个反斜杠。写成 '\' 会让整段脚本 ParserError 而静默失效。
func psInitScript() string {
	return `$global:__kfmE = [char]27
$global:__kfmOrig = $function:prompt
function global:prompt {
  $p = (Get-Location).Path -replace '\\', '/'
  $u = 'file:///' + $p.TrimStart('/')
  [Console]::Write($global:__kfmE + ']7;' + $u + $global:__kfmE + '\')
  [Console]::Write($global:__kfmE + ']133;D' + $global:__kfmE + '\')
  [Console]::Write($global:__kfmE + ']133;A' + $global:__kfmE + '\')
  if ($global:__kfmOrig) { & $global:__kfmOrig } else { "PS $((Get-Location).Path)> " }
}
`
}

// encodePSCommand 把脚本编码为 -EncodedCommand 要求的 UTF-16LE + base64。
// 相比 -Command 直接传参，可彻底避免引号、换行、反斜杠被命令行解析器改写
// （此前脚本正是因为内嵌换行/反斜杠被破坏而静默失效）。
func encodePSCommand(s string) string {
	u := utf16.Encode([]rune(s))
	b := make([]byte, 0, len(u)*2)
	for _, r := range u {
		b = append(b, byte(r), byte(r>>8))
	}
	return base64.StdEncoding.EncodeToString(b)
}

// unixInitScript 返回 bash 的集成片段（PROMPT_COMMAND + preexec）。
// kind 为 "bash" 时返回片段，其他 shell 返回空串（无集成，走降级 heuristic）。
func unixInitScript(kind string) string {
	if kind != "bash" {
		return ""
	}
	return `__kfm_osc7() { printf '\033]7;file://%s\007' "$PWD"; }
` +
		`__kfm_precmd() { __kfm_osc7; printf '\033]133;D\007'; printf '\033]133;A\007'; }
` +
		`__kfm_preexec() { printf '\033]133;C\007'; }
` +
		`PROMPT_COMMAND="__kfm_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
` +
		`preexec_functions+=(__kfm_preexec)`
}

// shellQuote 对 POSIX shell 单引号转义。
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// unixShellKind 按可执行文件名判断 shell 种类。
func unixShellKind(p string) string {
	b := strings.ToLower(filepath.Base(p))
	switch {
	case strings.Contains(b, "zsh"):
		return "zsh"
	case strings.Contains(b, "bash"):
		return "bash"
	default:
		return "sh"
	}
}

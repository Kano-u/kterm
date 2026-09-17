package terminal

// shell 探测与启动参数。
//
// 探测顺序：
//   - Windows: pwsh.exe → powershell.exe → cmd.exe（首个在 PATH 中存在的）
//   - Unix:    $SHELL → bash → sh
//
// shell 集成注入（T2）：
//   - pwsh 7.4+ 原生输出 OSC 133 / OSC 7；
//   - Windows PowerShell 5.1 通过 -Command 包装 prompt 函数；
//   - bash/zsh 注入 PROMPT_COMMAND / precmd+preexec；
//   - cmd.exe 无集成（降级：无 busy 锁定、无终端→文件同步）。
//
// T0 骨架：T1 实现探测逻辑与单测。
type shellInfo struct {
	path     string   // 可执行文件绝对路径
	args     []string // 启动参数
	degraded bool     // true 表示无 OSC 集成能力（cmd）
}

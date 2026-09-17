package terminal

// oscScanner 对 PTY 输出流做旁路 OSC 序列扫描：
// 识别 OSC 7（cwd 上报）、OSC 133;C / 133;D（busy 标记），
// 不吞字节、原样透传全部输出（xterm.js 本就要渲染这些序列）。
//
// 序列可能跨 WebSocket 帧 / read 边界截断，扫描器需自持中间状态；
// UTF-8 多字节字符被帧边界切开时不得影响输出与解析。
//
// T0 骨架：T2 实现扫描逻辑与单测（osc_test.go）。
type oscScanner struct {
	// 待补充：跨帧缓冲、当前序列累计区、回调（onCWD / onBusy）
}

func newOSCScanner() *oscScanner {
	return &oscScanner{}
}

// Write 喂入一段 PTY 输出，原样透传并旁路解析其中的 OSC 序列。
func (s *oscScanner) Write(p []byte) (int, error) {
	return len(p), nil
}

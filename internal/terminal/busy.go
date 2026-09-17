package terminal

import (
	"encoding/json"
	"time"
)

// T3 运行状态（busy）判定：按 shell 的上报能力分三种模式，逐步降级。
//
//	模式 A（完整 133）—— 收到过 OSC 133;C（命令开始）：
//	    busy 完全由 133 决定；C → true，D → false。用户输入不参与判定。
//	    pwsh / Windows PowerShell（PSReadLine AddToHistoryHandler 发 C，prompt 发 D）。
//
//	模式 B（仅 133;D）—— 只收到过 OSC 133;D（命令结束），未见过 C：
//	    起点用启发式（提交输入含回车 → busy），终点用 133;D 精确复位。
//	    bash 的 preexec 钩子在原生 bash 中并不存在，实际只有 PROMPT_COMMAND 的 D。
//
//	模式 C（无集成）—— 从未收到任何 133 标记（cmd 等）：
//	    起点同上，终点退化为「输出静默 quietResetDelay → 复位」，
//	    另设 quietResetCap 上限，避免无输出时永久锁定。
//
// 交互程序（vim/less/长命令）在模式 C 下：它们要么持续刷新屏幕，
// 要么虽无输出但后续按键/回车会重新置 busy，因此不会误复位。

// 降级（模式 C）的时间参数。声明为变量而非常量，便于单测缩短等待时间。
var (
	// quietResetDelay 最后一段输出之后经过多久认为命令已结束。取值大于 shell
	// 回显 prompt 的间隔，避免回车后因 prompt 输出结束而过早解锁。
	quietResetDelay = 1500 * time.Millisecond
	// quietResetCap busy 的最长保持时间（无输出也不无限锁定）。
	quietResetCap = 60 * time.Second
)

// setBusy 更新 busy 状态；仅状态真正变化时推送 {"t":"busy"}。
func (s *Session) setBusy(on bool) {
	s.mu.Lock()
	if s.busy == on {
		s.mu.Unlock()
		return
	}
	s.busy = on
	if !on {
		s.stopTimersLocked()
	}
	s.mu.Unlock()
	s.pushBusy(on)
}

// noteInput 记录用户键入：模式 B/C 下，含回车/换行的输入视为「命令已提交」。
// 模式 A 由 OSC 133;C 精确判定，这里立即返回（因此注入的 cd 不会误锁目录）。
func (s *Session) noteInput(b []byte) {
	if !hasSubmitByte(b) {
		return
	}
	s.mu.Lock()
	if s.integrationStart {
		s.mu.Unlock()
		return
	}
	was := s.busy
	s.busy = true
	if !s.integrationEnd { // 模式 C：无结束标记，靠静默/上限兜底
		s.armTimersLocked()
	}
	s.mu.Unlock()
	if !was {
		s.pushBusy(true)
	}
}

// noteOutput 记录 PTY 输出：仅模式 C 下刷新静默窗口（命令仍在跑，连上限一起顺延）。
func (s *Session) noteOutput() {
	s.mu.Lock()
	if !s.busy || s.integrationStart || s.integrationEnd {
		s.mu.Unlock()
		return
	}
	if s.quietTimer != nil {
		s.quietTimer.Reset(quietResetDelay)
	}
	if s.capTimer != nil {
		s.capTimer.Reset(quietResetCap)
	}
	s.mu.Unlock()
}

// armTimersLocked 启动降级模式的两个计时器（调用方持有 s.mu）：
//   - quiet 计时器：输出静默 quietResetDelay 后复位；
//   - cap  计时器：无论如何 quietResetCap 后复位（防长命令卡死锁定）。
func (s *Session) armTimersLocked() {
	s.stopTimersLocked()
	s.quietTimer = time.AfterFunc(quietResetDelay, s.expireBusy)
	s.capTimer = time.AfterFunc(quietResetCap, s.expireBusy)
}

// stopTimersLocked 停止降级模式计时器（调用方持有 s.mu）。
func (s *Session) stopTimersLocked() {
	if s.quietTimer != nil {
		s.quietTimer.Stop()
		s.quietTimer = nil
	}
	if s.capTimer != nil {
		s.capTimer.Stop()
		s.capTimer = nil
	}
}

// expireBusy 计时器到期：模式 C 下视为命令已结束。
func (s *Session) expireBusy() {
	s.mu.Lock()
	degraded := !s.integrationStart && !s.integrationEnd
	s.mu.Unlock()
	if degraded {
		s.setBusy(false)
	}
}

// pushBusy 推送一条 busy 帧。
func (s *Session) pushBusy(on bool) {
	if b, err := json.Marshal(outBusy{Type: "busy", On: on}); err == nil {
		s.pushFrame(b)
	}
}

// hasSubmitByte 判断输入是否包含命令提交字符（回车 / 换行）。
func hasSubmitByte(b []byte) bool {
	for _, c := range b {
		if c == '\r' || c == '\n' {
			return true
		}
	}
	return false
}

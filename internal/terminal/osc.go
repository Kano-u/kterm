package terminal

import (
	"net/url"
	"runtime"
	"strings"
)

// oscScanner 对 PTY 输出流做旁路 OSC 序列扫描：
// 识别 OSC 7（cwd 上报）、OSC 133;C / 133;D（busy 标记，T3 使用）。
// 扫描器不吞字节：收到的每个字节都按顺序经 emit 原样透传（xterm.js 本就要渲染这些序列），
// 解析只是旁路动作。
//
// 序列可能跨帧（WS 消息 / PTY read 边界）截断，扫描器自持中间状态：
//   - 帧尾落单的 ESC 缓存到下一帧拼接（可能构成 OSC 开头或 ST 终止符）；
//   - OSC 累计中跨帧继续，直至 BEL / ST 终止。
//
// UTF-8 多字节字符被帧边界切开时无需特殊处理：透传按字节进行，解析只针对 ASCII 控制序列。
// 超过 oscMaxLen 的异常序列放弃解析（仍透传），防恶意输出撑爆内存。
type oscScanner struct {
	inOSC     bool   // 正在累计 OSC 序列内容
	pending   []byte // OSC 序列内容（不含 ESC ] 头与终止符）
	truncated bool   // 序列超限，放弃解析但继续透传至终止符
	carry     []byte // 帧尾残留的落单 ESC（跨帧拼接）

	emit   func([]byte)     // 透传输出（binary 帧原样转发）
	onCWD  func(abs string) // OSC 7 解析结果（绝对路径）
	onBusy func(on bool)    // OSC 133;C/D（T3 使用）
}

// oscMaxLen 限制单个 OSC 序列累计的最大字节数。
const oscMaxLen = 8192

func newOSCScanner(emit func([]byte), onCWD func(abs string), onBusy func(on bool)) *oscScanner {
	return &oscScanner{emit: emit, onCWD: onCWD, onBusy: onBusy}
}

// Feed 喂入一段 PTY 输出：透传全部字节并旁路解析其中完整出现的 OSC 序列。
func (s *oscScanner) Feed(p []byte) {
	if len(p) == 0 {
		return
	}

	data := p
	if len(s.carry) > 0 { // 拼回上帧残留的 ESC
		data = append(s.carry, p...)
		s.carry = nil
	}

	// 快路径：不在 OSC 中且无 ESC → 整段直接透传
	if !s.inOSC && !s.truncated {
		hasEsc := false
		for _, b := range data {
			if b == 0x1b {
				hasEsc = true
				break
			}
		}
		if !hasEsc {
			s.emit(data)
			return
		}
	}

	out := make([]byte, 0, len(data)+8)
	i := 0
	for i < len(data) {
		b := data[i]

		if s.inOSC { // 累计 OSC 内容（字节仍透传）
			switch b {
			case 0x07: // BEL 终止
				s.dispatchOSC()
				out = append(out, b)
				s.endOSC()
				i++
			case 0x1b: // ST（ESC \）或异常
				if i+1 < len(data) {
					if data[i+1] == '\\' {
						s.dispatchOSC()
						out = append(out, 0x1b, '\\')
						s.endOSC()
						i += 2
					} else {
						// OSC 内出现 ESC + 其他字符：交给外层状态机处理（透传）
						s.inOSC = false
					}
				} else {
					// ESC 是本帧最后一字节：ST 可能跨帧，缓存
					s.carry = append(s.carry[:0], 0x1b)
					i++
				}
			default:
				s.appendPending(b)
				out = append(out, b)
				i++
			}
			continue
		}

		if b == 0x1b {
			if i+1 >= len(data) { // 落单 ESC：缓存到下一帧
				s.carry = append(s.carry[:0], data[i:]...)
				i++
				break
			}
			if data[i+1] == ']' { // OSC 开头
				s.inOSC = true
				s.pending = s.pending[:0]
				s.truncated = false
				out = append(out, 0x1b, ']')
				i += 2
				continue
			}
			// 其他转义序列（CSI 等）：前两字节原样透传（OSC/CSI 参数字符不含 ESC，逐对处理即可）
			out = append(out, 0x1b, data[i+1])
			i += 2
			continue
		}

		out = append(out, b)
		i++
	}

	if len(out) > 0 {
		s.emit(out)
	}
}

// endOSC 结束一条 OSC 序列的累计。
func (s *oscScanner) endOSC() {
	s.inOSC = false
	s.pending = s.pending[:0]
	s.truncated = false
}

// appendPending 累计 OSC 内容字节，超限后放弃解析（置 truncated，仍透传）。
func (s *oscScanner) appendPending(b byte) {
	if s.truncated || len(s.pending)+1 > oscMaxLen {
		s.truncated = true
		return
	}
	s.pending = append(s.pending, b)
}

// dispatchOSC 解析一条完整 OSC 序列（s.pending），并清空 truncated 标记。
func (s *oscScanner) dispatchOSC() {
	body := string(s.pending)
	trunc := s.truncated
	s.truncated = false
	if trunc {
		return // 超限序列不解析
	}
	// 格式：Ps ; Pt，Ps 为数字编号
	semi := strings.IndexByte(body, ';')
	code, param := body, ""
	if semi >= 0 {
		code, param = body[:semi], body[semi+1:]
	}
	switch code {
	case "7":
		if abs := parseOSC7(param); abs != "" && s.onCWD != nil {
			s.onCWD(abs)
		}
	case "133":
		if s.onBusy == nil {
			return
		}
		switch param {
		case "C":
			s.onBusy(true)
		case "D":
			s.onBusy(false)
		}
	}
}

// parseOSC7 解析 OSC 7 的 file:// URL，返回 OS 原生分隔符的绝对路径。
// 仅接受本地路径；无法解析或为远程主机（UNC / 其他 host）时返回空串。
//
// 兼容两种本地写法：
//   - file:///C:/Users/kano（RFC 形式，host 为空）
//   - file://C:/Users/kano（PowerShell shell integration 的实际输出，
//     盘符被当成 host，若按 RFC 严格判 host 会被误判为“远程主机”而丢弃）
func parseOSC7(u string) string {
	u = strings.TrimSpace(u)
	if !strings.HasPrefix(u, "file://") {
		return ""
	}
	rest := u[len("file://"):]
	if rest == "" {
		return ""
	}
	if isWindowsDrivePath(rest) {
		return decodeURLPath(rest)
	}
	slash := strings.IndexByte(rest, '/')
	if slash < 0 {
		return ""
	}
	host, path := rest[:slash], rest[slash:]
	if host != "" && !strings.EqualFold(host, "localhost") {
		return "" // 远程主机路径，不适用
	}
	return decodeURLPath(path)
}

// isWindowsDrivePath 判断 "C:/..." / "C:\\..." 形式的 Windows 盘符路径。
func isWindowsDrivePath(s string) bool {
	if len(s) < 2 || s[1] != ':' {
		return false
	}
	c := s[0]
	if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z') {
		return false
	}
	return len(s) == 2 || s[2] == '/' || s[2] == '\\'
}

// decodeURLPath 百分号解码后转为 OS 原生路径。
func decodeURLPath(p string) string {
	dec, err := url.PathUnescape(p)
	if err != nil {
		return ""
	}
	return nativePath(dec)
}

// nativePath 把 file URL 路径转换为 OS 原生路径。
// Windows：形如 /C:/... 的盘符路径去掉前导 / 并改反斜杠；其余保留前导 /（根路径语义）。
func nativePath(p string) string {
	if runtime.GOOS == "windows" {
		if len(p) >= 3 && p[0] == '/' && p[2] == ':' {
			p = p[1:]
		}
		return strings.ReplaceAll(p, "/", "\\")
	}
	return p
}

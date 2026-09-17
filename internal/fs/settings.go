package fs

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// SettingsFileName 是 user settings 文件名，位于起始目录内，列表与搜索永远排除。
const SettingsFileName = ".kfm-settings.json"

// 设置内容的规模上限：够用即可，避免异常输入把配置和界面撑爆。
const (
	SettingsMaxRows       = 8   // 按键行数上限
	SettingsMaxPerRow     = 24  // 每行按键数上限
	SettingsMaxKeyLen     = 24  // 单个按键名长度上限（字符数）
	SettingsMaxStartupLen = 512 // 启动命令模板长度上限（字符数）
)

// URLPlaceholder 是启动命令模板里代表服务地址的占位符。
const URLPlaceholder = "{url}"

// Settings 是持久化在 <root>/.kfm-settings.json 中的用户设置。
type Settings struct {
	Keys           [][]string `json:"keys"`           // 按键栏布局：外层每项一行，内层为按键名
	KeyBarEnabled  bool       `json:"keyBarEnabled"`  // 键盘增强总开关（终端软键盘弹出时显示按键栏）
	StartupCommand string     `json:"startupCommand"` // 启动命令模板（如 "termux-open-url {url}"），空 = 不自动打开
}

// settingsFile 是磁盘上的表示：开关用指针以便区分「缺字段」（默认开启）与显式 false。
// keyBarMode 是同一功能的早期字段名（auto/always/off），仅用于兼容旧文件。
type settingsFile struct {
	Keys           [][]string `json:"keys"`
	KeyBarEnabled  *bool      `json:"keyBarEnabled"`
	KeyBarMode     string     `json:"keyBarMode"`
	StartupCommand string     `json:"startupCommand"`
}

// DefaultSettings 返回内置默认设置：两行移动端终端常用键，按键栏开启。
// 启动命令默认留空 —— 不自动打开任何东西，由用户显式设置。
func DefaultSettings() Settings {
	return Settings{
		Keys: [][]string{
			{"ESC", "TAB", "CTRL", "ALT", "-", "UP", "ENTER"},
			{"INS", "END", "SHIFT", ":", "LEFT", "DOWN", "RIGHT"},
		},
		KeyBarEnabled: true,
	}
}

// Normalize 补齐空字段（读盘宽容：空布局回退默认两行；启动命令去掉首尾空白）。
func (s *Settings) Normalize() {
	if len(s.Keys) == 0 {
		s.Keys = DefaultSettings().Keys
	}
	s.StartupCommand = strings.TrimSpace(s.StartupCommand)
}

// ValidateSettings 校验按键布局、显示方式与启动命令（保存前的最后一道关）。
func ValidateSettings(s Settings) error {
	if n := utf8.RuneCountInString(s.StartupCommand); n > SettingsMaxStartupLen {
		return fmt.Errorf("启动命令过长（最多 %d 字）", SettingsMaxStartupLen)
	}
	if strings.ContainsAny(s.StartupCommand, "\x00\r\n") {
		return fmt.Errorf("启动命令不能包含换行或空字符")
	}
	return validateKeys(s)
}

// validateKeys 校验按键栏布局。
func validateKeys(s Settings) error {
	if len(s.Keys) == 0 {
		return fmt.Errorf("至少需要一行按键")
	}
	if len(s.Keys) > SettingsMaxRows {
		return fmt.Errorf("按键行数过多（最多 %d 行）", SettingsMaxRows)
	}
	for i, row := range s.Keys {
		if len(row) == 0 {
			return fmt.Errorf("第 %d 行没有任何按键", i+1)
		}
		if len(row) > SettingsMaxPerRow {
			return fmt.Errorf("第 %d 行按键过多（每行最多 %d 个）", i+1, SettingsMaxPerRow)
		}
		for j, k := range row {
			if k == "" {
				return fmt.Errorf("第 %d 行第 %d 个按键名为空", i+1, j+1)
			}
			if len([]rune(k)) > SettingsMaxKeyLen {
				return fmt.Errorf("按键名过长（最多 %d 字）: %s", SettingsMaxKeyLen, k)
			}
			if strings.ContainsAny(k, " \t\r\n") {
				return fmt.Errorf("按键名不能包含空白字符: %s", k)
			}
		}
	}
	return nil
}

// SettingsLoad 是一次设置的读取结果。
type SettingsLoad struct {
	Settings Settings
	FromFile bool   // 是否成功读到了配置文件（false 表示用了内置默认）
	Warning  string // 文件存在但不可用时的中文提示（前端 toast 一次）
}

// LoadSettings 读取 <root>/.kfm-settings.json。
//   - 文件不存在 → 内置默认（不写盘）
//   - 文件损坏 / 不合法 → 内置默认 + Warning（保留磁盘上的坏文件，不覆盖）
func (r *Root) LoadSettings() SettingsLoad {
	path, err := r.Resolve(SettingsFileName)
	if err != nil {
		return SettingsLoad{Settings: DefaultSettings(), Warning: "设置文件路径不可用，已使用默认设置"}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return SettingsLoad{Settings: DefaultSettings()}
		}
		return SettingsLoad{Settings: DefaultSettings(), Warning: "读取设置失败，已使用默认设置"}
	}
	var f settingsFile
	if err := json.Unmarshal(data, &f); err != nil {
		return SettingsLoad{Settings: DefaultSettings(), Warning: "设置文件格式错误，已使用默认设置"}
	}
	// 缺 keyBarEnabled → 默认开启；仅有旧字段 keyBarMode 时用 "off" 映射为关闭
	enabled := f.KeyBarEnabled == nil || *f.KeyBarEnabled
	if f.KeyBarEnabled == nil && f.KeyBarMode == "off" {
		enabled = false
	}
	s := Settings{Keys: f.Keys, KeyBarEnabled: enabled, StartupCommand: f.StartupCommand}
	s.Normalize()
	if err := ValidateSettings(s); err != nil {
		return SettingsLoad{Settings: DefaultSettings(), Warning: "设置文件不合法（" + err.Error() + "），已使用默认设置"}
	}
	return SettingsLoad{Settings: s, FromFile: true}
}

// SaveSettings 校验后原子写入设置文件（临时文件 + rename，避免写一半掉电损坏）。
func (r *Root) SaveSettings(s Settings) error {
	if err := ValidateSettings(s); err != nil {
		return err
	}
	s.Normalize()
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	tmp, err := os.CreateTemp(r.dir, SettingsFileName+".tmp-*")
	if err != nil {
		return fmt.Errorf("写入设置失败: %w", err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("写入设置失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("写入设置失败: %w", err)
	}
	if err := os.Rename(tmpName, filepath.Join(r.dir, SettingsFileName)); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("保存设置失败: %w", err)
	}
	return nil
}

// StartupArgv 把启动命令模板展开为可执行的参数列表（argv）：
//
//   - 空模板 → nil（不执行任何东西）
//   - 按空白拆分为参数，支持单引号 / 双引号包裹含空格的参数
//   - 模板中的 {url} 替换为服务地址；模板里没有 {url} 时把地址追加到末尾
//
// 命令不经过 shell，因此 shell 元字符（管道、重定向）不会被解释。
func StartupArgv(tmpl, url string) ([]string, error) {
	tmpl = strings.TrimSpace(tmpl)
	if tmpl == "" {
		return nil, nil
	}
	argv, err := splitCommandLine(tmpl)
	if err != nil {
		return nil, err
	}
	if len(argv) == 0 || argv[0] == "" {
		return nil, fmt.Errorf("启动命令为空")
	}
	hasPlaceholder := false
	for i, a := range argv {
		if strings.Contains(a, URLPlaceholder) {
			hasPlaceholder = true
			argv[i] = strings.ReplaceAll(a, URLPlaceholder, url)
		}
	}
	if !hasPlaceholder && url != "" {
		argv = append(argv, url)
	}
	return argv, nil
}

// splitCommandLine 按空白拆分命令行，支持单引号 / 双引号包裹的参数。
// 双引号内 \" 与 \\ 视为转义；引号外反斜杠按字面处理（兼容 Windows 路径）。
func splitCommandLine(s string) ([]string, error) {
	var out []string
	var cur strings.Builder
	inSingle, inDouble, started := false, false, false
	flush := func() {
		if started {
			out = append(out, cur.String())
			cur.Reset()
			started = false
		}
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case inSingle:
			if c == '\'' {
				inSingle = false
			} else {
				cur.WriteByte(c)
			}
		case inDouble:
			switch {
			case c == '"':
				inDouble = false
			case c == '\\' && i+1 < len(s) && (s[i+1] == '"' || s[i+1] == '\\'):
				i++
				cur.WriteByte(s[i])
			default:
				cur.WriteByte(c)
			}
		default:
			switch c {
			case '\'':
				inSingle, started = true, true
			case '"':
				inDouble, started = true, true
			case ' ', '\t':
				flush()
			default:
				cur.WriteByte(c)
				started = true
			}
		}
	}
	if inSingle || inDouble {
		return nil, fmt.Errorf("启动命令的引号没有闭合")
	}
	flush()
	return out, nil
}

// reservedName 报告 name 是否为 kfm 内部条目（回收站、设置文件及其写入临时文件、
// 编辑器原子写入的临时文件）。内部条目不参与目录列表与搜索，避免用户误删或误搜。
func reservedName(name string) bool {
	return name == TrashDirName || name == SettingsFileName ||
		strings.HasPrefix(name, SettingsFileName+".tmp-") ||
		strings.HasPrefix(name, EditTempPrefix)
}

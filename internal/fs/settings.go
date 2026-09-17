package fs

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// SettingsFileName 是 user settings 文件名，位于 root 内，列表与搜索永远排除。
const SettingsFileName = ".kfm-settings.json"

// 设置内容的规模上限：够用即可，避免异常输入把配置和界面撑爆。
const (
	SettingsMaxRows   = 8  // 按键行数上限
	SettingsMaxPerRow = 24 // 每行按键数上限
	SettingsMaxKeyLen = 24 // 单个按键名长度上限（字符数）
)

// Settings 是持久化在 <root>/.kfm-settings.json 中的用户设置。
type Settings struct {
	Keys          [][]string `json:"keys"`          // 按键栏布局：外层每项一行，内层为按键名
	KeyBarEnabled bool       `json:"keyBarEnabled"` // 键盘增强总开关（终端软键盘弹出时显示按键栏）
}

// settingsFile 是磁盘上的表示：开关用指针以便区分「缺字段」（默认开启）与显式 false。
// keyBarMode 是同一功能的早期字段名（auto/always/off），仅用于兼容旧文件。
type settingsFile struct {
	Keys          [][]string `json:"keys"`
	KeyBarEnabled *bool      `json:"keyBarEnabled"`
	KeyBarMode    string     `json:"keyBarMode"`
}

// DefaultSettings 返回内置默认设置：两行移动端终端常用键，按键栏开启。
func DefaultSettings() Settings {
	return Settings{
		Keys: [][]string{
			{"ESC", "TAB", "CTRL", "ALT", "-", "UP", "ENTER"},
			{"INS", "END", "SHIFT", ":", "LEFT", "DOWN", "RIGHT"},
		},
		KeyBarEnabled: true,
	}
}

// Normalize 补齐空字段（读盘宽容：空布局回退默认两行）。
func (s *Settings) Normalize() {
	if len(s.Keys) == 0 {
		s.Keys = DefaultSettings().Keys
	}
}

// ValidateSettings 校验按键布局与显示方式（保存前的最后一道关）。
func ValidateSettings(s Settings) error {
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
	s := Settings{Keys: f.Keys, KeyBarEnabled: enabled}
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

// reservedName 报告 name 是否为 kfm 内部条目（回收站、设置文件及其写入临时文件、
// 编辑器原子写入的临时文件）。内部条目不参与目录列表与搜索，避免用户误删或误搜。
func reservedName(name string) bool {
	return name == TrashDirName || name == SettingsFileName ||
		strings.HasPrefix(name, SettingsFileName+".tmp-") ||
		strings.HasPrefix(name, EditTempPrefix)
}

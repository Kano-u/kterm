package fs

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newSettingsTestRoot(t *testing.T) *Root {
	t.Helper()
	return &Root{dir: t.TempDir()}
}

func TestLoadSettingsDefaultWhenMissing(t *testing.T) {
	r := newSettingsTestRoot(t)
	load := r.LoadSettings()
	if load.FromFile {
		t.Fatal("文件不存在时不应标记 FromFile")
	}
	if load.Warning != "" {
		t.Fatalf("文件不存在不应有 warning: %q", load.Warning)
	}
	def := DefaultSettings()
	if len(load.Settings.Keys) != len(def.Keys) {
		t.Fatalf("默认行数不对: %+v", load.Settings.Keys)
	}
	if got := strings.Join(load.Settings.Keys[0], ","); got != "ESC,TAB,CTRL,ALT,-,UP,ENTER" {
		t.Fatalf("默认第一行不对: %s", got)
	}
	if got := strings.Join(load.Settings.Keys[1], ","); got != "INS,END,SHIFT,:,LEFT,DOWN,RIGHT" {
		t.Fatalf("默认第二行不对: %s", got)
	}
	if !load.Settings.KeyBarEnabled {
		t.Fatal("默认应开启按键栏")
	}
	// 未写盘
	if _, err := os.Stat(filepath.Join(r.dir, SettingsFileName)); !os.IsNotExist(err) {
		t.Fatal("读取默认值不应创建文件")
	}
}

func TestSaveAndLoadSettingsRoundTrip(t *testing.T) {
	r := newSettingsTestRoot(t)
	in := Settings{
		Keys:          [][]string{{"CTRL+C", "ESC"}, {"UP", "DOWN"}, {"TAB"}},
		KeyBarEnabled: true,
	}
	if err := r.SaveSettings(in); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	// 无残留临时文件
	dirents, err := os.ReadDir(r.dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range dirents {
		if strings.HasPrefix(d.Name(), SettingsFileName+".tmp-") {
			t.Fatalf("残留临时文件: %s", d.Name())
		}
	}

	load := r.LoadSettings()
	if !load.FromFile || load.Warning != "" {
		t.Fatalf("读回失败: %+v", load)
	}
	if len(load.Settings.Keys) != 3 || load.Settings.Keys[0][0] != "CTRL+C" {
		t.Fatalf("读回内容不对: %+v", load.Settings.Keys)
	}
	if !load.Settings.KeyBarEnabled {
		t.Fatal("读回开关不对: 应为 true")
	}

	// 磁盘上是合法 JSON 且缩进可读
	raw, err := os.ReadFile(filepath.Join(r.dir, SettingsFileName))
	if err != nil {
		t.Fatal(err)
	}
	var onDisk Settings
	if err := json.Unmarshal(raw, &onDisk); err != nil {
		t.Fatalf("落盘不是合法 JSON: %v", err)
	}
	if !strings.Contains(string(raw), "\n  ") {
		t.Fatal("落盘应为缩进格式")
	}
}

func TestLoadSettingsBrokenFileFallsBack(t *testing.T) {
	r := newSettingsTestRoot(t)
	path := filepath.Join(r.dir, SettingsFileName)
	if err := os.WriteFile(path, []byte("{ not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	load := r.LoadSettings()
	if load.FromFile || load.Warning == "" {
		t.Fatalf("损坏文件应回退默认并给出 warning: %+v", load)
	}
	// 坏文件保留，不被自动覆盖
	raw, _ := os.ReadFile(path)
	if string(raw) != "{ not json" {
		t.Fatal("损坏的设置文件不应被覆盖")
	}
}

func TestLoadSettingsInvalidContentFallsBack(t *testing.T) {
	r := newSettingsTestRoot(t)
	if err := os.WriteFile(filepath.Join(r.dir, SettingsFileName), []byte(`{"keys":[[]]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	load := r.LoadSettings()
	if load.FromFile || load.Warning == "" {
		t.Fatalf("非法内容应回退默认: %+v", load)
	}
}

func TestLoadSettingsNormalizesPartialFile(t *testing.T) {
	r := newSettingsTestRoot(t)
	// 只给了 keys，没给开关 → 默认开启；空布局 → 用默认两行
	if err := os.WriteFile(filepath.Join(r.dir, SettingsFileName), []byte(`{"keys":null}`), 0o644); err != nil {
		t.Fatal(err)
	}
	load := r.LoadSettings()
	if !load.FromFile {
		t.Fatalf("应认作有效文件: %+v", load)
	}
	if !load.Settings.KeyBarEnabled {
		t.Fatal("缺 keyBarEnabled 应默认开启")
	}
	if len(load.Settings.Keys) != 2 {
		t.Fatalf("空布局应回退默认: %+v", load.Settings.Keys)
	}
}

// 显式关闭与旧字段 keyBarMode:"off" 都要能读成关闭。
func TestLoadSettingsKeyBarEnabled(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want bool
	}{
		{"显式关闭", `{"keyBarEnabled":false}`, false},
		{"显式开启", `{"keyBarEnabled":true}`, true},
		{"旧字段 off", `{"keyBarMode":"off"}`, false},
		{"旧字段 auto", `{"keyBarMode":"auto"}`, true},
	}
	for _, c := range cases {
		r := newSettingsTestRoot(t)
		if err := os.WriteFile(filepath.Join(r.dir, SettingsFileName), []byte(c.raw), 0o644); err != nil {
			t.Fatal(err)
		}
		load := r.LoadSettings()
		if load.Warning != "" {
			t.Fatalf("%s: 不应有 warning: %s", c.name, load.Warning)
		}
		if load.Settings.KeyBarEnabled != c.want {
			t.Fatalf("%s: 开关应为 %v，实际 %v", c.name, c.want, load.Settings.KeyBarEnabled)
		}
	}
}

func TestSaveSettingsRejectsInvalid(t *testing.T) {
	r := newSettingsTestRoot(t)
	cases := []struct {
		name string
		s    Settings
	}{
		{"无行", Settings{Keys: nil}},
		{"空行", Settings{Keys: [][]string{{}}}},
		{"空按键名", Settings{Keys: [][]string{{"ESC", ""}}}},
		{"带空白", Settings{Keys: [][]string{{"A B"}}}},
		{"按键名过长", Settings{Keys: [][]string{{strings.Repeat("X", SettingsMaxKeyLen+1)}}}},
	}
	for _, c := range cases {
		if err := r.SaveSettings(c.s); err == nil {
			t.Fatalf("%s: 期望报错", c.name)
		}
		if _, err := os.Stat(filepath.Join(r.dir, SettingsFileName)); !os.IsNotExist(err) {
			t.Fatalf("%s: 校验失败不应写盘", c.name)
		}
	}
}

func TestSaveSettingsRejectsOversizeLayout(t *testing.T) {
	manyRows := make([][]string, SettingsMaxRows+1)
	for i := range manyRows {
		manyRows[i] = []string{"ESC"}
	}
	if err := ValidateSettings(Settings{Keys: manyRows}); err == nil {
		t.Fatal("行数超限应报错")
	}

	longRow := make([]string, SettingsMaxPerRow+1)
	for i := range longRow {
		longRow[i] = "A"
	}
	if err := ValidateSettings(Settings{Keys: [][]string{longRow}}); err == nil {
		t.Fatal("单行按键数超限应报错")
	}
}

// 设置文件与写入临时文件都不应出现在列表 / 搜索结果中。
func TestReservedNamesHiddenFromListAndSearch(t *testing.T) {
	r := newSettingsTestRoot(t)
	if err := os.WriteFile(filepath.Join(r.dir, SettingsFileName), []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(r.dir, SettingsFileName+".tmp-123"), []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(r.dir, TrashDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(r.dir, "kfm-settings.json"), []byte("visible"), 0o644); err != nil {
		t.Fatal(err)
	}

	entries, err := r.List("")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != "kfm-settings.json" {
		t.Fatalf("列表应只含普通文件，实际: %+v", entries)
	}

	res, err := r.Search(context.Background(), "", "kfm")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != 1 || res.Hits[0].Name != "kfm-settings.json" {
		t.Fatalf("搜索应只命中普通文件，实际: %+v", res.Hits)
	}
}

/* ---------- 启动命令（startupCommand） ---------- */

func TestStartupCommandRoundTrip(t *testing.T) {
	r := newSettingsTestRoot(t)
	in := DefaultSettings()
	in.StartupCommand = "termux-open-url {url}"
	if err := r.SaveSettings(in); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	load := r.LoadSettings()
	if !load.FromFile || load.Warning != "" {
		t.Fatalf("读回失败: %+v", load)
	}
	if load.Settings.StartupCommand != "termux-open-url {url}" {
		t.Fatalf("启动命令读回不对: %q", load.Settings.StartupCommand)
	}
	raw, err := os.ReadFile(filepath.Join(r.dir, SettingsFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"startupCommand"`) {
		t.Fatalf("落盘应包含 startupCommand 字段: %s", raw)
	}
}

// 旧设置文件（没有 startupCommand 字段）读成空字符串（= 不自动打开），不报错。
func TestStartupCommandDefaultsToEmpty(t *testing.T) {
	r := newSettingsTestRoot(t)
	if err := os.WriteFile(filepath.Join(r.dir, SettingsFileName), []byte(`{"keys":[["ESC"]]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	load := r.LoadSettings()
	if load.Warning != "" {
		t.Fatalf("不应有 warning: %s", load.Warning)
	}
	if load.Settings.StartupCommand != "" {
		t.Fatalf("缺字段应读成空: %q", load.Settings.StartupCommand)
	}
	if DefaultSettings().StartupCommand != "" {
		t.Fatal("内置默认启动命令应为空")
	}
}

// Normalize 去掉首尾空白（用户粘贴时常见的多余空格）。
func TestStartupCommandNormalized(t *testing.T) {
	r := newSettingsTestRoot(t)
	in := DefaultSettings()
	in.StartupCommand = "  termux-open-url {url}  "
	if err := r.SaveSettings(in); err != nil {
		t.Fatal(err)
	}
	if got := r.LoadSettings().Settings.StartupCommand; got != "termux-open-url {url}" {
		t.Fatalf("首尾空白应被去掉: %q", got)
	}
}

func TestSaveSettingsRejectsBadStartupCommand(t *testing.T) {
	r := newSettingsTestRoot(t)
	base := DefaultSettings()
	cases := []struct {
		name string
		cmd  string
	}{
		{"过长", strings.Repeat("x", SettingsMaxStartupLen+1)},
		{"含换行", "termux-open-url {url}\nrm -rf /"},
	}
	for _, c := range cases {
		s := base
		s.StartupCommand = c.cmd
		if err := r.SaveSettings(s); err == nil {
			t.Fatalf("%s: 期望报错", c.name)
		}
		if _, err := os.Stat(filepath.Join(r.dir, SettingsFileName)); !os.IsNotExist(err) {
			t.Fatalf("%s: 校验失败不应写盘", c.name)
		}
	}
}

func TestStartupArgv(t *testing.T) {
	const url = "http://127.0.0.1:8080"
	cases := []struct {
		name string
		tmpl string
		want []string
	}{
		{"空模板不执行", "", nil},
		{"纯空白不执行", "   \t ", nil},
		{"占位符替换", "termux-open-url {url}", []string{"termux-open-url", url}},
		{"无占位符则追加地址", "xdg-open", []string{"xdg-open", url}},
		{"多余空白折叠", "  open   {url}  ", []string{"open", url}},
		{"双引号含空格", `sh -c "echo {url}"`, []string{"sh", "-c", "echo " + url}},
		{"单引号含空格", `my-open '--title=My Page' {url}`, []string{"my-open", "--title=My Page", url}},
		{"双引号内转义", `say "a\"b" {url}`, []string{"say", `a"b`, url}},
		{"地址出现在中间", "cmd {url} --flag", []string{"cmd", url, "--flag"}},
	}
	for _, c := range cases {
		got, err := StartupArgv(c.tmpl, url)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if strings.Join(got, "\x00") != strings.Join(c.want, "\x00") {
			t.Fatalf("%s: argv 应为 %q，实际 %q", c.name, c.want, got)
		}
	}
}

func TestStartupArgvRejectsUnclosedQuote(t *testing.T) {
	if _, err := StartupArgv(`open "unterminated`, "http://x"); err == nil {
		t.Fatal("引号未闭合应报错")
	}
}

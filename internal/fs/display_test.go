package fs

import (
	"path/filepath"
	"testing"
)

func TestDisplayPath(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"a/b", "a/b"},
		{"/sdcard/x", "/sdcard/x"},
		{"C:/Users", "C:/Users"},
	}
	for _, c := range cases {
		if got := DisplayPath(c.in); got != c.want {
			t.Errorf("DisplayPath(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestStorePath(t *testing.T) {
	if got := StorePath("C:" + string(filepath.Separator) + "x"); got != "C:/x" {
		t.Errorf("StorePath 应统一为 / 分隔: %q", got)
	}
	if got := StorePath(""); got != "" {
		t.Errorf("StorePath(空) 应为空: %q", got)
	}
}

// 相对 ../ 路径（越出起始目录）的解析结果必须是绝对路径且指向正确的兄弟目录。
func TestResolveRelativeOutside(t *testing.T) {
	r := newEditTestRoot(t)
	sibling := filepath.Join(filepath.Dir(r.dir), "sibling")
	got, err := r.Resolve("../sibling/file.txt")
	if err != nil {
		t.Fatal(err)
	}
	if got != filepath.Join(sibling, "file.txt") {
		t.Errorf("Resolve = %q, want %q", got, filepath.Join(sibling, "file.txt"))
	}
}

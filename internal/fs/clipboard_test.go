package fs

import (
	"os"
	"path/filepath"
	"testing"
)

func newTestRoot(t *testing.T) *Root {
	t.Helper()
	dir := t.TempDir()
	return &Root{dir: dir}
}

func TestConflictName(t *testing.T) {
	r := newTestRoot(t)
	if err := os.MkdirAll(filepath.Join(r.dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(r.dir, "sub", "a.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 已存在 a.txt → 应得 a (2).txt
	got, err := conflictName(filepath.Join(r.dir, "sub"), "a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if got != "a (2).txt" {
		t.Fatalf("期望 a (2).txt，得到 %s", got)
	}
	// 不存在 → 原名
	got, err = conflictName(filepath.Join(r.dir, "sub"), "b.txt")
	if err != nil {
		t.Fatal(err)
	}
	if got != "b.txt" {
		t.Fatalf("期望 b.txt，得到 %s", got)
	}
	// 隐藏文件 .xx 不拆扩展名
	got, err = conflictName(filepath.Join(r.dir, "sub"), ".xx")
	if err != nil {
		t.Fatal(err)
	}
	if got != ".xx" {
		t.Fatalf("期望 .xx，得到 %s", got)
	}
}

func TestCopyMoveRoundTrip(t *testing.T) {
	r := newTestRoot(t)
	if err := os.MkdirAll(filepath.Join(r.dir, "src", "dir1"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(r.dir, "src", "dir1", "f.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(r.dir, "src", "top.txt"), []byte("top"), 0o644); err != nil {
		t.Fatal(err)
	}

	// 复制目录（含子文件）
	rep, err := r.CopyItems("src", []string{"dir1"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if rep.Failed != 0 || rep.Success != 1 {
		t.Fatalf("复制目录失败: %+v", rep)
	}
	data, err := os.ReadFile(filepath.Join(r.dir, "dir1", "f.txt"))
	if err != nil || string(data) != "hello" {
		t.Fatalf("复制后内容不对: %s %v", data, err)
	}

	// 再次复制 → 冲突自动改名 dir1 (2)
	rep, err = r.CopyItems("src", []string{"dir1"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if rep.Results[0].Dest != "dir1 (2)" {
		t.Fatalf("期望 dir1 (2)，得到 %+v", rep.Results[0])
	}

	// 移动文件
	rep, err = r.MoveItems("src", []string{"top.txt"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if rep.Failed != 0 {
		t.Fatalf("移动失败: %+v", rep)
	}
	if _, err := os.Stat(filepath.Join(r.dir, "src", "top.txt")); !os.IsNotExist(err) {
		t.Fatalf("移动后源文件仍存在: %v", err)
	}

	// 移动目录到自身子目录 → 拒绝
	rep, err = r.MoveItems("", []string{"dir1"}, "dir1")
	if err != nil {
		t.Fatal(err) // 请求级别成功，逐项报错
	}
	if rep.Failed != 1 {
		t.Fatalf("目录移入自身应失败: %+v", rep)
	}

	// 逐项错误：不存在的文件
	rep, err = r.CopyItems("src", []string{"nope.txt"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if rep.Failed != 1 || rep.Success != 0 {
		t.Fatalf("不存在文件应逐项失败: %+v", rep)
	}
}

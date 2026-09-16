package fs

import (
	"os"
	"path/filepath"
	"testing"
)

func newTrashTestRoot(t *testing.T) *Root {
	t.Helper()
	dir := t.TempDir()
	return &Root{dir: dir}
}

func TestDeleteRestoreRoundTrip(t *testing.T) {
	r := newTrashTestRoot(t)
	if err := os.MkdirAll(filepath.Join(r.dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(r.dir, "sub", "a.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}

	// 删除（移入回收站）
	rep, err := r.DeleteItems("", []string{"sub"}, false)
	if err != nil || rep.Failed != 0 {
		t.Fatalf("delete: rep=%+v err=%v", rep, err)
	}
	if _, err := os.Stat(filepath.Join(r.dir, "sub")); !os.IsNotExist(err) {
		t.Fatal("sub 应已不在原位置")
	}

	// 列出
	items, err := r.ListTrash()
	if err != nil || len(items) != 1 {
		t.Fatalf("ListTrash: items=%+v err=%v", items, err)
	}
	if items[0].Path != "" || len(items[0].Names) != 1 || items[0].Names[0] != "sub" {
		t.Fatalf("meta 不正确: %+v", items[0])
	}

	// 原位置重建同名目录，恢复应自动改名 sub (2)
	if err := os.MkdirAll(filepath.Join(r.dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	rrep, err := r.RestoreTrash([]string{items[0].ID})
	if err != nil || rrep.Failed != 0 {
		t.Fatalf("restore: rep=%+v err=%v", rrep, err)
	}
	if _, err := os.Stat(filepath.Join(r.dir, "sub (2)", "a.txt")); err != nil {
		t.Fatalf("恢复结果不对: %v", err)
	}
}

// 原目录被删也能恢复。
func TestRestoreRecreatesMissingDir(t *testing.T) {
	r := newTrashTestRoot(t)
	if err := os.MkdirAll(filepath.Join(r.dir, "d1", "d2"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(r.dir, "d1", "d2", "f.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := r.DeleteItems("d1", []string{"d2"}, false); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(r.dir, "d1")); err != nil {
		t.Fatal(err)
	}
	items, _ := r.ListTrash()
	if len(items) != 1 {
		t.Fatal("应有 1 个批次")
	}
	if _, err := r.RestoreTrash([]string{items[0].ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(r.dir, "d1", "d2", "f.txt")); err != nil {
		t.Fatalf("原目录应被重建: %v", err)
	}
}

// 永久删除与清空。
func TestPermanentDeleteAndPurge(t *testing.T) {
	r := newTrashTestRoot(t)
	os.WriteFile(filepath.Join(r.dir, "a.txt"), []byte("a"), 0o644)
	os.WriteFile(filepath.Join(r.dir, "b.txt"), []byte("b"), 0o644)

	if _, err := r.DeleteItems("", []string{"a.txt"}, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(r.dir, "a.txt")); !os.IsNotExist(err) {
		t.Fatal("a.txt 应被永久删除")
	}
	items, _ := r.ListTrash()
	if len(items) != 0 {
		t.Fatal("永久删除不应产生回收站批次")
	}

	if _, err := r.DeleteItems("", []string{"b.txt"}, false); err != nil {
		t.Fatal(err)
	}
	if _, err := r.PurgeTrash(nil, true); err != nil {
		t.Fatal(err)
	}
	items, _ = r.ListTrash()
	if len(items) != 0 {
		t.Fatal("清空后应无批次")
	}
	if _, err := os.Stat(filepath.Join(r.dir, TrashDirName)); !os.IsNotExist(err) {
		t.Fatal("回收站目录应被移除")
	}
}

// 禁止删除回收站内部内容。
func TestDeleteGuardTrashDir(t *testing.T) {
	r := newTrashTestRoot(t)
	if _, err := r.DeleteItems(TrashDirName, []string{"x"}, false); err == nil {
		t.Fatal("应拒绝操作回收站内部")
	}
	if _, err := r.DeleteItems(TrashDirName, []string{"x"}, true); err == nil {
		t.Fatal("应拒绝永久删除回收站内部")
	}
}

// 非法批次 ID 被拒绝。
func TestInvalidBatchID(t *testing.T) {
	r := newTrashTestRoot(t)
	rep, err := r.RestoreTrash([]string{"..\\evil"})
	if err != nil || rep.Failed != 1 {
		t.Fatalf("非法 ID 应逐项报错: rep=%+v err=%v", rep, err)
	}
	rep, err = r.PurgeTrash([]string{"zzzz"}, false)
	if err != nil || rep.Failed != 1 {
		t.Fatalf("非法 ID 应逐项报错: rep=%+v err=%v", rep, err)
	}
	// 不应创建任何批次目录
	if _, err := os.Stat(filepath.Join(r.dir, TrashDirName)); !os.IsNotExist(err) {
		t.Fatal("不应创建回收站目录")
	}
}

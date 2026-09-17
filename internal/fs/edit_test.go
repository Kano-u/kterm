package fs

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func newEditTestRoot(t *testing.T) *Root {
	t.Helper()
	return &Root{dir: t.TempDir()}
}

func writeTestFile(t *testing.T, r *Root, rel, content string) string {
	t.Helper()
	full := filepath.Join(r.dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return full
}

func TestReadFileOK(t *testing.T) {
	r := newEditTestRoot(t)
	writeTestFile(t, r, "a.txt", "hello\n世界\n")

	got, err := r.ReadFile("a.txt")
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if got.Content != "hello\n世界\n" {
		t.Fatalf("内容不对: %q", got.Content)
	}
	if got.Size != int64(len("hello\n世界\n")) {
		t.Fatalf("大小不对: %d", got.Size)
	}
	if got.MTime == 0 {
		t.Fatal("mtime 不应为 0")
	}

	// 子目录同样可用
	writeTestFile(t, r, "sub/b.json", "{}")
	if _, err := r.ReadFile("sub/b.json"); err != nil {
		t.Fatalf("子目录读取失败: %v", err)
	}
	// 空文件可读
	writeTestFile(t, r, "empty.txt", "")
	got, err = r.ReadFile("empty.txt")
	if err != nil || got.Content != "" {
		t.Fatalf("空文件读取: %+v err=%v", got, err)
	}
}

// CRLF 换行必须原样保留（不做任何转换），否则 diff 噪音与写回都会出问题。
func TestReadFileKeepsCRLF(t *testing.T) {
	r := newEditTestRoot(t)
	writeTestFile(t, r, "crlf.txt", "a\r\nb\r\n")
	got, err := r.ReadFile("crlf.txt")
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "a\r\nb\r\n" {
		t.Fatalf("CRLF 应原样保留: %q", got.Content)
	}
}

func TestReadFileRejectsDir(t *testing.T) {
	r := newEditTestRoot(t)
	if err := os.MkdirAll(filepath.Join(r.dir, "d"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ReadFile("d"); !errors.Is(err, ErrNotDir) {
		t.Fatalf("目录应报 ErrNotDir: %v", err)
	}
}

func TestReadFileRejectsMissing(t *testing.T) {
	r := newEditTestRoot(t)
	if _, err := r.ReadFile("nope.txt"); !os.IsNotExist(err) {
		t.Fatalf("不存在应报 os.ErrNotExist: %v", err)
	}
}

func TestReadFileRejectsOversize(t *testing.T) {
	r := newEditTestRoot(t)
	full := filepath.Join(r.dir, "big.txt")
	if err := os.WriteFile(full, []byte(strings.Repeat("a", EditMaxSize+1)), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := r.ReadFile("big.txt")
	if err == nil || !strings.Contains(err.Error(), "过大") {
		t.Fatalf("超限应报错: %v", err)
	}
	// 恰好等于上限可以读
	if err := os.WriteFile(full, []byte(strings.Repeat("a", EditMaxSize)), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ReadFile("big.txt"); err != nil {
		t.Fatalf("恰好超限应可读: %v", err)
	}
}

func TestReadFileRejectsBinary(t *testing.T) {
	r := newEditTestRoot(t)
	// NUL 落在采样区内
	if err := os.WriteFile(filepath.Join(r.dir, "bin.dat"), []byte("PK\x00\x03abc"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ReadFile("bin.dat"); err == nil || !strings.Contains(err.Error(), "二进制") {
		t.Fatalf("二进制应被拒绝: %v", err)
	}
	// NUL 在采样区之外（>8KiB）→ 放行
	body := strings.Repeat("a", editProbeSize+16) + "\x00"
	if err := os.WriteFile(filepath.Join(r.dir, "late.dat"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ReadFile("late.dat"); err != nil {
		t.Fatalf("采样区外的 NUL 不应拦截: %v", err)
	}
}

func TestReadFilePathEscape(t *testing.T) {
	r := newEditTestRoot(t)
	if _, err := r.ReadFile("../outside.txt"); err == nil {
		t.Fatal("越界路径应被拒绝")
	}
	if _, err := r.ReadFile("C:/windows/win.ini"); err == nil {
		t.Fatal("绝对路径应被拒绝")
	}
}

func TestWriteFileOK(t *testing.T) {
	r := newEditTestRoot(t)
	full := writeTestFile(t, r, "a.txt", "old")
	info, err := os.Stat(full)
	if err != nil {
		t.Fatal(err)
	}
	// 让 mtime 至少有 1ms 的分辨率差（部分文件系统精度较低）
	time.Sleep(5 * time.Millisecond)

	newMTime, err := r.WriteFile("a.txt", "new content\n", info.ModTime().UnixMilli())
	if err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	raw, err := os.ReadFile(full)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "new content\n" {
		t.Fatalf("写入内容不对: %q", raw)
	}
	if newMTime == 0 {
		t.Fatal("应返回新的 mtime")
	}
	if newMTime == info.ModTime().UnixMilli() {
		t.Fatalf("mtime 应已变化: %d", newMTime)
	}

	// 用新 mtime 再写一次应成功（前端保存后回填新 mtime）
	if _, err := r.WriteFile("a.txt", "third", newMTime); err != nil {
		t.Fatalf("用新 mtime 再写失败: %v", err)
	}

	// 无残留临时文件
	dirents, _ := os.ReadDir(r.dir)
	for _, d := range dirents {
		if strings.Contains(d.Name(), ".kfm-") {
			t.Fatalf("残留临时文件: %s", d.Name())
		}
	}
}

// 保存不应改变文件权限（临时文件默认 0600，必须回填原 mode）。
func TestWriteFileKeepsPerm(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 无 POSIX 权限语义")
	}
	r := newEditTestRoot(t)
	full := writeTestFile(t, r, "x.sh", "#!/bin/sh\n")
	if err := os.Chmod(full, 0o755); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(full)
	if _, err := r.WriteFile("x.sh", "#!/bin/sh\necho hi\n", info.ModTime().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	after, _ := os.Stat(full)
	if after.Mode().Perm() != 0o755 {
		t.Fatalf("权限应保留: %v", after.Mode().Perm())
	}
}

func TestWriteFileConflict(t *testing.T) {
	r := newEditTestRoot(t)
	full := writeTestFile(t, r, "a.txt", "v1")
	info, _ := os.Stat(full)

	// 外部程序改写（模拟：直接写入并显式改 mtime）
	if err := os.WriteFile(full, []byte("v2"), 0o644); err != nil {
		t.Fatal(err)
	}
	past := info.ModTime().Add(2 * time.Second)
	if err := os.Chtimes(full, past, past); err != nil {
		t.Fatal(err)
	}

	_, err := r.WriteFile("a.txt", "v3", info.ModTime().UnixMilli())
	if !errors.Is(err, ErrEditConflict) {
		t.Fatalf("应报 ErrEditConflict: %v", err)
	}
	// 冲突时不得改动文件
	raw, _ := os.ReadFile(full)
	if string(raw) != "v2" {
		t.Fatalf("冲突时不应写入，实际: %q", raw)
	}
	// 无残留临时文件
	dirents, _ := os.ReadDir(r.dir)
	for _, d := range dirents {
		if strings.Contains(d.Name(), ".kfm-") {
			t.Fatalf("冲突后残留临时文件: %s", d.Name())
		}
	}
}

func TestWriteFileRejectsDirAndMissing(t *testing.T) {
	r := newEditTestRoot(t)
	if err := os.MkdirAll(filepath.Join(r.dir, "d"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := r.WriteFile("d", "x", 0); !errors.Is(err, ErrNotDir) {
		t.Fatalf("目录应报 ErrNotDir: %v", err)
	}
	if _, err := r.WriteFile("nope.txt", "x", 0); !os.IsNotExist(err) {
		t.Fatalf("不存在应报 os.ErrNotExist: %v", err)
	}
}

func TestWriteFileOversize(t *testing.T) {
	r := newEditTestRoot(t)
	full := writeTestFile(t, r, "a.txt", "x")
	info, _ := os.Stat(full)
	_, err := r.WriteFile("a.txt", strings.Repeat("a", EditMaxSize+1), info.ModTime().UnixMilli())
	if err == nil || !strings.Contains(err.Error(), "过大") {
		t.Fatalf("超限内容应被拒绝: %v", err)
	}
}

func TestWriteFilePathEscape(t *testing.T) {
	r := newEditTestRoot(t)
	if _, err := r.WriteFile("../evil.txt", "x", 0); err == nil {
		t.Fatal("越界路径应被拒绝")
	}
}

// 读 → 改 → 写 的完整往返，且换行原样保留。
func TestReadWriteRoundTrip(t *testing.T) {
	r := newEditTestRoot(t)
	full := writeTestFile(t, r, "sub/dir/f.txt", "line1\r\nline2\n")

	got, err := r.ReadFile("sub/dir/f.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.WriteFile("sub/dir/f.txt", got.Content+"line3\n", got.MTime); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(full)
	if string(raw) != "line1\r\nline2\nline3\n" {
		t.Fatalf("往返后内容不对: %q", raw)
	}
}

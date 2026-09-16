package fs

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newSearchTestRoot(t *testing.T) *Root {
	t.Helper()
	return &Root{dir: t.TempDir()}
}

func mkFile(t *testing.T, r *Root, parts ...string) {
	t.Helper()
	p := filepath.Join(append([]string{r.dir}, parts...)...)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// 递归匹配 + unicode 大小写不敏感 + 相对路径正确。
func TestSearchBasic(t *testing.T) {
	r := newSearchTestRoot(t)
	mkFile(t, r, "Report.TXT")
	mkFile(t, r, "sub", "年报终稿.docx")
	mkFile(t, r, "sub", "deep", "report_v2.md")
	mkFile(t, r, "other.txt")
	mkFile(t, r, TrashDirName, "report_secret") // 回收站不参与

	res, err := r.Search(context.Background(), "", "REPORT")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != 2 {
		t.Fatalf("应命中 2 条(大小写不敏感): %+v", res.Hits)
	}
	if res.Truncated {
		t.Fatal("不应 truncated")
	}

	// 中文关键词，子目录命中
	res, err = r.Search(context.Background(), "sub", "年报")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != 1 || res.Hits[0].Dir != "" || res.Hits[0].Name != "年报终稿.docx" {
		t.Fatalf("中文搜索结果不对: %+v", res.Hits)
	}

	// 子目录相对路径
	res, err = r.Search(context.Background(), "", "report_v2")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != 1 || res.Hits[0].Dir != "sub/deep" {
		t.Fatalf("相对路径不对: %+v", res.Hits)
	}

	// 空关键词返回空
	res, err = r.Search(context.Background(), "", "  ")
	if err != nil || len(res.Hits) != 0 {
		t.Fatalf("空关键词应返回空: %+v err=%v", res, err)
	}
}

// 搜索上限 500 条并标记 truncated。
func TestSearchLimit(t *testing.T) {
	r := newSearchTestRoot(t)
	for i := 0; i < SearchLimit+50; i++ {
		mkFile(t, r, "hit"+strings.Repeat("x", i%3)+string(rune('a'+i%26))+itoa(i)+".txt")
	}
	res, err := r.Search(context.Background(), "", "hit")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != SearchLimit || !res.Truncated {
		t.Fatalf("应截断到 %d 条: got=%d truncated=%v", SearchLimit, len(res.Hits), res.Truncated)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// context 超时兜底：返回已有部分结果并标记 truncated。
func TestSearchTimeout(t *testing.T) {
	r := newSearchTestRoot(t)
	mkFile(t, r, "a_match.txt")
	// 构造大量子目录使遍历耗时（超时由 ctx 强制兜底）
	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	time.Sleep(time.Millisecond) // 确保 ctx 已超时

	res, err := r.Search(ctx, "", "match")
	if err != nil {
		t.Fatalf("超时应返回已有结果而非错误: %v", err)
	}
	if !res.Truncated {
		t.Fatal("超时应标记 truncated")
	}
}

// 路径越界仍被拒绝。
func TestSearchPathGuard(t *testing.T) {
	r := newSearchTestRoot(t)
	if _, err := r.Search(context.Background(), "../outside", "x"); err == nil {
		t.Fatal(".. 应被拒绝")
	}
}

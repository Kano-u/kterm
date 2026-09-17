package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kfm/internal/fs"
	"kfm/internal/terminal"
)

// withTempRoot 把包级 root 换成临时目录，测试结束恢复。
func withTempRoot(t *testing.T) *fs.Root {
	t.Helper()
	old := root
	r, err := fs.NewRootAt(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root = r
	t.Cleanup(func() { root = old })
	return r
}

func postJSON(t *testing.T, h http.HandlerFunc, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/write", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestReadWriteEndpoints(t *testing.T) {
	r := withTempRoot(t)
	if err := os.WriteFile(filepath.Join(r.Dir(), "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	// GET /api/read
	req := httptest.NewRequest(http.MethodGet, "/api/read?path=a.txt", nil)
	rec := httptest.NewRecorder()
	handleRead(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("read 状态码 %d: %s", rec.Code, rec.Body.String())
	}
	var fc fs.FileContent
	if err := json.Unmarshal(rec.Body.Bytes(), &fc); err != nil {
		t.Fatal(err)
	}
	if fc.Content != "hello" || fc.MTime == 0 {
		t.Fatalf("读取结果不对: %+v", fc)
	}

	// POST /api/write（带正确 mtime）
	payload, _ := json.Marshal(map[string]any{"path": "a.txt", "content": "world", "mtime": fc.MTime})
	rec = postJSON(t, handleWrite, string(payload))
	if rec.Code != http.StatusOK {
		t.Fatalf("write 状态码 %d: %s", rec.Code, rec.Body.String())
	}
	if raw, _ := os.ReadFile(filepath.Join(r.Dir(), "a.txt")); string(raw) != "world" {
		t.Fatalf("落盘内容不对: %q", raw)
	}

	// mtime 过期 → 409
	rec = postJSON(t, handleWrite, string(payload))
	if rec.Code != http.StatusConflict {
		t.Fatalf("冲突应返回 409，实际 %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "已被其他程序修改") {
		t.Fatalf("冲突文案不对: %s", rec.Body.String())
	}
}

func TestReadEndpointErrors(t *testing.T) {
	r := withTempRoot(t)
	// 不存在 → 404
	req := httptest.NewRequest(http.MethodGet, "/api/read?path=nope.txt", nil)
	rec := httptest.NewRecorder()
	handleRead(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("不存在应 404，实际 %d: %s", rec.Code, rec.Body.String())
	}
	// 目录 → 400
	if err := os.Mkdir(filepath.Join(r.Dir(), "d"), 0o755); err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/read?path=d", nil)
	rec = httptest.NewRecorder()
	handleRead(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("目录应 400，实际 %d: %s", rec.Code, rec.Body.String())
	}
}

// 终端 busy 的目录拒绝写入（服务端兜底）。
func TestWriteEndpointRejectsBusy(t *testing.T) {
	r := withTempRoot(t)
	if err := os.WriteFile(filepath.Join(r.Dir(), "a.txt"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	oldMgr := terminal.DefaultManager
	terminal.DefaultManager = terminal.NewManager(nil)
	t.Cleanup(func() { terminal.DefaultManager = oldMgr })
	terminal.DefaultManager.AddBusySessionForTest("tab-busy", r.Dir())

	payload, _ := json.Marshal(map[string]any{"path": "a.txt", "content": "x", "mtime": 0})
	rec := postJSON(t, handleWrite, string(payload))
	if rec.Code != http.StatusConflict {
		t.Fatalf("busy 目录写入应 409，实际 %d: %s", rec.Code, rec.Body.String())
	}
	// 读不受 busy 影响
	req := httptest.NewRequest(http.MethodGet, "/api/read?path=a.txt", nil)
	rec = httptest.NewRecorder()
	handleRead(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("busy 目录仍应可读，实际 %d: %s", rec.Code, rec.Body.String())
	}
}

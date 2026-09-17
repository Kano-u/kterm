// Package server 提供 HTTP 服务：静态资源（go:embed）与 /api 接口。
package server

import (
	"embed"
	"io/fs"
	"net"
	"net/http"
	"strconv"
	"strings"

	"kfm/internal/terminal"
)

//go:embed all:web
var webFS embed.FS

// New 构造 HTTP handler。allowLAN 时放行任意 Host（局域网设备访问）。
func New(port int, allowLAN bool) http.Handler {
	terminal.Init(root)
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/list", handleList)
	mux.HandleFunc("GET /api/root", handleRoot)
	mux.HandleFunc("GET /api/search", handleSearch)
	mux.HandleFunc("POST /api/mkdir", handleMkdir)
	mux.HandleFunc("POST /api/create", handleCreate)
	mux.HandleFunc("POST /api/rename", handleRename)
	mux.HandleFunc("POST /api/copy", handleCopy)
	mux.HandleFunc("POST /api/move", handleMove)
	mux.HandleFunc("POST /api/delete", handleDelete)
	mux.HandleFunc("GET /api/trash", handleTrashList)
	mux.HandleFunc("POST /api/trash/restore", handleTrashRestore)
	mux.HandleFunc("POST /api/trash/purge", handleTrashPurge)
	mux.HandleFunc("GET /api/term/ws", terminal.HandleWS(terminal.DefaultManager))

	// 静态资源
	sub, _ := fs.Sub(webFS, "web")
	fileServer := http.FileServer(http.FS(sub))
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", neuterDirList(fileServer)))
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		serveAsset(w, r, sub, "index.html")
	})

	return hostCheck(port, allowLAN)(mux)
}

// neuterDirList 禁止目录列表。
func neuterDirList(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func serveAsset(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) {
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(data)
}

// hostCheck 中间件：默认仅允许 localhost / 127.0.0.1 / [::1]:port；
// allowLAN 时放行所有来源（配合 -lan 监听所有网卡使用）。
func hostCheck(port int, allowLAN bool) func(http.Handler) http.Handler {
	if allowLAN {
		return func(next http.Handler) http.Handler {
			return next
		}
	}
	allowed := map[string]bool{
		"localhost": true,
		"127.0.0.1": true,
		"::1":       true,
		"[::1]":     true,
		net.JoinHostPort("localhost", strconv.Itoa(port)): true,
		net.JoinHostPort("127.0.0.1", strconv.Itoa(port)): true,
		net.JoinHostPort("::1", strconv.Itoa(port)):       true,
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			host := r.Host
			if h, _, err := net.SplitHostPort(host); err == nil {
				host = h
			}
			host = strings.Trim(host, "[]")
			host = strings.ToLower(host)
			if !allowed[host] && host != "localhost" && host != "127.0.0.1" && host != "::1" {
				http.Error(w, `{"error":"禁止访问：仅允许本机访问"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

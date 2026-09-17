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
	mux.HandleFunc("GET /api/settings", handleSettingsGet)
	mux.HandleFunc("POST /api/settings", handleSettingsPost)
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
	mux.HandleFunc("GET /api/read", handleRead)
	mux.HandleFunc("POST /api/write", handleWrite)
	mux.HandleFunc("GET /api/term/ws", terminal.HandleWS(terminal.DefaultManager))

	// 静态资源：/assets/* 文件名带内容 hash，可永久缓存；index.html 永远不缓存
	sub, _ := fs.Sub(webFS, "web")
	fileServer := http.FileServer(http.FS(sub))
	mux.Handle("GET /assets/", cacheImmutable(http.StripPrefix("/assets/", neuterDirList(fileServer))))
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		serveAsset(w, r, sub, "index.html")
	})

	return hostCheck(port, allowLAN)(mux)
}

// cacheImmutable 为带内容 hash 的静态资源设置一年不可变缓存。
func cacheImmutable(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		next.ServeHTTP(w, r)
	})
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

// hostCheck 中间件：默认仅允许 localhost / 127.0.0.1 / [::1]；
// allowLAN 时额外放行本机各网卡的地址（配合 -lan 监听所有网卡使用）。
// 两种模式都拒绝任意 Host，防 DNS rebinding。
func hostCheck(port int, allowLAN bool) func(http.Handler) http.Handler {
	allowed := map[string]bool{
		"localhost": true,
		"127.0.0.1": true,
		"::1":       true,
		"[::1]":     true,
		net.JoinHostPort("localhost", strconv.Itoa(port)): true,
		net.JoinHostPort("127.0.0.1", strconv.Itoa(port)): true,
		net.JoinHostPort("::1", strconv.Itoa(port)):       true,
	}
	if allowLAN {
		// 本机全部网卡地址加入白名单（含回环）
		if ifaces, err := net.Interfaces(); err == nil {
			for _, iface := range ifaces {
				if iface.Flags&net.FlagUp == 0 {
					continue
				}
				addrs, err := iface.Addrs()
				if err != nil {
					continue
				}
				for _, a := range addrs {
					ipNet, ok := a.(*net.IPNet)
					if !ok {
						continue
					}
					ip := ipNet.IP
					if ip4 := ip.To4(); ip4 != nil {
						ip = ip4
					}
					allowed[ip.String()] = true
					allowed[net.JoinHostPort(ip.String(), strconv.Itoa(port))] = true
				}
			}
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			host := r.Host
			if h, _, err := net.SplitHostPort(host); err == nil {
				host = h
			}
			host = strings.Trim(host, "[]")
			host = strings.ToLower(host)
			if !allowed[host] {
				http.Error(w, `{"error":"禁止访问：仅允许本机访问"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

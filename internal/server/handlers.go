package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path"

	"kfm/internal/fs"
)

// writeErr 统一错误格式 {"error":"中文错误消息"}。
func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}

// errToHTTP 将 fs 层错误映射为 HTTP 状态码与中文消息。
func errToHTTP(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, fs.ErrNotDir):
		writeErr(w, http.StatusBadRequest, "目标不是目录")
	case errors.Is(err, os.ErrNotExist):
		writeErr(w, http.StatusNotFound, "路径不存在: "+path.Base(err.(*os.PathError).Path))
	default:
		writeErr(w, http.StatusBadRequest, err.Error())
	}
}

var root *fs.Root

func init() {
	r, err := fs.NewRoot()
	if err != nil {
		panic(err)
	}
	root = r
}

// RootDir 供 main 打印/使用。
func RootDir() string { return root.Dir() }

func handleList(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	entries, err := root.List(rel)
	if err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, map[string]any{"path": rel, "entries": entries})
}

package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path"

	"kfm/internal/fs"
	"kfm/internal/terminal"
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

// handleRoot 返回 root 绝对路径（T2：终端 cwd abs → 相对路径换算用）。
func handleRoot(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"root": root.Dir()})
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	q := r.URL.Query().Get("q")
	ctx, cancel := context.WithTimeout(r.Context(), fs.SearchTimeout)
	defer cancel()
	res, err := root.Search(ctx, rel, q)
	if err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, res)
}

type pathNameReq struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type renameReq struct {
	Path    string `json:"path"`
	OldName string `json:"oldName"`
	NewName string `json:"newName"`
}

func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return false
	}
	return true
}

// ---------- T3：运行锁定服务端兜底 ----------
//
// UI 已在终端 busy 时禁用对应标签的写操作入口；此处再做一层防御：
// 直接调用 API（或前端状态不同步）时同样拒绝，避免破坏正在运行的命令。

// joinRel 拼接相对路径（与服务端 API 的 '/ 分隔' 约定一致）。
func joinRel(dir, name string) string {
	if dir == "" {
		return name
	}
	return dir + "/" + name
}

// joinRels 返回 dir 下所有名字拼出的相对路径。
func joinRels(dir string, names []string) []string {
	out := make([]string, 0, len(names))
	for _, n := range names {
		out = append(out, joinRel(dir, n))
	}
	return out
}

// busyLocked 报告 rels 中是否有任一目标路径落在某个 busy 终端的工作目录内。
// 无法解析的路径跳过（交由后续操作自身报错）。
func busyLocked(rels ...string) bool {
	for _, rel := range rels {
		abs, err := root.Resolve(rel)
		if err != nil {
			continue
		}
		if terminal.IsBusyPath(abs) {
			return true
		}
	}
	return false
}

// rejectIfBusy 命中 busy 终端目录时写错误响应并返回 true。
func rejectIfBusy(w http.ResponseWriter, rels ...string) bool {
	if busyLocked(rels...) {
		writeErr(w, http.StatusConflict, "该目录正在终端中运行命令")
		return true
	}
	return false
}

func handleMkdir(w http.ResponseWriter, r *http.Request) {
	var req pathNameReq
	if !decodeBody(w, r, &req) {
		return
	}
	if rejectIfBusy(w, req.Path) {
		return
	}
	if err := root.Mkdir(req.Path, req.Name); err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func handleCreate(w http.ResponseWriter, r *http.Request) {
	var req pathNameReq
	if !decodeBody(w, r, &req) {
		return
	}
	if rejectIfBusy(w, req.Path) {
		return
	}
	if err := root.Create(req.Path, req.Name); err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func handleRename(w http.ResponseWriter, r *http.Request) {
	var req renameReq
	if !decodeBody(w, r, &req) {
		return
	}
	if rejectIfBusy(w, req.Path) {
		return
	}
	if err := root.Rename(req.Path, req.OldName, req.NewName); err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

// clipReq copy/move 请求体：{srcPath, names[], destPath}
type clipReq struct {
	SrcPath  string   `json:"srcPath"`
	Names    []string `json:"names"`
	DestPath string   `json:"destPath"`
}

func handleCopy(w http.ResponseWriter, r *http.Request) {
	var req clipReq
	if !decodeBody(w, r, &req) {
		return
	}
	// 复制会写入目标位置；源只读，不锁
	if rejectIfBusy(w, joinRels(req.DestPath, req.Names)...) {
		return
	}
	report, err := root.CopyItems(req.SrcPath, req.Names, req.DestPath)
	if err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, report)
}

func handleMove(w http.ResponseWriter, r *http.Request) {
	var req clipReq
	if !decodeBody(w, r, &req) {
		return
	}
	// 移动会删除源条目：源与目标任一落在 busy 目录内都拒绝
	locked := joinRels(req.DestPath, req.Names)
	locked = append(locked, joinRels(req.SrcPath, req.Names)...)
	if rejectIfBusy(w, locked...) {
		return
	}
	report, err := root.MoveItems(req.SrcPath, req.Names, req.DestPath)
	if err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, report)
}

// deleteReq 删除请求体：{path, names[], mode}
type deleteReq struct {
	Path  string   `json:"path"`
	Names []string `json:"names"`
	Mode  string   `json:"mode"` // "trash" | "permanent"
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
	var req deleteReq
	if !decodeBody(w, r, &req) {
		return
	}
	permanent := req.Mode == "permanent"
	if req.Mode != "trash" && !permanent {
		writeErr(w, http.StatusBadRequest, "mode 必须为 trash 或 permanent")
		return
	}
	if rejectIfBusy(w, req.Path) {
		return
	}
	report, err := root.DeleteItems(req.Path, req.Names, permanent)
	if err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, report)
}

func handleTrashList(w http.ResponseWriter, r *http.Request) {
	items, err := root.ListTrash()
	if err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, map[string]any{"items": items})
}

// trashRestoreReq 恢复请求体：{ids[]}
type trashRestoreReq struct {
	IDs []string `json:"ids"`
}

func handleTrashRestore(w http.ResponseWriter, r *http.Request) {
	var req trashRestoreReq
	if !decodeBody(w, r, &req) {
		return
	}
	report, err := root.RestoreTrash(req.IDs)
	if err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, report)
}

// trashPurgeReq 彻底删除请求体：{ids[]} 或 {all:true}
type trashPurgeReq struct {
	IDs []string `json:"ids"`
	All bool     `json:"all"`
}

func handleTrashPurge(w http.ResponseWriter, r *http.Request) {
	var req trashPurgeReq
	if !decodeBody(w, r, &req) {
		return
	}
	report, err := root.PurgeTrash(req.IDs, req.All)
	if err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, report)
}

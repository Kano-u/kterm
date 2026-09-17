package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path"
	"syscall"

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
	var pe *os.PathError
	switch {
	case errors.Is(err, fs.ErrEditConflict):
		writeErr(w, http.StatusConflict, fs.ErrEditConflict.Error())
	case errors.Is(err, fs.ErrNotDir):
		writeErr(w, http.StatusBadRequest, "目标不是目录")
	case errors.As(err, &pe) && errors.Is(pe.Err, os.ErrNotExist):
		writeErr(w, http.StatusNotFound, "路径不存在: "+path.Base(pe.Path))
	case errors.Is(err, os.ErrNotExist):
		writeErr(w, http.StatusNotFound, "路径不存在")
	default:
		// 磁盘满等系统级 IO 错误按 5xx 返回，便于排查
		var se *os.SyscallError
		if errors.As(err, &se) && (errors.Is(se.Err, syscall.ENOSPC) || errors.Is(se.Err, syscall.EIO)) {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
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

// Root 返回起始目录的 fs.Root，供 main 读取用户设置（启动命令）使用。
func Root() *fs.Root { return root }

func handleList(w http.ResponseWriter, r *http.Request) {
	rel := fs.DisplayPath(r.URL.Query().Get("path"))
	entries, err := root.List(rel)
	if err != nil {
		errToHTTP(w, err)
		return
	}
	// abs 是当前目录的绝对路径（/ 分隔），供前端拼面包屑；不确定时为空。
	abs := ""
	if full, err := root.Resolve(rel); err == nil {
		abs = fs.DisplayPath(full)
	}
	writeJSON(w, map[string]any{"path": rel, "abs": abs, "entries": entries})
}

// handleRoot 返回起始目录（程序启动时的 cwd）绝对路径。
// 注意：它现在只是「空路径 / 相对路径的解析基准」，不是可访问范围的边界。
func handleRoot(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"root": root.Dir()})
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	rel := fs.DisplayPath(r.URL.Query().Get("path"))
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
	// 兜底限制请求体大小：写接口内容上限 2 MB，其余端点远小于此
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
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

// ---------- E1：编辑器读写端点 ----------
//
// 无任何服务端会话状态：GET 读文本、POST 覆盖写。
// 编辑状态（dirty、撤销栈、高亮）完全在前端。

func handleRead(w http.ResponseWriter, r *http.Request) {
	rel := fs.DisplayPath(r.URL.Query().Get("path"))
	fc, err := root.ReadFile(rel)
	if err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, fc)
}

// writeReq 保存请求体：path / content / mtime（打开时读到的 mtime，用于冲突检测）。
type writeReq struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	MTime   int64  `json:"mtime"`
}

func handleWrite(w http.ResponseWriter, r *http.Request) {
	var req writeReq
	if !decodeBody(w, r, &req) {
		return
	}
	// T3：终端 busy 时拒绝写入（与 copy/move 同一机制）
	if rejectIfBusy(w, req.Path) {
		return
	}
	mtime, err := root.WriteFile(req.Path, req.Content, req.MTime)
	if err != nil {
		errToHTTP(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "mtime": mtime})
}

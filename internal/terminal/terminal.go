// Package terminal 提供每个文件标签页独立 PTY 终端的支持：
// WebSocket 端点、会话管理、shell 探测与 OSC 序列旁路解析。
package terminal

import (
	"kfm/internal/fs"
)

// Init 注入路径解析依赖（fs.Root），在 server.New 调用。
func Init(r *fs.Root) {
	DefaultManager.SetResolver(r.Resolve)
}

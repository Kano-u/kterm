// Package terminal 提供每个文件标签页独立 PTY 终端的支持：
// WebSocket 端点、会话管理、shell 探测与 OSC 序列旁路解析。
//
// 当前为 T0 骨架：依赖已引入、包已建立、WS echo 自测可用。
// PTY 会话（manager/session/shell 的完整实现）在 T1 落地。
package terminal

import (
	// T0 引入跨平台 PTY 依赖；T1 启动 shell 时实际使用，先固定在 go.mod。
	_ "github.com/aymanbagabas/go-pty"
)

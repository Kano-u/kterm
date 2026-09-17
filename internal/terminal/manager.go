package terminal

import (
	"sync"
)

// manager 维护所有活跃终端会话：map[tabID]*Session，互斥锁保护。
// 一个文件标签页（tabID）最多对应一个终端会话。
//
// T0 骨架：字段与 API 形状先定，完整实现在 T1（会话创建/查询/关闭/断连清理）。
type manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

func newManager() *manager {
	return &manager{sessions: make(map[string]*Session)}
}

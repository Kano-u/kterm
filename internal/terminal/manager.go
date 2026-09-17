package terminal

import (
	"os"
	"path/filepath"
	"sync"
)

// Manager 维护所有活跃终端会话：map[tabID]*Session，互斥锁保护。
// 一个文件标签页（tabID）最多对应一个终端会话。
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
	resolve  func(rel string) (string, error) // fs.Root.Resolve 注入
}

// NewManager 创建会话注册表；resolve 用于把 WS 的 path 参数（相对起始目录或绝对路径）
// 解析为初始工作目录绝对路径，可传 nil（回退为相对当前进程 cwd）。
func NewManager(resolve func(rel string) (string, error)) *Manager {
	return &Manager{sessions: make(map[string]*Session), resolve: resolve}
}

// DefaultManager 是全局终端会话注册表，由 server 包注入 resolver。
var DefaultManager = NewManager(nil)

// SetResolver 注入路径解析函数（fs.Root.Resolve）。
func (m *Manager) SetResolver(resolve func(rel string) (string, error)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resolve = resolve
}

// Resolve 把 path 参数（相对起始目录或绝对路径）解析为绝对路径
// （初始工作目录 / 文件页导航注入 cd 共用）。未注入 resolver 时直接按绝对路径处理。
func (m *Manager) Resolve(rel string) (string, error) {
	m.mu.Lock()
	resolve := m.resolve
	m.mu.Unlock()
	if resolve != nil {
		return resolve(rel)
	}
	if rel == "" {
		return os.Getwd()
	}
	return filepath.Abs(filepath.FromSlash(rel))
}

// Get 返回 tabID 对应的会话，无则返回 nil。
func (m *Manager) Get(tabID string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[tabID]
}

// Register 注册新会话。若该 tabID 已有会话则不注册并返回已存在的会话，
// 调用方据此拒绝重复连接（多浏览器窗口占用同一标签）。
func (m *Manager) Register(s *Session) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	if old, ok := m.sessions[s.tabID]; ok {
		return old
	}
	m.sessions[s.tabID] = s
	return nil
}

// Remove 移除会话；仅当注册表里仍是该会话时才删，避免误删同 tabID 的新会话。
func (m *Manager) Remove(s *Session) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if cur, ok := m.sessions[s.tabID]; ok && cur == s {
		delete(m.sessions, s.tabID)
	}
}

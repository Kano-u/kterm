package terminal

import (
	"path/filepath"
	"strings"
)

// 运行锁定（T3）：处于 busy（有命令在执行）的终端会话，其工作目录对文件写操作上锁。
// 前端按标签禁用操作入口为主，本文件提供 service 端兜底：
// server.handlers 的写操作在真正落盘前调用 IsBusyPath 校验目标路径。

// BusyPaths 返回所有 busy 会话的工作目录（绝对路径，符号链接已尽力解析）。
func (m *Manager) BusyPaths() []string {
	// 先在 manager 锁内取出会话快照，再逐个读会话状态，避免锁嵌套。
	m.mu.Lock()
	sessions := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	m.mu.Unlock()

	out := make([]string, 0, len(sessions))
	for _, s := range sessions {
		s.mu.Lock()
		busy, cwd := s.busy, s.cwd
		s.mu.Unlock()
		if !busy || cwd == "" {
			continue
		}
		cwd = filepath.Clean(cwd)
		if real, err := filepath.EvalSymlinks(cwd); err == nil {
			cwd = real // 目录已被删除时保持原值
		}
		out = append(out, cwd)
	}
	return out
}

// BusyPaths 是 DefaultManager.BusyPaths 的便捷入口。
func BusyPaths() []string { return DefaultManager.BusyPaths() }

// IsBusyPath 报告 abs 是否落在某个 busy 会话的工作目录之内（含该目录本身）。
func (m *Manager) IsBusyPath(abs string) bool {
	if abs == "" {
		return false
	}
	p := filepath.Clean(abs)
	if real, err := filepath.EvalSymlinks(p); err == nil {
		p = real
	}
	for _, cwd := range m.BusyPaths() {
		if withinPath(cwd, p) {
			return true
		}
	}
	return false
}

// IsBusyPath 是 DefaultManager.IsBusyPath 的便捷入口（server 层使用）。
func IsBusyPath(abs string) bool { return DefaultManager.IsBusyPath(abs) }

// withinPath 判断 p 是否等于 dir 或位于 dir 之内（Windows 下大小写不敏感，
// 由 filepath.Rel 的平台实现保证）。
func withinPath(dir, p string) bool {
	rel, err := filepath.Rel(dir, p)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

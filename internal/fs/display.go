package fs

import (
	"path/filepath"
)

// DisplayPath 把 API 传入的 path 规范化为展示用路径（分隔符一律 `/`）：
//
//   - ""（空）→ ""（表示起始目录）
//   - 绝对路径 → 绝对路径（Windows: `C:/Users/x`）
//   - 相对路径 → 原样（允许 `..`）
//
// 展示用路径是前端唯一认识的路径形态；与 OS 原生路径的互转只在 fs 层发生。
func DisplayPath(p string) string {
	if p == "" {
		return ""
	}
	return filepath.ToSlash(filepath.FromSlash(p))
}

// StorePath 把展示用路径转为适合持久化进回收站 meta 的形态。
// 绝对路径保留绝对形态（跨会话恢复仍指向同一位置），相对路径保持相对。
func StorePath(p string) string { return DisplayPath(p) }

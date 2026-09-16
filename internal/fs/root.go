// Package fs 提供文件系统访问能力，所有操作均限定在启动时固化的 root 目录内。
package fs

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Root 固化的根目录（绝对路径、符号链接已解析）。
type Root struct {
	dir string
}

// NewRoot 以 cwd 为基准创建 Root，符号链接解析后固化。
func NewRoot() (*Root, error) {
	wd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("获取工作目录失败: %w", err)
	}
	real, err := filepath.EvalSymlinks(wd)
	if err != nil {
		return nil, fmt.Errorf("解析工作目录失败: %w", err)
	}
	return &Root{dir: real}, nil
}

// Dir 返回根目录绝对路径。
func (r *Root) Dir() string { return r.dir }

// cleanRel 对相对路径做 lexical 清洗：拒绝绝对路径与 ..。
func cleanRel(rel string) (string, error) {
	if rel == "" {
		return "", nil
	}
	if filepath.IsAbs(rel) || strings.HasPrefix(rel, `/`) || (len(rel) > 1 && rel[1] == ':') {
		return "", fmt.Errorf("不支持绝对路径: %s", rel)
	}
	parts := strings.FieldsFunc(rel, func(r rune) bool { return r == '/' || r == '\\' })
	var out []string
	for _, p := range parts {
		switch p {
		case "..":
			return "", fmt.Errorf("路径不允许包含 ..")
		case ".", "":
			// 忽略
		default:
			out = append(out, p)
		}
	}
	return filepath.Join(out...), nil
}

// Resolve 将 rel（相对 root）解析为 root 内的绝对路径。
// 目标不存在时对其存在的最近父目录做符号链接与越界校验。
func (r *Root) Resolve(rel string) (string, error) {
	clean, err := cleanRel(rel)
	if err != nil {
		return "", err
	}
	full := filepath.Join(r.dir, clean)

	// 优先整体解析（目标存在的情况）
	if real, err := filepath.EvalSymlinks(full); err == nil {
		if !within(r.dir, real) {
			return "", fmt.Errorf("路径越界: %s", rel)
		}
		return real, nil
	}

	// 目标不存在：向上找最近存在的祖先并校验，再拼回剩余部分
	existing := full
	rest := ""
	for {
		if real, err := filepath.EvalSymlinks(existing); err == nil {
			if !within(r.dir, real) {
				return "", fmt.Errorf("路径越界: %s", rel)
			}
			if rest != "" {
				return filepath.Join(real, rest), nil
			}
			return real, nil
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			return "", fmt.Errorf("路径解析失败: %s", rel)
		}
		rest = filepath.Join(filepath.Base(existing), rest)
		existing = parent
	}
}

// within 判断 p 是否等于 root 或位于 root 之内。
func within(root, p string) bool {
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	return rel == "." || (!strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel))
}

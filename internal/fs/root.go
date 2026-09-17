// Package fs 提供文件系统访问能力。
//
// 路径参数不设边界：既可以是绝对路径，也可以是相对「起始目录」的相对路径。
// 「起始目录」是程序启动时的 cwd，仅作为空路径/相对路径的解析基准，
// 以及回收站、设置文件的存放位置；它不再是可访问范围的边界。
package fs

import (
	"fmt"
	"os"
	"path/filepath"
)

// Root 只有一个锚点「起始目录」：空路径与相对路径都以它为基准解析。
type Root struct {
	dir string
}

// NewRoot 以 cwd 为基准创建 Root。
func NewRoot() (*Root, error) {
	wd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("获取工作目录失败: %w", err)
	}
	return NewRootAt(wd)
}

// NewRootAt 以 dir 为基准创建 Root（dir 必须存在）。
// 除 NewRoot 外，测试与嵌入式场景也用它获得一个不依赖进程 cwd 的起始目录。
func NewRootAt(dir string) (*Root, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("解析工作目录失败: %w", err)
	}
	return &Root{dir: filepath.Clean(abs)}, nil
}

// Dir 返回起始目录绝对路径。
func (r *Root) Dir() string { return r.dir }

// Resolve 把 API 传入的 path 解析为文件系统绝对路径：
//
//   - ""（空）  → 起始目录
//   - 绝对路径  → 清洗后原样返回
//   - 相对路径  → 相对起始目录解析（允许 ..，不设越界限制）
//
// 与旧实现不同，这里不再解析符号链接、也不再校验是否位于起始目录内：
// 访问范围就是整台机器，路径安全交由操作系统的权限模型负责。
// 返回值使用 OS 原生分隔符（Windows 为 `\`），API 层输出时统一转 `/`。
func (r *Root) Resolve(rel string) (string, error) {
	if rel == "" {
		return r.dir, nil
	}
	p := filepath.FromSlash(rel)
	if !filepath.IsAbs(p) {
		p = filepath.Join(r.dir, p)
	}
	return filepath.Clean(p), nil
}

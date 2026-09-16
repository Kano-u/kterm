package fs

import (
	"os"
	"path/filepath"
	"sort"
)

// Entry 目录条目。
type Entry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
	MTime int64  `json:"mtime"` // unix 毫秒
}

// TrashDirName 回收站目录名，列表中永远排除。
const TrashDirName = ".kfm-trash"

// List 读取 dir（相对 root）下的条目。排除 .kfm-trash，不排序不过滤隐藏文件。
func (r *Root) List(rel string) ([]Entry, error) {
	full, err := r.Resolve(rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, ErrNotDir
	}
	dirents, err := os.ReadDir(full)
	if err != nil {
		return nil, err
	}
	entries := make([]Entry, 0, len(dirents))
	for _, d := range dirents {
		name := d.Name()
		if name == TrashDirName {
			continue
		}
		e := Entry{Name: name, IsDir: d.IsDir()}
		if fi, err := d.Info(); err == nil {
			e.Size = fi.Size()
			e.MTime = fi.ModTime().UnixMilli()
		}
		entries = append(entries, e)
	}
	// 稳定输出：按名称排序（前端再做自定义排序）
	sort.Slice(entries, func(i, j int) bool { return filepath.Base(entries[i].Name) < filepath.Base(entries[j].Name) })
	return entries, nil
}

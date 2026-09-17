package fs

import (
	"os"
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

// List 读取 dir（展示路径：相对 / 绝对）下的条目。排除内部条目（回收站、设置文件），
// 不排序不过滤隐藏文件。
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
		if reservedName(name) {
			continue
		}
		e := Entry{Name: name, IsDir: d.IsDir()}
		if fi, err := d.Info(); err == nil {
			e.Size = fi.Size()
			e.MTime = fi.ModTime().UnixMilli()
		}
		entries = append(entries, e)
	}
	// 不排序：前端必然按自己的 collator 重排（目录优先/拼音/自然序），
	// 服务端排序结果会被完全丢弃。
	return entries, nil
}

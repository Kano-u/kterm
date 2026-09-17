package fs

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// SearchLimit 单次搜索返回的最大条数。
const SearchLimit = 500

// SearchTimeout 搜索超时时间。
const SearchTimeout = 8 * time.Second

// SearchHit 搜索结果条目。
type SearchHit struct {
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
	MTime int64  `json:"mtime"` // unix 毫秒
	Dir   string `json:"dir"`   // 相对搜索起点的父目录（'' = 起点，分隔符一律为 /）
}

// SearchResult 搜索结果。
type SearchResult struct {
	Query     string      `json:"query"`
	Path      string      `json:"path"`
	Hits      []SearchHit `json:"hits"`
	Truncated bool        `json:"truncated"` // 达到上限或超时被截断
}

// Search 从 rel 目录递归搜索文件名包含 q（unicode 大小写不敏感）的条目。
// 排除回收站；上限 SearchLimit 条；ctx 控制超时/取消，超时时返回已有结果并标记 truncated。
func (r *Root) Search(ctx context.Context, rel, q string) (*SearchResult, error) {
	full, err := r.Resolve(rel)
	if err != nil {
		return nil, err
	}
	res := &SearchResult{Query: q, Path: rel, Hits: []SearchHit{}}
	if strings.TrimSpace(q) == "" {
		return res, nil
	}
	needle := strings.ToLower(q)

	err = filepath.WalkDir(full, func(p string, d os.DirEntry, werr error) error {
		if werr != nil {
			if p == full {
				return werr // 起点不可读直接报错
			}
			return nil // 跳过无权限/已消失的子目录
		}
		// 超时或取消：停止遍历，返回已有结果
		if ctx.Err() != nil {
			res.Truncated = true
			return filepath.SkipAll
		}
		name := d.Name()
		if d.IsDir() && reservedName(name) {
			return filepath.SkipDir // 回收站 / 内部目录不参与搜索
		}
		if !d.IsDir() && reservedName(name) {
			return nil // 设置文件等内部文件不作为搜索结果
		}
		if p == full {
			return nil // 起点目录本身不参与匹配，但要递归进入
		}
		if strings.Contains(strings.ToLower(name), needle) {
			dirRel, rerr := filepath.Rel(full, filepath.Dir(p))
			if rerr != nil || dirRel == "." {
				dirRel = ""
			}
			hit := SearchHit{Name: name, IsDir: d.IsDir(), Dir: filepath.ToSlash(dirRel)}
			if fi, ierr := d.Info(); ierr == nil {
				hit.Size = fi.Size()
				hit.MTime = fi.ModTime().UnixMilli()
			}
			res.Hits = append(res.Hits, hit)
			if len(res.Hits) >= SearchLimit {
				res.Truncated = true
				return filepath.SkipAll
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return res, nil
}

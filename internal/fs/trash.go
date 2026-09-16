package fs

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// TrashMeta 回收站批次元数据（批次目录内 meta.json）。
type TrashMeta struct {
	Path  string   `json:"path"`  // 原所在目录（相对 root）
	Time  int64    `json:"time"`  // 删除时间 unix 毫秒
	Names []string `json:"names"` // 批次内的条目名
}

// TrashItem 回收站中的一个批次（供前端展示）。
type TrashItem struct {
	ID    string   `json:"id"`
	Path  string   `json:"path"`
	Time  int64    `json:"time"`
	Names []string `json:"names"`
}

func (r *Root) trashDir() string { return filepath.Join(r.dir, TrashDirName) }

// guardNotTrash 禁止对回收站目录本身或其内部内容做删除操作。
func (r *Root) guardNotTrash(full string) error {
	rel, err := filepath.Rel(r.dir, full)
	if err != nil {
		return nil
	}
	if rel == "." {
		return nil
	}
	if rel == TrashDirName || strings.HasPrefix(rel, TrashDirName+string(filepath.Separator)) {
		return fmt.Errorf("不能操作回收站内部内容")
	}
	return nil
}

// ensureDir 在 root 内确保目录存在（原目录被删也能恢复时用）。
func (r *Root) ensureDir(rel string) (string, error) {
	clean, err := cleanRel(rel)
	if err != nil {
		return "", err
	}
	full := filepath.Join(r.dir, clean)
	if err := os.MkdirAll(full, 0o755); err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(full)
	if err != nil {
		return "", err
	}
	if !within(r.dir, real) {
		return "", fmt.Errorf("路径越界: %s", rel)
	}
	return real, nil
}

// moveOrFallback rename 移动；跨设备（EXDEV）降级为 copy + delete。
func moveOrFallback(src, dst string) error {
	if err := os.Rename(src, dst); err != nil {
		if !errors.Is(err, syscall.EXDEV) {
			return err
		}
		if cerr := copyTree(src, dst); cerr != nil {
			os.RemoveAll(dst)
			return fmt.Errorf("跨设备移动失败: %w", cerr)
		}
		if rerr := os.RemoveAll(src); rerr != nil {
			os.RemoveAll(dst)
			return fmt.Errorf("跨设备移动失败: %w", rerr)
		}
	}
	return nil
}

// DeleteItems 删除 rel 下名为 names 的条目。
// permanent=false 移入回收站批次目录；permanent=true 直接 RemoveAll。
// 逐项执行并汇总结果。
func (r *Root) DeleteItems(rel string, names []string, permanent bool) (*ClipReport, error) {
	if len(names) == 0 {
		return nil, fmt.Errorf("未选择任何条目")
	}
	full, err := r.Resolve(rel)
	if err != nil {
		return nil, err
	}
	if err := r.guardNotTrash(full); err != nil {
		return nil, err
	}
	report := &ClipReport{Total: len(names), Results: make([]ItemResult, 0, len(names))}

	if permanent {
		for _, name := range names {
			res := ItemResult{Name: name}
			if err := ValidateName(name); err != nil {
				res.Error = err.Error()
			} else if err := os.RemoveAll(filepath.Join(full, name)); err != nil {
				res.Error = err.Error()
			}
			if res.Error == "" {
				res.OK = true
				report.Success++
			} else {
				report.Failed++
			}
			report.Results = append(report.Results, res)
		}
		return report, nil
	}

	// 移入回收站：批次目录 <root>/.kfm-trash/<unixnano-hex>/
	batchID := strconv.FormatInt(time.Now().UnixNano(), 16)
	batch := filepath.Join(r.trashDir(), batchID)
	if err := os.MkdirAll(batch, 0o755); err != nil {
		return nil, err
	}
	var moved []string
	for _, name := range names {
		res := ItemResult{Name: name}
		switch err := validateAndMove(full, name, batch); {
		case err == nil:
			res.OK = true
			res.Dest = name
			moved = append(moved, name)
			report.Success++
		default:
			res.Error = err.Error()
			report.Failed++
		}
		report.Results = append(report.Results, res)
	}
	if len(moved) == 0 {
		// 一项都没移入，清理空批次目录
		os.Remove(batch)
		return report, nil
	}
	cleanRelPath, err := cleanRel(rel)
	if err != nil {
		cleanRelPath = rel
	}
	meta := TrashMeta{Path: cleanRelPath, Time: time.Now().UnixMilli(), Names: moved}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return report, nil
	}
	_ = os.WriteFile(filepath.Join(batch, "meta.json"), data, 0o644)
	return report, nil
}

// validateAndMove 校验名称并把条目移入批次目录。
func validateAndMove(srcDir, name, batchDir string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	src := filepath.Join(srcDir, name)
	if _, err := os.Lstat(src); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("文件不存在: %s", name)
		}
		return err
	}
	return moveOrFallback(src, filepath.Join(batchDir, name))
}

// ListTrash 遍历回收站一层批次目录，读取 meta.json 汇总。
func (r *Root) ListTrash() ([]TrashItem, error) {
	dirents, err := os.ReadDir(r.trashDir())
	if err != nil {
		if os.IsNotExist(err) {
			return []TrashItem{}, nil
		}
		return nil, err
	}
	items := make([]TrashItem, 0, len(dirents))
	for _, d := range dirents {
		if !d.IsDir() {
			continue
		}
		meta, err := readTrashMeta(filepath.Join(r.trashDir(), d.Name()))
		if err != nil {
			continue // meta 缺失/损坏的批次跳过
		}
		items = append(items, TrashItem{ID: d.Name(), Path: meta.Path, Time: meta.Time, Names: meta.Names})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Time > items[j].Time }) // 新的在前
	return items, nil
}

func readTrashMeta(batch string) (*TrashMeta, error) {
	data, err := os.ReadFile(filepath.Join(batch, "meta.json"))
	if err != nil {
		return nil, err
	}
	var meta TrashMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, err
	}
	return &meta, nil
}

// validBatchID 批次目录名仅允许非空十六进制串（unixnano-hex），防路径拼接注入。
func validBatchID(id string) bool {
	if id == "" || len(id) > 32 {
		return false
	}
	for _, c := range id {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return false
		}
	}
	return true
}

// RestoreTrash 按 ids 恢复回收站批次：原目录不存在则重建，逐项 rename 回去（冲突自动改名）。
func (r *Root) RestoreTrash(ids []string) (*ClipReport, error) {
	if len(ids) == 0 {
		return nil, fmt.Errorf("未选择任何回收站条目")
	}
	report := &ClipReport{Total: len(ids), Results: make([]ItemResult, 0, len(ids))}
	for _, id := range ids {
		res := ItemResult{Name: id}
		if err := r.restoreBatch(id); err != nil {
			res.Error = err.Error()
			report.Failed++
		} else {
			res.OK = true
			report.Success++
		}
		report.Results = append(report.Results, res)
	}
	return report, nil
}

// restoreBatch 恢复单个批次。部分恢复时更新 meta.json 只保留剩余条目。
func (r *Root) restoreBatch(id string) error {
	if !validBatchID(id) {
		return fmt.Errorf("非法的回收站条目: %s", id)
	}
	batch := filepath.Join(r.trashDir(), id)
	meta, err := readTrashMeta(batch)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("回收站条目不存在")
		}
		return fmt.Errorf("读取回收站信息失败: %w", err)
	}
	destFull, err := r.ensureDir(meta.Path) // 原目录不存在则重建
	if err != nil {
		return err
	}

	remaining := make([]string, 0, len(meta.Names))
	var lastErr error
	for _, name := range meta.Names {
		src := filepath.Join(batch, name)
		if _, err := os.Lstat(src); err != nil {
			continue // 已不存在的条目（如上次部分恢复残留），跳过
		}
		final, err := conflictName(destFull, name)
		if err != nil {
			remaining = append(remaining, name)
			lastErr = err
			continue
		}
		if err := moveOrFallback(src, filepath.Join(destFull, final)); err != nil {
			remaining = append(remaining, name)
			lastErr = err
			continue
		}
	}

	dirents, _ := os.ReadDir(batch)
	left := 0
	for _, d := range dirents {
		if d.Name() != "meta.json" {
			left++
		}
	}
	if left == 0 {
		os.RemoveAll(batch)
	} else {
		meta.Names = remaining
		if data, err := json.MarshalIndent(meta, "", "  "); err == nil {
			_ = os.WriteFile(filepath.Join(batch, "meta.json"), data, 0o644)
		}
	}
	return lastErr
}

// PurgeTrash 彻底删除回收站条目：all=true 清空全部；否则按 ids 删除批次。
func (r *Root) PurgeTrash(ids []string, all bool) (*ClipReport, error) {
	if all {
		if err := os.RemoveAll(r.trashDir()); err != nil {
			return nil, err
		}
		return &ClipReport{Results: []ItemResult{}}, nil
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("未选择任何回收站条目")
	}
	report := &ClipReport{Total: len(ids), Results: make([]ItemResult, 0, len(ids))}
	for _, id := range ids {
		res := ItemResult{Name: id}
		if !validBatchID(id) {
			res.Error = fmt.Sprintf("非法的回收站条目: %s", id)
		} else if err := os.RemoveAll(filepath.Join(r.trashDir(), id)); err != nil {
			res.Error = err.Error()
		}
		if res.Error == "" {
			res.OK = true
			report.Success++
		} else {
			report.Failed++
		}
		report.Results = append(report.Results, res)
	}
	return report, nil
}

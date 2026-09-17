package fs

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// ItemResult 单个条目的复制/移动结果。
type ItemResult struct {
	Name  string `json:"name"`
	Dest  string `json:"dest,omitempty"` // 实际落地的名字（冲突自动改名后）
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// ClipReport 逐项执行后的汇总结果。
type ClipReport struct {
	Total   int          `json:"total"`
	Success int          `json:"success"`
	Failed  int          `json:"failed"`
	Results []ItemResult `json:"results"`
}

// conflictName 在 dir 下为 name 生成不冲突的名字：存在重名时按 "名字 (2).ext" 递增。
func conflictName(dir, name string) (string, error) {
	if _, err := os.Lstat(filepath.Join(dir, name)); err != nil {
		if os.IsNotExist(err) {
			return name, nil
		}
		return "", err
	}
	base, ext := name, ""
	if i := strings.LastIndex(name, "."); i > 0 { // 隐藏文件 ".xx" 不拆扩展名
		base, ext = name[:i], name[i:]
	}
	for n := 2; n < 10000; n++ {
		cand := fmt.Sprintf("%s (%d)%s", base, n, ext)
		if _, err := os.Lstat(filepath.Join(dir, cand)); err != nil {
			if os.IsNotExist(err) {
				return cand, nil
			}
			return "", err
		}
	}
	return "", fmt.Errorf("无法为 %s 生成可用名称", name)
}

// copyFile 复制单个文件（保留 mode 与 mtime）。
func copyFile(src, dst string, info os.FileInfo) error {
	srcF, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcF.Close()
	dstF, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(dstF, srcF); err != nil {
		dstF.Close()
		os.Remove(dst)
		return err
	}
	if err := dstF.Close(); err != nil {
		os.Remove(dst)
		return err
	}
	// 保留原文件 mtime，避免按修改时间排序时复制件涌到顶部
	if err := os.Chtimes(dst, info.ModTime(), info.ModTime()); err != nil {
		// 不因时间戳失败而报错（文件内容已完整复制）
		_ = err
	}
	return nil
}

// copyTree 复制文件/目录/符号链接到 dst（dst 必须不存在）。
// 目录使用 os.CopyFS。
func copyTree(src, dst string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		link, err := os.Readlink(src)
		if err != nil {
			return err
		}
		return os.Symlink(link, dst)
	}
	if info.IsDir() {
		return os.CopyFS(dst, os.DirFS(src))
	}
	return copyFile(src, dst, info)
}

// CopyItems 将 src（相对 root）下的 names 复制到 dest，重名自动改名，逐项执行并汇总结果。
func (r *Root) CopyItems(src string, names []string, dest string) (*ClipReport, error) {
	return r.clipItems(src, names, dest, false)
}

// MoveItems 将 src（相对 root）下的 names 移动到 dest；跨设备时降级为 copy+delete。
func (r *Root) MoveItems(src string, names []string, dest string) (*ClipReport, error) {
	return r.clipItems(src, names, dest, true)
}

func (r *Root) clipItems(src string, names []string, dest string, isMove bool) (*ClipReport, error) {
	if len(names) == 0 {
		return nil, fmt.Errorf("未选择任何条目")
	}
	srcFull, err := r.Resolve(src)
	if err != nil {
		return nil, err
	}
	destFull, err := r.Resolve(dest)
	if err != nil {
		return nil, err
	}
	destInfo, err := os.Stat(destFull)
	if err != nil {
		return nil, err
	}
	if !destInfo.IsDir() {
		return nil, ErrNotDir
	}

	report := &ClipReport{Total: len(names), Results: make([]ItemResult, 0, len(names))}
	for _, name := range names {
		res := ItemResult{Name: name}
		if err := ValidateName(name); err != nil {
			res.Error = err.Error()
		} else {
			final, err := clipOne(srcFull, name, destFull, isMove)
			if err != nil {
				res.Error = err.Error()
			} else {
				res.Dest = final
			}
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

// clipOne 执行单个条目的复制/移动。冲突自动改名；目录拒绝进入自身子树。
// 返回实际落地的名称。
func clipOne(srcFull, name, destFull string, isMove bool) (string, error) {
	itemSrc := filepath.Join(srcFull, name)
	info, err := os.Lstat(itemSrc)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("文件不存在: %s", name)
		}
		return "", err
	}
	final, err := conflictName(destFull, name)
	if err != nil {
		return "", err
	}
	itemDst := filepath.Join(destFull, final)

	// 移动到源目录本身：无意义，直接报错（复制到同目录自动改名属正常行为）
	if isMove && filepath.Clean(srcFull) == filepath.Clean(destFull) {
		return "", fmt.Errorf("已在目标目录中: %s", name)
	}

	// 源与目标完全相同（如移动到自身所在目录且无冲突名可用时）
	if filepath.Clean(itemSrc) == filepath.Clean(itemDst) {
		return "", fmt.Errorf("源与目标相同: %s", name)
	}

	// 包含性检查：目录不能复制/移动进自身（含子目录），否则无限递归
	if info.IsDir() {
		if rel, err := filepath.Rel(itemSrc, destFull); err == nil &&
			(rel == "." || (!strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel))) {
			return "", fmt.Errorf("不能把文件夹放到其自身内部: %s", name)
		}
	}

	if isMove {
		if err := os.Rename(itemSrc, itemDst); err != nil {
			if !errors.Is(err, syscall.EXDEV) {
				return "", err
			}
			// 跨设备：copy + delete
			if cerr := copyTree(itemSrc, itemDst); cerr != nil {
				os.RemoveAll(itemDst)
				return "", fmt.Errorf("跨设备移动失败: %w", cerr)
			}
			if rerr := os.RemoveAll(itemSrc); rerr != nil {
				os.RemoveAll(itemDst)
				return "", fmt.Errorf("跨设备移动失败: %w", rerr)
			}
		}
		return final, nil
	}
	return final, copyTree(itemSrc, itemDst)
}

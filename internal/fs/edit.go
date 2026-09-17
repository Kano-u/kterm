package fs

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
)

// EditMaxSize 是单个可编辑文件的大小上限（2 MiB）。
// 超过上限的文件直接拒绝，避免把浏览器内存和编辑内核拖垮。
const EditMaxSize = 2 << 20

// editMaxSizeText 用于错误消息（与 EditMaxSize 保持一致）。
const editMaxSizeText = "2 MB"

// EditTempPrefix 是原子写入所用临时文件的名称前缀；同样位于目标文件所在目录，
// 以便 rename 是同一文件系统内的原子操作。列表 / 搜索永远排除它。
const EditTempPrefix = ".kfm-edit-"

// editProbeSize 是二进制探测的采样长度（前 8 KiB）。
const editProbeSize = 8 << 10

// FileContent 是一次文件读取的结果。
type FileContent struct {
	Content string `json:"content"`
	MTime   int64  `json:"mtime"` // unix 毫秒
	Size    int64  `json:"size"`
}

// ReadFile 读取 rel（相对 root）指向的文本文件。
//
// 拒绝：目录、超过 EditMaxSize 的文件、采样区含 NUL 字节的二进制文件。
// 换行按原样保留（LF / CRLF 均不转换），由前端决定比对与写回策略。
func (r *Root) ReadFile(rel string) (*FileContent, error) {
	full, err := r.Resolve(rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, ErrNotDir
	}
	if info.Size() > EditMaxSize {
		return nil, fmt.Errorf("文件过大（超过 %s），不支持编辑", editMaxSizeText)
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return nil, err
	}
	probe := data
	if len(probe) > editProbeSize {
		probe = probe[:editProbeSize]
	}
	if bytes.IndexByte(probe, 0) >= 0 {
		return nil, fmt.Errorf("二进制文件不支持编辑")
	}
	return &FileContent{
		Content: string(data),
		MTime:   info.ModTime().UnixMilli(),
		Size:    info.Size(),
	}, nil
}

// WriteFile 原子覆盖 rel（相对 root）指向的文本文件。
//
// modTime 是打开文件时读到的 mtime（unix 毫秒）：与磁盘现状不一致说明
// 文件在编辑期间被外部程序改写，返回 ErrEditConflict（HTTP 409）。
// 写入走「同目录临时文件 + rename」，避免写一半损坏原文件。
// 返回写入后的新 mtime（unix 毫秒），供前端继续编辑时做冲突检测。
func (r *Root) WriteFile(rel, content string, modTime int64) (int64, error) {
	if len(content) > EditMaxSize {
		return 0, fmt.Errorf("内容过大（超过 %s），无法保存", editMaxSizeText)
	}
	full, err := r.Resolve(rel)
	if err != nil {
		return 0, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return 0, err
	}
	if info.IsDir() {
		return 0, ErrNotDir
	}
	if info.ModTime().UnixMilli() != modTime {
		return 0, ErrEditConflict
	}

	dir := filepath.Dir(full)
	tmp, err := os.CreateTemp(dir, EditTempPrefix+"*")
	if err != nil {
		return 0, fmt.Errorf("保存失败: %w", err)
	}
	tmpName := tmp.Name()
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return 0, fmt.Errorf("保存失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return 0, fmt.Errorf("保存失败: %w", err)
	}
	// 保留原文件权限（临时文件默认 0600）
	if err := os.Chmod(tmpName, info.Mode().Perm()); err != nil {
		os.Remove(tmpName)
		return 0, fmt.Errorf("保存失败: %w", err)
	}
	if err := os.Rename(tmpName, full); err != nil {
		os.Remove(tmpName)
		return 0, fmt.Errorf("保存失败: %w", err)
	}

	newInfo, err := os.Stat(full)
	if err != nil {
		// 写入已成功；读不到 mtime 不该让调用方认为失败，返回 0 由前端下次重新拉取
		return 0, nil
	}
	return newInfo.ModTime().UnixMilli(), nil
}

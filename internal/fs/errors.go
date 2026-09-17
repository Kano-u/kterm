package fs

import "errors"

// ErrNotDir 目标不是目录。
var ErrNotDir = errors.New("目标不是目录")

// ErrEditConflict 文件在打开后被其他程序修改（编辑保存的 mtime 冲突）。
var ErrEditConflict = errors.New("文件已被其他程序修改")

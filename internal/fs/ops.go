package fs

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ValidateName 校验文件/目录名：拒绝空名、含 / 或 \、"." 与 ".."。
func ValidateName(name string) error {
	if name == "" {
		return fmt.Errorf("名称不能为空")
	}
	if strings.ContainsAny(name, "/\\") {
		return fmt.Errorf("名称不能包含斜杠: %s", name)
	}
	if name == "." || name == ".." {
		return fmt.Errorf("非法名称: %s", name)
	}
	return nil
}

// Mkdir 在 dir（相对 root）下新建名为 name 的目录。重名直接报错。
func (r *Root) Mkdir(dir, name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	full, err := r.Resolve(dir)
	if err != nil {
		return err
	}
	target := filepath.Join(full, name)
	if err := os.Mkdir(target, 0o755); err != nil {
		if os.IsExist(err) {
			return fmt.Errorf("已存在同名文件或文件夹: %s", name)
		}
		return err
	}
	return nil
}

// Create 在 dir（相对 root）下新建名为 name 的空文件。重名直接报错。
func (r *Root) Create(dir, name string) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	full, err := r.Resolve(dir)
	if err != nil {
		return err
	}
	target := filepath.Join(full, name)
	if _, err := os.Lstat(target); err == nil {
		return fmt.Errorf("已存在同名文件或文件夹: %s", name)
	}
	f, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return fmt.Errorf("已存在同名文件或文件夹: %s", name)
		}
		return err
	}
	return f.Close()
}

// Rename 将 dir 下 oldName 重命名为 newName。newName 重名直接报错。
func (r *Root) Rename(dir, oldName, newName string) error {
	if err := ValidateName(oldName); err != nil {
		return fmt.Errorf("原名非法: %w", err)
	}
	if err := ValidateName(newName); err != nil {
		return err
	}
	if oldName == newName {
		return fmt.Errorf("新名称与原名相同")
	}
	full, err := r.Resolve(dir)
	if err != nil {
		return err
	}
	old := filepath.Join(full, oldName)
	if _, err := os.Lstat(old); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("文件不存在: %s", oldName)
		}
		return err
	}
	new := filepath.Join(full, newName)
	if _, err := os.Lstat(new); err == nil {
		return fmt.Errorf("已存在同名文件或文件夹: %s", newName)
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.Rename(old, new)
}

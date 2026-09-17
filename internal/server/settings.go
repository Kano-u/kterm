package server

import (
	"net/http"

	"kfm/internal/fs"
)

// handleSettingsGet 返回当前设置。文件不存在或损坏时返回内置默认（附 warning）。
func handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	load := root.LoadSettings()
	resp := map[string]any{
		"settings": load.Settings,
		"fromFile": load.FromFile,
	}
	if load.Warning != "" {
		resp["warning"] = load.Warning
	}
	writeJSON(w, resp)
}

// handleSettingsPost 校验并保存设置，成功返回落盘后的设置。
func handleSettingsPost(w http.ResponseWriter, r *http.Request) {
	var s fs.Settings
	if !decodeBody(w, r, &s) {
		return
	}
	if err := root.SaveSettings(s); err != nil {
		errToHTTP(w, err)
		return
	}
	s.Normalize()
	writeJSON(w, map[string]any{"ok": true, "settings": s})
}

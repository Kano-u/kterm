package terminal

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/coder/websocket"
)

// HandleWS 处理 GET /api/term/ws（受 hostCheck 中间件保护）。
//
// 参数：tab=<tabId>&path=<rel>（相对 root 的初始工作目录）。
// 流程：同 tabID 已有会话 → 拒绝（多窗口占用）；否则启动 PTY 会话，
// WS 断开或 shell 退出时杀进程并从 manager 移除。
func HandleWS(m *Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tabID := r.URL.Query().Get("tab")
		if tabID == "" {
			http.Error(w, `{"error":"缺少 tab 参数"}`, http.StatusBadRequest)
			return
		}
		relPath := r.URL.Query().Get("path")

		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			log.Printf("[terminal] websocket accept: %v", err)
			return
		}
		conn := &realConn{c: c}

		s, exists, err := Start(m, tabID, relPath, nil)
		if err != nil {
			_ = conn.Write(websocket.MessageText, []byte(`{"t":"error","d":"终端启动失败"}`))
			_ = c.Close(websocket.StatusInternalError, "start failed")
			return
		}
		if exists {
			_ = conn.Write(websocket.MessageText, []byte(`{"t":"error","d":"该标签的终端已被其他窗口占用"}`))
			_ = c.Close(websocket.StatusPolicyViolation, "occupied")
			return
		}

		// 连接结束时清理：杀 PTY 并从注册表移除。
		defer func() {
			s.Kill()
			m.Remove(s)
			_ = c.Close(websocket.StatusNormalClosure, "")
		}()

		log.Printf("[terminal] session start tab=%s cwd=%s", tabID, s.cwd)
		s.Serve(conn)
		log.Printf("[terminal] session end tab=%s", tabID)
	}
}

// realConn 将 *websocket.Conn 适配为 Session 使用的 wsConn 接口。
type realConn struct {
	c *websocket.Conn
}

func (r *realConn) Read() (websocket.MessageType, []byte, error) {
	mt, data, err := r.c.Read(context.Background())
	if err != nil {
		return 0, nil, err
	}
	return mt, data, nil
}

func (r *realConn) Write(mt websocket.MessageType, data []byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return r.c.Write(ctx, mt, data)
}

func (r *realConn) Close() {
	_ = r.c.Close(websocket.StatusNormalClosure, "")
}

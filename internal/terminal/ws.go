package terminal

import (
	"context"
	"log"
	"net/http"

	"github.com/coder/websocket"
)

// HandleWS 处理 GET /api/term/ws（受 hostCheck 中间件保护）。
//
// T0 为 echo 自测：收到什么回什么（binary→binary，text→text），
// 验证 WebSocket 链路可用。T1 替换为真正的 PTY 会话建立。
func HandleWS(m *manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			log.Printf("[terminal] websocket accept: %v", err)
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "")

		ctx := context.Background()
		for {
			msgType, data, err := c.Read(ctx)
			if err != nil {
				return // 正常关闭或网络错误，安静退出
			}
			if err := c.Write(ctx, msgType, data); err != nil {
				return
			}
		}
	}
}

// DefaultManager 是全局终端会话注册表；T1 改为显式构造注入。
var DefaultManager = newManager()

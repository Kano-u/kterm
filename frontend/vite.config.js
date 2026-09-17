import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// 构建产物直接输出到 Go 的 embed 目录：
//   internal/server/web/index.html      ← GET / 返回
//   internal/server/web/assets/*        ← GET /assets/* 返回
// base 设为 /assets/ 后，index.html 内的资源引用均为 /assets/assets/...，
// 与 server.go 中 StripPrefix("/assets/") 的静态路由完全匹配。
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  base: '/assets/',
  build: {
    outDir: '../internal/server/web',
    emptyOutDir: true,
  },
  server: {
    // 开发模式：vite dev (5173) 代理 API 到 Go 服务 (8080)；ws:true 代理终端 WebSocket
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})

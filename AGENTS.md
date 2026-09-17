# AGENTS.md — kfm

## 项目概述

kfm 是一个本地 Web UI 文件管理器：Go 后端（标准库 `net/http`）+ Vue 3 / Tailwind CSS 前端（Vite 构建，产物 `go:embed` 内嵌），部署形态为单文件二进制。

- 服务端只做「真实文件系统操作 + 路径安全」；一切纯展示逻辑（排序、隐藏过滤、防抖、状态管理）在前端。
- 访问范围仅限程序启动时的当前工作目录（root），不可越界；终端内可自由 cd 出 root，但文件页不跟随（见终端条目）。
- 仅监听 `127.0.0.1`；Host 头校验中间件防 DNS rebinding（对终端 WebSocket 同样生效）。
- 每个文件标签页可绑定一个独立 PTY 终端（xterm.js + WebSocket）：惰性创建、双向目录同步、运行中锁定该标签。

## 目录结构

```
├── main.go                 # flag 解析、启动服务、自动开浏览器
├── internal/
│   ├── fs/                 # root 固化与路径安全、目录列表、
│   │                       # mkdir/create/rename、copy/move、回收站、搜索
│   ├── terminal/           # 终端：WS 端点（ws.go，T0 为 echo 自测）、
│   │                       # 会话注册表 manager.go、PTY 会话 session.go、
│   │                       # OSC 旁路解析 osc.go、shell 探测 shell.go
│   └── server/
       ├── server.go        # 路由、Host 校验、静态资源
       ├── handlers.go      # JSON 端点
       └── web/             # 前端构建产物（go:embed，勿手改；由 `npm run build` 生成）
└── frontend/               # Vue 3 + Tailwind + Vite 源码
    ├── vite.config.js      # outDir 指向 ../internal/server/web，dev 代理 /api
    └── src/
        ├── store.js        # 单一 reactive 状态（tabs/sort/clipboard/selection）
        ├── actions.js      # 导航/标签/操作/剪贴板动作
        ├── api.js          # fetch 封装
        ├── dialog.js / confirm.js / toast.js / loading.js
        └── components/      # Tabbar/Toolbar（含排序行）/FileList/SelectBar/PasteBar/
                            # Toast/Loading/NameDialog/EntrySheet/TrashPanel 等
                            # （T1 起新增 Taskbar/TerminalView）
```

## 构建与运行

```bash
# 重新构建前端（仅改了 frontend/ 源码时需要）
cd frontend && npm install && npm run build

# 构建并运行（在想要作为 root 的目录里执行）
go build . && ./kfm              # 默认 127.0.0.1:8080
./kfm -addr 127.0.0.1:9000 -open=false
```

## API 约定

所有 `path` 参数均为相对 root 的相对路径（`/` 分隔）。成功返回 `{"ok":true}` 或具体数据；失败返回 4xx/5xx + `{"error":"中文错误消息"}`。

端点：`GET /api/list`、`GET /api/search`、`POST /api/mkdir`、`/api/create`、`/api/rename`、`/api/copy`、`/api/move`、`/api/delete`（`mode:"trash"|"permanent"`）、`GET /api/trash`、`POST /api/trash/restore`、`/api/trash/purge`、`GET /api/term/ws`（终端 WebSocket，见下）。

### 终端 WebSocket（/api/term/ws）

- 受 hostCheck 保护；查询参数 `tab=<tabId>&path=<相对 root 初始工作目录>`。
- C→S（text JSON）：`{"t":"i","d":"<键入>"}`、`{"t":"resize","cols":N,"rows":N}`、`{"t":"cd","rel":"a/b"}`；
- S→C：binary（PTY 原始输出，经 OSC 旁路扫描但不吞字节）与 text JSON `{"t":"shell"|"cwd"|"busy"|"exit"|"error",...}`。
- 生命周期：WS 断开（含刷新）或 shell 退出即杀死 PTY 并从注册表移除；同一 tabId 二次连接被拒绝（提示「该标签的终端已被其他窗口占用」）。底部任务栏的「终端」按钮在会话已打开时显示 × 关闭入口（等价于杀 PTY 并回文件视图）；busy 时改为转圈，需先中断命令。

## 核心设计决策

- **路径安全**：`internal/fs/root.go` 的 `Resolve(rel)` 拒绝绝对路径与 `..`，拼 root 后 `EvalSymlinks` 校验仍在 root 内；目标不存在时校验其父目录。除启动时 best-effort 打开浏览器外，不 exec 任何外部命令。
- **回收站**：`<root>/.kfm-trash/<unixnano-hex>/`，内含 `meta.json`（`{path, time, names[]}`）与原条目；一次删除 = 一个批次，恢复整批 rename 回去。列表 API 永远排除 `.kfm-trash`。
- **重名冲突**：copy/move/restore 自动改名 `名称 (2).ext` 递增；mkdir/create/rename 遇重名直接报错。
- **排序/过滤在前端**：`Intl.Collator('zh-Hans-CN', {numeric:true})` 降级链 `'zh'` → 默认 locale；目录永远排前；切换无需请求。
- **导航**：每标签独立 history，`history.pushState({tabId, path})` + `popstate` 使浏览器返回手势 = 返回上级；`localStorage`（key `kfm-state`）持久化 tabs/sort/showHidden。
- **剪贴板**：前端持有 `{mode, srcPath, names[]}`，服务端无状态，粘贴时才调 copy/move。

## 编码约定

- **Go**：除 PTY（`github.com/aymanbagabas/go-pty`）与 WebSocket（`github.com/coder/websocket`）外仅标准库（`os.CopyFS` 需 Go 1.23+）。
- **前端**：终端引入 `@xterm/xterm` + `@xterm/addon-fit`，其余不新增依赖；Vue 3 `<script setup>` 组合式 API；样式用 Tailwind 原子类，无独立组件 CSS。
- 错误消息、UI 文案全部中文。
- 不做：文件预览/编辑、压缩解压、上传下载、局域网访问、多语言。

## 测试

```bash
go test ./...
```

`internal/fs` 为测试重点：Resolve 越界防护、冲突改名递增、copy/move/delete/restore 往返、名称校验、搜索上限与匹配。`internal/terminal` 测试 OSC 旁路解析（跨帧截断、非 OSC 透传）、busy 判定与会话生命周期、shell 探测。

## 提交约定

每个功能点完成即独立 commit，风格如 `M0: skeleton with list API and minimal UI`、`terminal: busy detection via OSC 133 and tab locking`。

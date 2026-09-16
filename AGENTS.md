# AGENTS.md — kfm

## 项目概述

kfm 是一个本地 Web UI 文件管理器：Go 后端（标准库 `net/http`）+ Vue 3 / Tailwind CSS 前端（Vite 构建，产物 `go:embed` 内嵌），部署形态为单文件二进制。

- 服务端只做「真实文件系统操作 + 路径安全」；一切纯展示逻辑（排序、隐藏过滤、防抖、状态管理）在前端。
- 访问范围仅限程序启动时的当前工作目录（root），不可越界。
- 仅监听 `127.0.0.1`；Host 头校验中间件防 DNS rebinding。

## 目录结构

```
├── main.go                 # flag 解析、启动服务、自动开浏览器
├── internal/
│   ├── fs/                 # root 固化与路径安全、目录列表、
│   │                       # mkdir/create/rename、copy/move、回收站、搜索
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
        └── components/      # Tabbar/Toolbar/Sortbar/FileList/SelectBar/PasteBar/
                            # NavBtns/Toast/Loading/NameDialog/EntrySheet/TrashPanel 等
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

端点：`GET /api/list`、`GET /api/search`、`POST /api/mkdir`、`/api/create`、`/api/rename`、`/api/copy`、`/api/move`、`/api/delete`（`mode:"trash"|"permanent"`）、`GET /api/trash`、`POST /api/trash/restore`、`/api/trash/purge`。

## 核心设计决策

- **路径安全**：`internal/fs/root.go` 的 `Resolve(rel)` 拒绝绝对路径与 `..`，拼 root 后 `EvalSymlinks` 校验仍在 root 内；目标不存在时校验其父目录。除启动时 best-effort 打开浏览器外，不 exec 任何外部命令。
- **回收站**：`<root>/.kfm-trash/<unixnano-hex>/`，内含 `meta.json`（`{path, time, names[]}`）与原条目；一次删除 = 一个批次，恢复整批 rename 回去。列表 API 永远排除 `.kfm-trash`。
- **重名冲突**：copy/move/restore 自动改名 `名称 (2).ext` 递增；mkdir/create/rename 遇重名直接报错。
- **排序/过滤在前端**：`Intl.Collator('zh-Hans-CN', {numeric:true})` 降级链 `'zh'` → 默认 locale；目录永远排前；切换无需请求。
- **导航**：每标签独立 history，`history.pushState({tabId, path})` + `popstate` 使浏览器返回手势 = 返回上级；`localStorage`（key `kfm-state`）持久化 tabs/sort/showHidden。
- **剪贴板**：前端持有 `{mode, srcPath, names[]}`，服务端无状态，粘贴时才调 copy/move。

## 编码约定

- Go：仅标准库（`os.CopyFS` 需 Go 1.23+），不用第三方依赖。
- 前端：Vue 3 `<script setup>` 组合式 API；样式用 Tailwind 原子类，无独立组件 CSS。
- 错误消息、UI 文案全部中文。
- 不做：文件预览/编辑、压缩解压、上传下载、局域网访问、多语言。

## 测试

```bash
go test ./...
```

`internal/fs` 为测试重点：Resolve 越界防护、冲突改名递增、copy/move/delete/restore 往返、名称校验、搜索上限与匹配。

## 任务与里程碑

开发按 `tasks.md` 的 M0–M7 里程碑顺序推进，每个里程碑完成即独立 commit（风格如 `M0: skeleton with list API and minimal UI`）。总体计划见 `PLAN.md`。

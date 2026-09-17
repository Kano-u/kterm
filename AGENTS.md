# AGENTS.md — kfm

## 项目概述

kfm 是一个本地 Web UI 文件管理器：Go 后端（标准库 `net/http`）+ Vue 3 / Tailwind CSS 前端（Vite 构建，产物 `go:embed` 内嵌），部署形态为单文件二进制。

- 服务端只做「真实文件系统操作」；一切纯展示逻辑（排序、隐藏过滤、防抖、状态管理）在前端。
- **访问范围无限制**：可以浏览、编辑、运行命令于整台机器的任意位置（权限以内）。
  程序启动时的 cwd 只作为「起始目录」——路径栏中空路径（`''`）的含义，也是回收站与
  设置文件的存放位置，不再是可访问范围的边界。终端与文件页双向同步，cd 到哪里文件页
  就跟到哪里（见终端条目）。
- 仅监听 `127.0.0.1`；Host 头校验中间件防 DNS rebinding（对终端 WebSocket 同样生效）。
- 每个文件标签页可绑定一个独立 PTY 终端（xterm.js + WebSocket）：惰性创建、双向目录同步、运行中锁定该标签。
- 每个文件标签页也可打开一个独立编辑器（CodeMirror 6，按需懒加载）：切走视图不丢文档与撤销栈，mtime 冲突检测防覆盖外部改动。

## 目录结构

```
├── main.go                 # flag 解析、启动服务、自动开浏览器
├── internal/
│   ├── fs/                 # 起始目录固化与路径解析（root.go：相对/绝对路径 → 绝对路径）、
│   │                       # 展示路径规范化（display.go）、目录列表、
│   │                       # mkdir/create/rename、copy/move、回收站、搜索、
│   │                       # 编辑器读写（edit.go：大小/二进制/mtime 冲突）
│   ├── terminal/           # 终端：WS 端点（ws.go，T0 为 echo 自测）、
│   │                       # 会话注册表 manager.go、PTY 会话 session.go、
│   │                       # OSC 旁路解析 osc.go、shell 探测 shell.go
│   └── server/
       ├── server.go        # 路由、Host 校验、静态资源
       ├── handlers.go      # JSON 端点
       └── web/             # 前端构建产物（go:embed，勿手改；由 `npm run build` 生成）
└── frontend/               # Vue 3 + Tailwind + Vite 源码
    ├── vite.config.js      # outDir 指向 ../internal/server/web，dev 代理 /api
    ├── test/               # 纯 node 回归测试（settingsnav/editor/touchscroll/termgutter/paths）
    └── src/
        ├── store.js        # 单一 reactive 状态（tabs/sort/clipboard/selection/editors）
        ├── actions.js      # 导航/标签/操作/剪贴板动作
        ├── api.js          # fetch 封装
        ├── editor.js       # 编辑器会话注册表（镜像 terminal.js）
        ├── editor-lang.js  # 扩展名 → 语言包映射 + 自写 M3 深色 CM 主题
        ├── dialog.js / confirm.js / toast.js / loading.js
        └── components/      # Tabbar/Toolbar（含排序行）/FileList/SelectBar/PasteBar/
                            # Toast/Loading/NameDialog/EntrySheet/TrashPanel 等
                            # （T1 起新增 Taskbar/TerminalView，E2 起新增 EditorView）
```

## 构建与运行

```bash
# 重新构建前端（仅改了 frontend/ 源码时需要）
cd frontend && npm install && npm run build

# 构建并运行（在想要作为 root 的目录里执行）
go build . && ./kfm              # 默认 127.0.0.1:8080
./kfm -addr 127.0.0.1:9000

## API 约定

所有 `path` 参数都是「展示路径」：`/` 分隔，可以是
`''`（起始目录）、相对路径（相对起始目录，允许 `..`）或绝对路径（`/sdcard`、`C:/Users`）。
成功返回 `{"ok":true}` 或具体数据；失败返回 4xx/5xx + `{"error":"中文错误消息"}`。
`GET /api/list` 额外返回 `abs`：当前目录的绝对路径（前端据此渲染完整路径栏）。

端点：`GET /api/list`、`GET /api/search`、`POST /api/mkdir`、`/api/create`、`/api/rename`、`/api/copy`、`/api/move`、`/api/delete`（`mode:"trash"|"permanent"`）、`GET /api/trash`、`POST /api/trash/restore`、`/api/trash/purge`、`GET /api/read`、`POST /api/write`、`GET /api/root`、`GET /api/settings`、`POST /api/settings`、`GET /api/term/ws`（终端 WebSocket，见下）。

### 编辑器端点（/api/read、/api/write）

服务端无会话状态，只做纯文件读写：

- `GET /api/read?path=<展示路径>` → `{"content":"...","mtime":<unix 毫秒>,"size":N}`。
  拒绝目录、>2 MB 的文件、前 8 KiB 含 NUL 的二进制文件；不做换行转换（LF/CRLF 原样返回）。
- `POST /api/write` 体 `{path, content, mtime}` → `{"ok":true,"mtime":<新 mtime>}`。
  `mtime` 与磁盘现状不符时返回 **409**「文件已被其他程序修改」（前端弹「重新加载 / 覆盖保存 / 取消」三选一）。
  写入走「同目录 `.kfm-edit-*` 临时文件 + rename」原子替换，并保留原文件权限。
  服务端同时对目标路径做 `rejectIfBusy` 兜底：终端 running 的目录拒绝写入（读不受限）。

### 终端 WebSocket（/api/term/ws）

- 受 hostCheck 保护；查询参数 `tab=<tabId>&path=<展示路径，终端初始工作目录>`。
- C→S（text JSON）：`{"t":"i","d":"<键入>"}`、`{"t":"resize","cols":N,"rows":N}`、`{"t":"cd","rel":"a/b"}`（rel 为展示路径）；
- S→C：binary（PTY 原始输出，经 OSC 旁路扫描但不吞字节）与 text JSON `{"t":"shell"|"cwd"|"busy"|"exit"|"error",...}`；`cwd` 的 `abs` 为绝对路径，前端换算为展示路径后驱动文件页跟随（起始目录外用绝对路径）。
- 生命周期：WS 断开（含刷新）或 shell 退出即杀死 PTY 并从注册表移除；同一 tabId 二次连接被拒绝（提示「该标签的终端已被其他窗口占用」）。底部任务栏的「终端」按钮在会话已打开时显示 × 关闭入口（等价于杀 PTY 并回文件视图）；busy 时改为转圈，需先中断命令。

## 核心设计决策

- **路径解析**：`internal/fs/root.go` 的 `Resolve(p)` 是唯一的解析入口——空路径 → 起始目录，
  绝对路径原样清洗，相对路径拼接起始目录后 `Clean`；不再解析符号链接、也不做越界校验
  （访问范围就是整台机器，权限交给操作系统）。`display.go` 负责展示路径与绝对路径的互转
  （`DisplayPath` / `StorePath`）。
- **用户设置**：`.kfm-settings.json` 的 `{keys, keyBarEnabled}`，由设置页读写。
- **回收站**：`<起始目录>/.kfm-trash/<unixnano-hex>/`，内含 `meta.json`（`{path, time, names[]}`）
  与原条目；`path` 保存展示路径（相对或绝对），跨会话恢复仍指向同一位置。一次删除 = 一个批次，
  恢复整批 rename 回去。列表 API 永远排除 `.kfm-trash`。
- **重名冲突**：copy/move/restore 自动改名 `名称 (2).ext` 递增；mkdir/create/rename 遇重名直接报错。
- **排序/过滤在前端**：`Intl.Collator('zh-Hans-CN', {numeric:true})` 降级链 `'zh'` → 默认 locale；目录永远排前；切换无需请求。
- **导航**：每标签独立 history，`history.pushState({tabId, path})` + `popstate` 使浏览器返回手势 = 返回上级；`localStorage`（key `kfm-state`）持久化 tabs/sort/showHidden（tab 同时记录 `path` 与 `abs`）。路径栏从文件系统根逐级展开（`C:/`、`/`），根处禁用「上一级」，「前往路径」对话框可直输绝对路径。
- **编辑器**：`state.editors: Map<tabId, {relPath,name,dirty,...}>`（镜像 `state.terminals`），`state.view` 增加 `'editor'`（不持久化，刷新即丢，与终端一致）。CodeMirror 的 `EditorState` **不进响应式 store**，由 `EditorView.vue` 的普通 Map 持有，store 侧只存 UI 状态与 `getText/applyDoc/markSaved` 钩子。每标签同时只编辑一个文件；切走视图不销毁 doc（撤销栈与光标保留），点开新文件 / 关标签 / 关会话时若有 dirty 先确认。CM 内核与语言包、主题全部 `import()` 懒加载（`EditorView` 由 `defineAsyncComponent` + `v-if="state.editors.size > 0"` 挂载），首屏零开销。>512 KB 关闭语法高亮，>2 MB 服务端直接拒绝。换行：读入归一为 `\n` 供内核使用，保存按原风格（LF/CRLF）写回。
- **剪贴板**：前端持有 `{mode, srcPath, names[]}`，服务端无状态，粘贴时才调 copy/move。

## 编码约定

- **Go**：除 PTY（`github.com/aymanbagabas/go-pty`）与 WebSocket（`github.com/coder/websocket`）外仅标准库（`os.CopyFS` 需 Go 1.23+）。
- **前端**：终端引入 `@xterm/xterm` + `@xterm/addon-fit`，编辑器引入 `@codemirror/*`（仅动态 import，不进首屏 chunk），其余不新增依赖；Vue 3 `<script setup>` 组合式 API；样式用 Tailwind 原子类，无独立组件 CSS。
- 错误消息、UI 文案全部中文。
- 不做：文件预览、压缩解压、上传下载、多语言。

## 测试

```bash
go test ./...
cd frontend && npm test     # 纯 node 回归测试（无需浏览器/构建）
```

`internal/fs` 为测试重点：Resolve 的绝对/相对/.. 解析、冲突改名递增、copy/move/delete/restore 往返、名称校验、搜索上限与匹配、编辑器读写（大小/二进制拒收、mtime 冲突、CRLF 往返、原子写不留临时文件）。`internal/server` 测试读写端点与 busy 兜底（409）。`internal/terminal` 测试 OSC 旁路解析（跨帧截断、非 OSC 透传）、busy 判定与会话生命周期、shell 探测。`frontend/test` 覆盖设置页导航、编辑器会话（dirty/保存/409 三选一/换行风格/大文件降级）、终端触摸滚动与侧留白、路径语义（拼接/上级/展示名/cwd 换算）。

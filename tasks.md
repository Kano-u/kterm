# Tasks — 终端功能（底部任务栏 + 每文件标签独立 PTY 终端）

总体设计见 `PLAN-terminal.md`。按 T0–T5 顺序推进，每个里程碑完成即独立 commit。

## T0 依赖引入与骨架

- [x] Go 端引入 `github.com/aymanbagabas/go-pty`、`github.com/coder/websocket`
- [x] 前端引入 `@xterm/xterm`、`@xterm/addon-fit`
- [x] 新建 `internal/terminal/` 包（空骨架：manager.go / session.go / osc.go / shell.go）
- [x] 注册 `GET /api/term/ws` 路由（先做 echo 自测，验证 WebSocket 链路与 hostCheck 生效）
- [x] 更新 AGENTS.md：约定改为「除 PTY 与 WebSocket 外仅标准库」，补充终端相关条目

## T1 PTY 会话与终端视图骨架

### 服务端

- [ ] `manager.go`：会话注册表（map[tabID]*Session）+ 互斥锁，创建/查询/关闭/断连清理
- [ ] `shell.go`：shell 探测（Windows: `pwsh.exe` → `powershell.exe` → `cmd.exe`；Unix: `$SHELL` → `bash` → `sh`）+ 启动参数
- [ ] `session.go`：启动 PTY + shell，三个 goroutine（输出泵 / 输入泵 / 退出监听）
- [ ] WS 协议：C→S `{"t":"i","d":...}` / `{"t":"resize","cols":..,"rows":..}`；S→C binary 输出帧 / `{"t":"exit"}`
- [ ] WS 断开时杀死 PTY 并从 manager 移除
- [ ] 初始工作目录：由 `fs.Resolve(relPath)` 得到，越界校验沿用现有逻辑

### 前端

- [ ] `store.js`：新增 `state.view`（'files' | 'term'）与 `state.terminals`（Map，不持久化）
- [ ] `components/Taskbar.vue`：底部任务栏，`文件` | `终端` 两个胶囊按钮，样式与 Tabbar 一致
- [ ] `components/TerminalView.vue`：xterm 实例管理（层叠 + v-show，切回时 refit）、WebSocket 建连与消息分发、ResizeObserver + addon-fit、主题跟随暗色模式
- [ ] `App.vue`：FileList 与 TerminalView 按 `state.view` 互斥渲染；Taskbar 固定底部；SelectBar/PasteBar/NavBtns 仅在文件视图显示
- [ ] 进入终端视图：为当前激活文件标签自动建连（惰性创建会话）
- [ ] 手测：能交互打字、看到 shell 输出、resize 生效（Windows + Linux）

## T2 双向目录同步

### 服务端

- [ ] `osc.go`：输出流 OSC 扫描器，旁路解析 OSC 7 与 OSC 133，不吞字节、原样透传
- [ ] `osc_test.go`：跨帧截断、不完整序列、非 OSC 转义透传、UTF-8 多字节被帧边界切开、超长/恶意序列
- [ ] shell 集成注入：pwsh 原生；Windows PowerShell 5.1 包装 `prompt` 函数；bash/zsh 用 `PROMPT_COMMAND`/`precmd`+`preexec`；cmd 无集成（降级标记）
- [ ] 收到 C→S `{"t":"cd","rel":...}` 帧：Resolve 成绝对路径后拼接 cd 命令写入 PTY stdin（PowerShell 用反斜杠路径）
- [ ] OSC 7 解析结果推送 S→C `{"t":"cwd","abs":...}`

### 前端

- [ ] 收到 `cwd` 消息：换算相对 root 路径；root 内且 ≠ tab.path → 调 `navigate()`；root 外 → 置 outsideRoot，文件页不动
- [ ] 防回环：注入 cd 引发的 cwd 上报与当前 tab.path 一致时不再触发 navigate
- [ ] `actions.js`：`navigate()` / `tabGo()` / `switchTab()` 成功后，若该 tab 有运行中终端且新路径在 root 内 → 发送 cd 帧
- [ ] TerminalView 顶部提示条：「当前目录在 root 外，文件页不会跟随」（outsideRoot 时显示）
- [ ] 手测：文件页点目录 ↔ 终端 cd，双向跳转无回环抖动（pwsh / powershell / bash）

## T3 运行状态与锁定

### 服务端

- [ ] OSC 133;C → busy=true，133;D → busy=false；推送 S→C `{"t":"busy","on":..}`
- [ ] 无 133 标记的 shell（cmd 等）降级：前端检测输入含 `\r` 置 busy，收到下条 prompt 输出复位
- [ ] `manager.BusyPaths()`：暴露 busy 会话的 cwd 集合
- [ ] `handlers.go` 写操作（mkdir/create/rename/copy/move/delete）执行前检查目标路径是否落在 busy cwd 内，命中返回错误「该目录正在终端中运行命令」

### 前端

- [ ] `state.terminals` 维护 busy 状态
- [ ] `Tabbar.vue`：busy 终端绑定的标签 X 按钮禁用 + 灰化；`closeTab` 前置校验 + toast「终端正在运行命令」；仍可切换标签
- [ ] 激活被锁标签时，文件写操作入口（删除/剪切/粘贴/重命名/新建）禁用
- [ ] `Taskbar.vue` 终端入口：当前激活文件标签的终端 busy 时显示转圈指示
- [ ] 手测：长时间 ping / vim 中 X 禁用、文件操作禁用；切到其他标签不受影响；服务端兜底对直接调 API 也生效

## T4 退出与生命周期

- [ ] 收到 `{"t":"exit"}`：status='ended'，清理终端条目；若当前在该终端视图 → 自动切回 `view='files'` + toast「终端会话已结束」
- [ ] `closeTab(id)`：先 ws.close() 杀终端再删标签
- [ ] 关闭文件标签 → 服务端 PTY 立即退出（空闲终端）
- [ ] `switchTab` 在终端视图下：切到新标签的终端层，无会话则自动建连
- [ ] 刷新后：terminals 表清空，重新进入终端视图自动新建会话
- [ ] `beforeunload`：任一终端 busy 时拦截刷新/关闭浏览器页
- [ ] 多浏览器窗口同一 tabId 二次连接：拒绝并提示「该标签的终端已被其他窗口占用」
- [ ] 手测：exit 后切回与重建、关标签杀进程（任务管理器确认无残留）、刷新拦截生效

## T5 测试、打磨与文档

- [ ] `internal/terminal` 单测补全：manager（创建/复用/关闭/断连清理/busy 查询）、shell 探测
- [ ] 集成手测矩阵：Windows（pwsh / powershell / cmd 降级）× {vim、less、Ctrl+C、长时间命令、双向 cd、锁定、exit、beforeunload}；Linux 同口径
- [ ] 终端视觉打磨：字号/行距与整体 UI 一致、滚动条样式、暗色模式切换即时生效
- [ ] 更新 AGENTS.md 目录结构与 API 约定章节（新增 /api/term/ws）
- [ ] 全量回归：`go test ./...`、文件管理器原有功能（列表/复制/移动/回收站/搜索/多标签）无回归

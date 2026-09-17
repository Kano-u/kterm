# 终端功能实施计划（底部任务栏 + 每文件标签独立 PTY 终端）

## 需求摘要（已确认）

1. 底部新增**任务栏**，仅两个入口：`文件` | `终端`，纯视图切换。
2. **每个文件标签页 ↔ 一个独立终端实例**（惰性创建：首次进入终端视图时才启动）。
3. 点击「终端」→ 为**当前激活的文件标签**启动/恢复终端，初始工作目录 = 该标签所在目录。
4. **真 PTY**（跨平台 Windows ConPTY / Unix PTY）+ xterm.js，完整终端体验（交互程序、颜色、Ctrl+C、vim/less）。
5. **双向目录同步**：
   - 文件页导航 → 向绑定终端注入 `cd`；
   - 终端内 `cd` → 通过 OSC 7 上报 cwd，文件页同步跳转（仅当 cwd 在 root 内）。
6. 终端可**自由 cd 出 root**，越界时文件页不跟随，终端顶部显示「当前目录在 root 外」提示条。
7. **运行中锁定**：终端有命令在执行时，**仅锁定该终端绑定的那个文件标签**：
   - 标签关闭按钮（X）禁用/隐藏，关闭快捷键拦截；仍可切换标签。
   - 该标签**处于激活态时**，文件写操作（删除/移动/重命名/新建/粘贴）禁用并 toast 提示。
8. 底部「终端」入口：当前激活文件标签的终端在运行时显示转圈指示；样式为纯图标+文字「终端」。
9. 关闭文件标签 → 立即杀死其终端（运行中已被锁定，故只涉及空闲终端）。
10. shell 内 `exit` → 标记会话结束，自动切回文件视图，下次点击开新会话。
11. 有终端运行中时，`beforeunload` 拦截刷新/关闭浏览器页。
12. Shell 探测：Windows 上 `pwsh.exe` → `powershell.exe` → `cmd.exe`（选默认 PowerShell，探测顺序如上）；Unix 上 `$SHELL` → `bash` → `sh`。
13. 允许引入依赖（见下），更新 AGENTS.md。

## 依赖

| 端 | 库 | 说明 |
|---|---|---|
| Go | `github.com/aymanbagabas/go-pty` | 跨平台 PTY（Windows ConPTY / Unix PTY），轻量 |
| Go | `github.com/coder/websocket` | 纯 Go WebSocket，性能好，小而稳 |
| 前端 | `@xterm/xterm` + `@xterm/addon-fit` | 终端渲染 + 自适应尺寸 |

约定变更：AGENTS.md「仅标准库」改为「除 PTY 与 WebSocket 外仅标准库」；新增终端相关条目。

## 架构设计

### 服务端：新包 `internal/terminal/`

```
internal/terminal/
├── manager.go   # 会话注册表（map[tabID]*Session），互斥锁保护
├── session.go   # 单个 PTY 会话：启动 shell、IO 泵、退出清理
├── osc.go       # 输出流中的 OSC 序列扫描器（7 / 133;C / 133;D），原样透传字节
├── shell.go     # shell 探测 + 启动参数 + prompt 集成注入
└── osc_test.go  # OSC 解析单测（跨消息边界、不完整序列、UTF-8 截断等）
```

**Session 结构**（概念）：

```
Session {
  tabID      string        // 客户端文件标签 id（localStorage 持久化的那个 id）
  pty        pty 实例
  ws         WebSocket 连接
  cwd        string        // 绝对路径（OSC 7 上报的最新值）
  busy       bool          // OSC 133;C → true，133;D → false
  done       chan struct{} // shell 退出信号
}
```

**生命周期**：
- WS 连接建立 → 若该 tabID 已有会话则拒绝（或复用）→ 否则 `fs.Resolve(relPath)` 得初始 cwd → 启动 PTY + shell → 注册到 manager。
- 三个 goroutine：`pty→ws 输出泵`（经 OSC 扫描器）、`ws→pty 输入泵`、`wait 退出监听`。
- WS 断开（含刷新页面）→ **杀死 PTY**（会话与连接绑定，刷新即失联，服务端主动清理）。前端刷新后重新进入终端视图即新建会话，行为与需求 10 一致。
- `closeTab(tabId)` → WS close → 服务端 kill。

**WebSocket 协议**（`GET /api/term/ws?tab=<tabId>&path=<rel>`，受现有 hostCheck 保护）：

| 方向 | 帧 | 内容 |
|---|---|---|
| C→S | text JSON | `{"t":"i","d":"<键入>"}` 写入 PTY stdin |
| C→S | text JSON | `{"t":"resize","cols":N,"rows":N}` |
| S→C | **binary** | PTY 原始输出字节（零拷贝透传，UTF-8 边界安全） |
| S→C | text JSON | `{"t":"cwd","abs":"C:\\..."}`（OSC 7 解析结果） |
| S→C | text JSON | `{"t":"busy","on":true/false}`（OSC 133 结果） |
| S→C | text JSON | `{"t":"exit"}`（shell 进程退出） |

**目录同步（服务端部分）**：
- 终端内 `cd`：shell 集成使 prompt 每次输出 OSC 7（`file://host/<cwd>`）；扫描器解析后推送 `cwd`。
- 文件页导航 → 注入 `cd`：新增 WS 控制帧 `{"t":"cd","rel":"a/b"}`，服务端 `Resolve` 成绝对路径后拼成命令写入 PTY stdin（PowerShell 用反斜杠路径），末尾带换行。
- **防回环**：注入 cd 引发的 cwd 上报若与前端当前 tab.path 一致则前端不动作；前端触发的跳转不再反向注入。

**shell 集成（busy 检测 + OSC 7 的来源）**：
- pwsh 7.4+：原生输出 OSC 133 与 OSC 7（shell integration）。
- Windows PowerShell 5.1：启动时通过 `-NoLogo -NoExit -Command <启动片段>` 注入 prompt 包装——重定义 `prompt` 函数输出 `OSC 7`（当前目录）与 `OSC 133;D`（命令结束），配合 PSReadLine `OnCommandExecuted`/`AddToHistory` 时机输出 `133;C`。
- bash/zsh：注入 `PROMPT_COMMAND`/`precmd` 输出 `OSC 7` + `133;D`，`preexec` 输出 `133;C`。
- cmd.exe：无集成能力（降级：无 busy 锁定、无终端→文件同步，文件→终端 cd 仍有效；启动时前端 toast 说明）。
- **降级兜底 heuristic**：若 shell 无 133 标记，前端检测到输入含 `\r` 时置 busy=true，收到下一条 cwd/prompt 输出置 false。主路径是 PowerShell（用户环境），走 133。

**运行锁定的服务端加固（防御性，可选但建议）**：`manager` 暴露 `BusyPaths()`（busy 会话的 cwd 集合）；`handlers.go` 的写操作（mkdir/create/rename/copy/move/delete/paste 目标路径）在执行前检查目标路径是否落在某个 busy 会话 cwd 之内，是则返回错误「该目录正在终端中运行命令」。UI 禁用为主，服务端兜底。

### 前端

**store.js 新增状态**（均不持久化）：

```
state.view: 'files' | 'term'          // 当前底部任务栏激活的视图
state.terminals: Map<tabId, {
  status: 'starting' | 'running' | 'ended',
  busy: boolean,
  outsideRoot: boolean,               // cwd 是否在 root 外
  ws: WebSocket | null,
  // xterm 实例与 DOM 由 TerminalView 管理，不放 store
}>
```

**新组件**：

- `components/Taskbar.vue`：底部固定栏，`文件` / `终端` 两个胶囊按钮，样式与现有 Tabbar 一致；「终端」按钮上叠加转圈图标（`state.terminals.get(activeTabId)?.busy` 时显示）。
- `components/TerminalView.vue`：
  - 管理每个 tabId 的 xterm 实例（`v-show` 切换保留会话与回滚；用绝对定位层叠避免 display:none 导致 fit 失效，切回时重新 `fit()`）。
  - 建连：`new WebSocket`（ws/wss 按协议）→ onopen 写 status、onmessage 分发 output/cwd/busy/exit、onclose 清理。
  - 输出 binary 帧 → `term.write()`；`onData` → input 帧；ResizeObserver + addon-fit → resize 帧。
  - 主题跟随现有暗色模式（`prefers-color-scheme`），监听切换。
  - 顶部条件提示条：「当前目录在 root 外，文件页不会跟随」（outsideRoot 时）。

**App.vue 布局**：`<FileList/>` 与 `<TerminalView/>` 按 `state.view` 互斥显示；Taskbar 固定底部，置于 SelectBar/PasteBar 之上。文件视图原有的 SelectBar/PasteBar/NavBtns 仅在 view==='files' 时渲染。

**actions.js 变更**：

- `navigate()` / `tabGo()` / `switchTab()` 成功后：若该 tab 存在运行中终端且新路径 ≠ 终端 cwd（在 root 内），发送 `cd` 帧。
- `closeTab(id)`：先 kill 对应终端（ws.close()），再删标签；被锁定的标签在 Tabbar 层面已不可关。
- `switchTab()` 在 view==='term' 时：切到新 tab 的终端层（无则显示「点击新建会话」空态或自动建连——**选择自动建连**，符合需求 3）。
- 收到 `cwd` 消息：计算相对 root 的路径；在 root 内且 ≠ tab.path → 调 `navigate()`（注意防回环，见上）；在 root 外 → 置 outsideRoot，不动文件页。
- 收到 `exit` 消息：status='ended'，若当前在该终端视图 → 自动切回 `view='files'`，toast「终端会话已结束」，清理条目（下次点击新建）。
- `beforeunload`：任一终端 `busy===true` 时返回非空值触发浏览器确认。

**锁定（前端）**：

- `Tabbar.vue`：锁定标签的 X 按钮 disabled + 灰化（或隐藏），`closeTab` 前置校验 + toast「终端正在运行命令」。
- `Toolbar/EntrySheet/FileList` 操作入口：当 `view` 任意、激活标签的终端 busy 时，删除/剪切/粘贴/重命名/新建/粘贴入口禁用（切到其他标签不受影响，符合「仅锁定对应标签」）。

**localStorage**：`kfm-state` 结构不变（view 不持久化，启动始终进文件视图；终端本就不跨刷新存活）。

## 边界情况清单

- 刷新/断网：WS 断开 → 服务端杀 PTY；前端 terminals 表清空，重新进入终端视图自动新建。
- 终端 cd 到 root 内新目录 → 文件页 `navigate()` 走现有 history/pushState 逻辑（浏览器返回手势行为保持一致）。
- 文件页导航发生在终端尚未创建时：不建终端，只记录路径，首次建连时以当前 tab.path 为初始 cwd。
- 关闭最后一个文件标签（现有逻辑保证至少一个）不影响。
- 多浏览器窗口/标签页打开同一 kfm：同一 tabId 冲突时后连者拒绝并提示「该标签的终端已被其他窗口占用」；各窗口 tabId 不同则互不干扰。
- PTY 输出中的 OSC 序列对 xterm.js 是透明的（本就要渲染），扫描器只旁路解析，不吞字节。
- Windows 路径 / Unix 路径在 `cwd` 消息中统一为 OS 原生绝对路径；「相对 root」换算统一在服务端做一份（`/api/term/ws` 的 `path` 参数与现有 API 一致用相对路径），前端只比较相对路径。

## 测试

- `internal/terminal/osc_test.go`（重点）：OSC 7/133 解析、序列跨帧截断、非 OSC 转义序列透传、UTF-8 多字节字符被帧边界切开时输出不受影响、恶意/超长序列。
- manager 单测：会话创建/复用/关闭、busy 状态查询、WS 断开自动清理。
- 集成手测矩阵：Windows（pwsh / powershell / cmd 降级）× {vim、Ctrl+C、长时间 ping、cd 双向、锁定、exit、beforeunload}；Linux 同口径。

## 里程碑（每步独立 commit）

- **T0** `deps: add go-pty, coder/websocket, xterm.js` —— 引依赖，AGENTS.md 更新约定，WebSocket 端点骨架（echo 自测）。
- **T1** `terminal: PTY session manager over websocket` —— manager/session/shell 探测，WS 协议（input/resize/binary output/exit），断连清理；前端 Taskbar + TerminalView 骨架，能交互打字看到输出。
- **T2** `terminal: cwd sync via OSC 7 and cd injection` —— OSC 扫描器 + 双向同步 + root 外提示条 + 防回环。
- **T3** `terminal: busy detection via OSC 133 and tab locking` —— 133 解析 + 降级 heuristic，标签 X 锁定、文件操作禁用、服务端 BusyPaths 兜底、底部转圈指示。
- **T4** `terminal: exit handling and beforeunload` —— exit 自动切回、closeTab 杀终端、刷新拦截。
- **T5** `terminal: tests, polish, docs` —— 单测补全、主题/细节打磨、README/AGENTS 收尾。

## 明确不做

- 终端多标签/分屏（每文件标签固定一个终端，入口仅文件/终端两个）。
- 终端内容持久化 / 会话跨刷新恢复。
- 主题定制、字体设置项。
- chroot / 强制终端留在 root 内（用户已确认允许自由 cd）。

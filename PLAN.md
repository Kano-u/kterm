# kfm — Termux 移动端简易文件管理器（Web UI）开发计划

> Go 后端 + Vue 3 / Tailwind CSS 前端（Vite 构建，产物 `go:embed` 内嵌）。
> 在 Termux 中启动本地 HTTP 服务，手机浏览器访问；部署为单文件二进制，为触摸操作优化。

---

## 1. 已确认的需求

| 项 | 决策 |
|---|---|
| 形态 | 本地 Web UI（服务跑在 Termux，浏览器访问） |
| 功能范围 | 浏览/导航、复制/移动/删除/重命名/新建、搜索、排序 |
| 标签页 | 浏览器式：每标签独立目录，可新建/关闭，各自记住位置 |
| 搜索 | 递归子目录、仅匹配文件名、输入即搜（防抖） |
| 排序 | 字段：名称/大小/修改时间/类型；点击切换升降序；目录永远在前；中文名按拼音 |
| 文件操作交互 | 多选批量 + 删除确认框 + 回收站 + 剪贴板式复制/移动（选中 → 剪切 → 目标目录粘贴） |
| 访问范围 | 仅程序启动时的当前工作目录（CWD），不可越界 |
| 网络 | 仅监听 127.0.0.1，不做局域网访问 |
| 界面 | 中文；单面板 + 顶部标签页；面包屑路径栏；隐藏文件显示开关 |

## 2. 本计划补充的默认决策（可否决，不影响整体结构）

1. **项目名 / 二进制名**：`kfm`，go.mod module 名 `kfm`（纯本地项目，无需托管路径）。
2. **端口**：默认 `127.0.0.1:8080`，可用 `-addr` 修改。
3. **启动后自动打开浏览器**：默认开启（优先 `termux-open-url`，失败则忽略），`-open=false` 关闭；无论成败都在终端打印 URL。
4. **删除交互**：确认对话框提供两个按钮——「移入回收站」（主按钮）和「永久删除」（红色破坏性样式）。
5. **回收站位置**：`<root>/.kfm-trash/`（在可访问范围内，但永远不出现在文件列表中）。
6. **重名冲突**：复制/移动/恢复时目标已存在同名项 → 自动改名为 `名称 (2).ext` 递增；新建/重命名遇重名 → 直接报错。
7. **单击文件** → 弹出操作面板（重命名/复制/移动/删除/详情）；**长按任意条目** → 进入多选模式。
8. **每标签带前进/后退历史**（"记住位置"的自然延伸），并利用 `history.pushState` 让 Android 返回手势 = 返回上级目录。
9. **标签/排序/隐藏开关状态存入 localStorage**，页面刷新或误关后可恢复。
10. **深色模式**：跟随系统 `prefers-color-scheme`，CSS 变量实现。
11. 图标用 emoji（📁 📄 🖼️ …）按类型区分，零代码成本；后续可换内联 SVG。

---

## 3. 技术选型及理由

| 项 | 选择 | 理由 |
|---|---|---|
| 后端 | Go 标准库 `net/http` | Go 1.22+ 的 ServeMux 支持 `GET /api/list`、`/assets/{path...}` 路由，无需 chi/mux |
| 目录复制 | 标准库 `os.CopyFS`（Go 1.23+） | 免去手写递归复制 |
| 前端 | Vue 3（`<script setup>` 组合式 API）+ Tailwind CSS v4 + Vite | 声明式渲染替代手写 DOM；Tailwind 原子类内联样式，无独立 CSS 文件；开发期 `vite dev` 热更新（API 代理至 8080），构建产物输出到 `internal/server/web/` 后 `go:embed` 内嵌，**部署形态不变：仍是单二进制** |
| 拼音排序 | 前端 `Intl.Collator('zh-Hans-CN', {numeric:true})` | 浏览器内置 ICU 支持，零依赖；排序在前端做还意味着切换排序无需请求、即时生效；Go 侧因此完全不需要 collation 库 |
| 交叉编译 | `CGO_ENABLED=0` | 纯 Go，Windows 上可直接 `GOOS=linux GOARCH=arm64 go build`（前端产物已内嵌，无需在打包机上装 Node） |

## 4. 总体架构

```
┌─────────── Termux ───────────┐      ┌──── 手机浏览器 ────┐
│  kfm (单二进制)               │      │  内嵌的静态页面      │
│  ├─ net/http + JSON API      │◄────►│  Vue 3 单页应用      │
│  ├─ internal/fs  路径安全/操作 │ HTTP │  排序/过滤/防抖在前端 │
│  └─ internal/server handlers │localhost │              │
│  web/ (go:embed 前端资源)     │      │                    │
└──────────────────────────────┘      └────────────────────┘
```

**职责划分原则**：服务端只做「真实文件系统操作 + 路径安全」；一切纯展示逻辑（排序、隐藏过滤、防抖、状态管理）放前端，交互即时无网络往返。

### 目录结构

```
kterm/
├── go.mod                  # module kfm, go 1.27
├── main.go                 # flag 解析、启动服务、自动开浏览器
├── internal/
│   ├── fs/
│   │   ├── root.go         # root 固化、路径解析与越界防护
│   │   ├── list.go         # 目录列表
│   │   ├── ops.go          # mkdir/create/rename/copy/move/delete
│   │   ├── clipboard.go    # copy/move 逐项执行 + 冲突自动改名
│   │   └── errors.go       # 错误定义
│   └── server/
│       ├── server.go       # 路由、Host 校验中间件、静态资源
│       ├── handlers.go     # 各 JSON 端点
│       └── web/            # 前端构建产物（go:embed，勿手改；由 `npm run build` 生成）
│           ├── index.html
│           └── assets/…
├── frontend/               # Vue 3 + Tailwind + Vite 源码
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js      # outDir 指向 ../internal/server/web，dev 时代理 /api
│   └── src/
│       ├── main.js
│       ├── App.vue
│       ├── store.js        # 单一 reactive 状态（tabs/sort/clipboard/multi）
│       ├── api.js          # fetch 封装
│       ├── actions.js      # 导航/标签/操作/剪贴板动作
│       ├── dialog.js       # 全局命名对话框状态
│       ├── toast.js / loading.js
│       ├── style.css       # Tailwind 入口 + 少量全局样式
│       └── components/     # Tabbar/Toolbar/Sortbar/FileList/SelectBar/PasteBar/
│                           # NavBtns/Toast/Loading/NameDialog/EntrySheet
├── PLAN.md
└── README.md               # M7 里程碑时编写
```

**Root 的确定**：启动时 `os.Getwd()` → `filepath.EvalSymlinks` → 得到绝对路径 root。此后一切用户路径都是「相对 root 的相对路径」，服务端统一解析并校验不可越界。面包屑根节点显示 root 的目录名。

---

## 5. API 设计

所有 `path` 参数均为相对 root 的相对路径（`/` 分隔，URL 场景需编码；JSON 中为普通字符串）。
成功返回 `{"ok":true}` 或具体数据；失败返回 4xx/5xx + `{"error":"中文错误消息"}`。

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/api/list?path=` | — | `{"root":"storage","path":"docs","entries":[{name,isDir,size,mtime}]}` |
| GET | `/api/search?path=&q=` | — | `{"results":[{name,path,isDir,size,mtime}],"truncated":false}` |
| POST | `/api/mkdir` | `{path, name}` | `{ok}` |
| POST | `/api/create` | `{path, name}` | `{ok}`（新建空文件） |
| POST | `/api/rename` | `{path, oldName, newName}` | `{ok}` |
| POST | `/api/copy` | `{srcPath, names[], destPath}` | `{ok}` |
| POST | `/api/move` | `{srcPath, names[], destPath}` | `{ok}` |
| POST | `/api/delete` | `{path, names[], mode:"trash"\|"permanent"}` | `{ok}` |
| GET | `/api/trash` | — | `{"items":[{id, time, path, names[]}]}` |
| POST | `/api/trash/restore` | `{ids[]}` | `{ok}` |
| POST | `/api/trash/purge` | `{ids[]}` 或 `{all:true}` | `{ok}` |
| GET | `/`、`/assets/*` | — | 内嵌静态资源 |

说明：
- `list` 服务端**不排序、不过滤隐藏文件**（前端做），但**永远排除 `.kfm-trash`**；`mtime` 为 unix 毫秒。
- 剪贴板语义由前端维护（`{mode, srcPath, names[]}`），服务端无状态；粘贴时才调 copy/move。
- 所有写操作为同步请求，前端显示 loading 遮罩。

## 6. 后端设计要点

### 6.1 路径安全（internal/fs/root.go）
- `Resolve(rel)`：拒绝绝对路径与 `..`（lexical 清洗）→ 拼 root → `EvalSymlinks` → 校验结果仍在 root 内。
- 目标不存在时（rename 目标、mkdir 等）对其**父目录**做上述校验。
- 整个程序**不 exec 任何外部命令**（除启动时 best-effort 打开浏览器），无注入面。

### 6.2 防护中间件
- `Host` 头校验：仅允许 `localhost:port` / `127.0.0.1:port` / `[::1]:port`，其余 403（一行代码防 DNS rebinding）。

### 6.3 操作语义（ops.go）
- **冲突自动改名**：`名字 (2).ext`、`名字 (3).ext` … 直到无冲突；新建/重命名不自动改名而是报错（避免用户误覆盖意图）。
- **copy**：文件 `io.Copy`（保留 mode），目录 `os.CopyFS`。
- **move**：`os.Rename`；跨设备（`EXDEV`）降级为 copy+delete；移动目录到自身子目录 → 拒绝。
- **delete**：一次请求 = 回收站一条记录（一个批次 id），恢复时整批回来；`permanent` 直接 `RemoveAll`。

### 6.4 回收站（trash.go）
```
<root>/.kfm-trash/
  └── <unixnano-hex>/        # 批次 id
      ├── meta.json          # {"path":"docs","time":...,"names":[...]}
      ├── a.txt              # 被移入的原条目（保持原名）
      └── sub/
```
- 恢复：读 meta.json → 原目录不存在则重建 → 逐项 rename 回去（冲突自动改名）。
- 列出：遍历 `.kfm-trash` 一层，读各 meta.json。
- 清空：`RemoveAll` 各批次。

### 6.5 搜索（search.go）
- `filepath.WalkDir` 从当前目录递归；unicode 大小写不敏感的**文件名包含匹配**。
- 硬上限 500 条结果（`truncated:true` 提示有更多）；`context` 8 秒超时保护。
- MVP 顺序遍历即可；超大目录性能不足时再引入并发 walker（记入风险项）。

## 7. 前端设计

### 7.1 状态模型（app.js，无框架，单一 state 对象）
```js
state = {
  tabs: [{ id, path, history[], histIdx, search:{active,query,results} }],
  activeTabId,
  sort: { key: 'name'|'size'|'mtime'|'type', asc: true },
  showHidden: false,
  clipboard: { mode:'copy'|'cut', srcPath, names[] } | null,
  selection: Set<name>,      // 多选模式
  trash: { open, items }     // 回收站面板
}
```
- 每次目录跳转 `history.pushState({tabId, path})`；`popstate` 恢复对应标签的路径 → **Android 返回手势 = 返回上级**。
- localStorage 持久化 `tabs/sort/showHidden`（key: `kfm-state`）。

### 7.2 页面布局（自上而下）
```
┌────────────────────────────────────┐
│ [docs ×] [photos ×] [+]            │ ① 标签栏（横向滚动，标签显示当前目录名）
├────────────────────────────────────┤
│ ‹  ›  storage › docs › notes  👁 🔍 ⋯ │ ② 工具栏（面包屑横向滚动）
├────────────────────────────────────┤
│ (名称↑) (大小) (修改时间) (类型)     │ ③ 排序 chips（当前项带箭头）
├────────────────────────────────────┤
│ 📁 子文件夹                        │ ④ 文件列表
│    09-16 14:30                     │    目录：第二行只显时间
│ 📄 笔记.md                         │    文件：大小 · 时间
│    2.1 KB · 09-15 20:11            │
├────────────────────────────────────┤
│ 已复制 3 项    [粘贴] [清空]        │ ⑤ 粘贴栏（浮层，剪贴板非空且非多选时）
└────────────────────────────────────┘
```
- `⋯` 菜单：新建文件夹 / 新建文件 / 回收站。
- 多选模式底栏：`已选 N 项 │ 全选 │ 复制 │ 移动 │ 删除 │ ✕`。

### 7.3 交互规格
- **单击目录** → 进入；**单击文件** → 底部操作面板（详情 / 重命名 / 复制 / 移动 / 删除）。
- **长按任意条目** → 进入多选模式并选中该项；多选中单击 = 切换选中（`user-select:none` + 屏蔽 contextmenu，避免系统长按菜单干扰）。
- **复制/移动** → 填充剪贴板、退出多选、底部出现粘贴栏；切到目标目录（可跨标签）点「粘贴」。粘贴后：复制保留剪贴板可重复粘贴，移动清空剪贴板。
- **删除** → 确认框（移入回收站 / 永久删除）。
- **面包屑**每段可点，直接跳转该层级。
- **搜索**：点 🔍 后面包屑行变为输入框 + 取消；**300ms 防抖** + `AbortController` 取消上一次请求；结果行显示 `文件名` + 相对路径副标题；点目录结果进入该目录，点文件结果跳到其父目录并短暂高亮该行；排序对结果同样生效。
- **排序 chips**：点未激活项切字段，点激活项反转方向；目录永远排前。
- 所有操作结果用 toast 反馈（成功/失败 + 服务端中文错误消息）；列表加载中显示 spinner；空目录显示「空文件夹」。

### 7.4 排序与过滤（纯前端）
- 名称：`Intl.Collator('zh-Hans-CN', {numeric:true, sensitivity:'base'})` → 拼音序 + 数字自然序（`2.txt < 10.txt`）；构造失败时降级 `'zh'` → 默认 locale。
- 大小：字节（目录按 0 参与比较）；时间：mtime；类型：扩展名（无扩展名排最前），平手再按名称。
- 隐藏文件：默认隐藏，开关即时过滤（列表来自同一份数据，无需重新请求）。

### 7.5 性能与移动端细节
- 大目录**分块渲染**：每批 200 行，列表底部哨兵（IntersectionObserver）触发下一批。
- `<meta viewport>` + `viewport-fit=cover`；`env(safe-area-inset-*)` 适配刘海/手势条。
- 触摸目标 ≥ 44px；列表行高 ~56px；`theme-color` 随深浅色切换。
- `touch-action: manipulation` 消除 300ms 点击延迟；事件全部用委托挂在列表容器上。

## 8. 里程碑划分（每阶段独立可验收）

| # | 内容 | 验收标准 |
|---|---|---|
| M0 骨架 | go.mod、embed、HTTP 服务、`/api/list`、最小前端（标签栏+面包屑+列表+隐藏开关） | 手机浏览器打开能浏览目录、进入/返回、开关隐藏文件 |
| M1 导航 | 标签新建/关闭/切换/持久化、前进后退、pushState 返回手势 | 重启页面标签与位置恢复；Android 返回手势=上级目录 |
| M2 排序 | 4 字段 chips、升降序、目录优先、拼音排序 | 中文按拼音、数字自然序，切换零延迟 |
| M3 基础操作 | 新建文件夹/文件、重命名（含操作面板、输入对话框） | 手机上完成一次新建+重命名，错误有 toast |
| M4 多选与剪贴板 | 长按多选、批量复制/移动、粘贴栏 | 跨标签复制粘贴一批文件成功，重名自动改名 |
| M5 删除与回收站 | 删除确认框、`.kfm-trash`、恢复/彻底删除/清空面板 | 删→回收站→恢复全流程可用 |
| M6 搜索 | 搜索 API + 防抖 UI + 结果交互 | 输入即出递归结果，点结果可跳转，大量结果不卡 |
| M7 打磨 | toast/空状态/深色模式/自动开浏览器/README/单元测试 | 真机整体流畅，`go test ./...` 通过 |

## 9. 边界情况与对策

| 情况 | 对策 |
|---|---|
| `..`、绝对路径、URL 编码、中文/emoji/空格文件名 | 服务端 Resolve 统一校验；JSON 天然支持 unicode |
| 符号链接指向 root 外 | Resolve 时 EvalSymlinks 校验失败 → 报「无法访问」 |
| 重名冲突 | copy/move/restore 自动改名；mkdir/create/rename 报错 |
| 把目录移动进它自己的子目录 | 服务端包含性检查后拒绝 |
| 非法名（空、含 `/`、`.`、`..`） | 服务端校验，中文报错 |
| 操作时目标已被其他方式删除 | 返回错误 → toast，列表刷新后自动一致 |
| 剪贴板源目录在粘贴前被关标签/切走 | 剪贴板存 `srcPath+names`，粘贴时服务端再验证存在性 |
| 超大目录列表 | 前端分块渲染 |
| 超深/超大搜索 | 500 条上限 + 8s 超时 + truncated 标记 |
| 端口被占用 | 明确报错并提示 `-addr` 换端口 |
| 恢复时原目录已被删 | 自动重建原目录 |
| `.kfm-trash` | 服务端列表永远排除，用户不可见误操作 |

## 10. 风险与备选方案

| 风险 | 评估 | 备选 |
|---|---|---|
| `Intl.Collator('zh')` 个别浏览器不可用 | 低（Android Chrome 内置 ICU） | 一行降级链 `'zh-Hans-CN'`→`'zh'`→默认 |
| `os.CopyFS` 对特殊文件（fifo/socket）处理 | 低（日常文件场景不涉及） | 失败时返回明确错误 |
| 大体积复制无进度条（同步阻塞） | 中 | MVP 接受 loading 遮罩；后续可改「任务 + 轮询」模型 |
| Termux 被系统休眠杀进程 | 低 | 前端 localStorage 已存状态，重开即恢复 |
| WalkDir 顺序搜索在巨目录慢 | 中 | 已有超时兜底；必要时加并发 walker |

## 11. 构建与运行

```bash
# 方式零：重新构建前端（仅改了 frontend/ 源码时需要；产物已提交在 internal/server/web）
cd frontend && npm install && npm run build

# 方式一：Termux 内直接构建（pkg install golang）
go build . && ./kfm

# 方式二：Windows 交叉编译（PowerShell，产物传到手机）
$env:CGO_ENABLED=0; $env:GOOS='linux'; $env:GOARCH='arm64'
go build -o kfm .
# 32 位旧设备：$env:GOARCH='arm'

# 运行（在想要作为 root 的目录里执行）
./kfm                    # 默认 127.0.0.1:8080，自动打开浏览器
./kfm -addr 127.0.0.1:9000 -open=false
```

产物为单个静态二进制（约 8–10 MB，含前端资源）。

## 12. 明确不做（Out of Scope）

文件预览/编辑、termux-open 外部打开、压缩解压、权限管理、上传下载、局域网访问与鉴权、多语言、虚拟列表、回收站自动清理策略。以上均可在当前架构上增量扩展。

## 13. 工作量估算

- Go：~900 行（fs ~600 / server ~250 / main ~60）
- 前端：JS ~750 行 + CSS ~300 行 + HTML ~80 行
- 合计约 2000 行；M0–M7 每个里程碑均可在独立提交中完成并真机验收。

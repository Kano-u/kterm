# kfm 开发任务清单（Tasks）

> 依据 `PLAN.md` 拆分为 8 个里程碑（M0–M7），每个里程碑内含具体任务与验收标准。
> 按顺序完成，每个里程碑结束时项目均可构建、可真机验收、可独立提交。

---

## M0 项目骨架与最小可浏览 UI

**目标：手机浏览器能浏览目录、进入/返回、切换隐藏文件。**

### 后端
- [x] T0.1 初始化项目：创建 `go.mod`（`module kfm`，go 1.27+），确认 Go 1.23+ 可用（需要 `os.CopyFS`）
- [x] T0.2 实现 `internal/fs/root.go`：启动时 `os.Getwd()` + `filepath.EvalSymlinks` 固化 root；实现 `Resolve(rel)` —— 拒绝绝对路径与 `..`（lexical 清洗）→ 拼 root → EvalSymlinks → 校验仍在 root 内；目标不存在时对其父目录校验
- [x] T0.3 实现 `internal/fs/list.go`：读目录返回 `entries[]`（name/isDir/size/mtime unix 毫秒），**排除 `.kfm-trash`**，不排序不过滤隐藏文件
- [x] T0.4 实现 `internal/server/server.go`：
  - 路由：`GET /api/list`、`GET /`、`GET /assets/{path...}`（go:embed `web/`）
  - Host 校验中间件：仅允许 `localhost:port` / `127.0.0.1:port` / `[::1]:port`，其余 403
- [x] T0.5 实现 `internal/server/handlers.go`：`GET /api/list?path=` 处理器，统一错误格式 `{"error":"中文错误消息"}`（4xx/5xx）
- [x] T0.6 实现 `main.go`：`-addr`（默认 `127.0.0.1:8080`）、`-open` flag；启动服务；best-effort 调 `termux-open-url` 打开浏览器（失败忽略），终端打印 URL

### 前端
- [x] T0.7 编写 `web/index.html`：`<meta viewport>` + `viewport-fit=cover`、`theme-color`、引入 css/js
- [x] T0.8 编写 `web/style.css` 基础框架：CSS 变量、深色模式（`prefers-color-scheme`）、`touch-action: manipulation`、`env(safe-area-inset-*)`、触摸目标 ≥44px、行高 ~56px
- [x] T0.9 编写 `web/app.js` 最小版：单一 state 对象（tabs / activeTabId / showHidden）、加载目录列表渲染（emoji 图标 📁📄🖼️ 按类型区分）、面包屑（每段可点跳转）、隐藏文件开关、空目录显示「空文件夹」、错误 toast

### 验收
- [x] 手机浏览器打开能浏览 CWD、进入子目录、面包屑返回、隐藏文件开关生效
- [x] 构造 `..`/绝对路径请求，API 返回错误；外部 Host 访问返回 403

---

## M1 标签页与导航历史

**目标：标签可新建/关闭/切换并持久化；Android 返回手势 = 返回上级。**

- [x] T1.1 标签栏 UI：横向滚动、显示当前目录名、`[+]` 新建、`×` 关闭（至少保留一个标签）
- [x] T1.2 每 tab 数据结构 `{id, path, history[], histIdx, search:{active,query,results}}`；新建/关闭/切换逻辑；工具栏 `‹ ›` 前进/后退按钮
- [x] T1.3 `history.pushState({tabId, path})` + `popstate` 处理：返回手势恢复对应 tab 的上一路径
- [x] T1.4 localStorage 持久化（key `kfm-state`）：保存 `tabs/sort/showHidden`，启动时恢复（若恢复的路径已不存在则回退到 root）
- [x] T1.5 标签切换即时刷新列表，不重新请求已缓存路径（可选优化，至少保证正确性）

### 验收
- [x] 新建多个标签各自独立浏览；刷新页面后标签与位置恢复
- [x] Android 返回手势等价于返回上级目录

---

## M2 排序（纯前端）

**目标：4 字段排序、升降序切换、目录永远在前、中文拼音序，零延迟。**

- [x] T2.1 排序 chips UI：名称/大小/修改时间/类型，当前项带箭头；点未激活项切字段、点激活项反转方向
- [x] T2.2 实现 collator 降级链：`Intl.Collator('zh-Hans-CN',{numeric:true,sensitivity:'base'})` → `'zh'` → 默认 locale（try/catch）
- [x] T2.3 各字段比较器：名称（拼音+数字自然序）、大小（目录按 0）、mtime、类型（扩展名，无扩展名排最前，平手按名称）；**目录永远排前**
- [x] T2.4 隐藏文件过滤与排序共用同一份数据，切换即时生效，无需重新请求

### 验收
- [x] 中文名按拼音、`2.txt < 10.txt` 自然序；排序切换无网络请求、零延迟

---

## M3 基础文件操作

**目标：手机上完成一次新建文件夹/文件 + 重命名，错误有 toast。**

### 后端
- [x] T3.1 `internal/fs/ops.go` 名称校验函数：拒绝空名、含 `/`、`.`、`..`
- [x] T3.2 实现 `mkdir` / `create`（新建空文件）/ `rename`：遇重名**直接报错**（中文错误消息）
- [x] T3.3 handlers：`POST /api/mkdir`、`POST /api/create`、`POST /api/rename`（请求体 `{path,name}` / `{path,oldName,newName}`）

### 前端
- [x] T3.4 `⋯` 菜单：新建文件夹 / 新建文件 / 回收站（回收站项本阶段可占位）
- [x] T3.5 通用输入对话框组件（含 loading 遮罩）；所有写操作为同步请求 + loading
- [x] T3.6 单击文件 → 底部操作面板（详情：大小/时间；重命名入口）；重命名预填原名
- [x] T3.7 操作成功/失败 toast（显示服务端中文错误），成功后刷新列表

### 验收
- [x] 新建文件夹/文件、重命名全流程可用；重名时报错 toast；非法名被服务端拒绝

---

## M4 多选与剪贴板（复制/移动）

**目标：跨标签复制粘贴一批文件成功，重名自动改名。**

### 后端
- [ ] T4.1 实现冲突自动改名 `名字 (2).ext` 递增（copy/move 共用）
- [ ] T4.2 copy：文件 `io.Copy`（保留 mode），目录 `os.CopyFS`；move：`os.Rename`，跨设备（EXDEV）降级 copy+delete；拒绝把目录移入自身子目录（包含性检查）
- [ ] T4.3 handlers：`POST /api/copy`、`POST /api/move`（`{srcPath, names[], destPath}`），逐项执行并汇总结果

### 前端
- [ ] T4.4 长按条目进入多选模式（`user-select:none`、屏蔽 `contextmenu`）；多选中单击 = 切换选中；选中样式
- [ ] T4.5 多选底栏：`已选 N 项 │ 全选 │ 复制 │ 移动 │ 删除 │ ✕`（删除本阶段可占位）
- [ ] T4.6 剪贴板状态 `{mode:'copy'|'cut', srcPath, names[]}`；复制/移动后退出多选、底部出现粘贴栏 `已复制/剪切 N 项 [粘贴][清空]`；支持跨标签粘贴
- [ ] T4.7 粘贴：调 copy/move API → toast 结果 → 刷新列表；移动后清空剪贴板，复制保留可重复粘贴

### 验收
- [ ] 长按多选 → 复制 → 切到另一标签粘贴成功；目录整体复制成功；同名自动改名 `x (2).ext`；目录移入自身被拒绝

---

## M5 删除与回收站

**目标：删 → 回收站 → 恢复全流程可用。**

### 后端
- [ ] T5.1 `internal/fs/trash.go`：
  - 移入：`<root>/.kfm-trash/<unixnano-hex>/`，`meta.json` 记 `{path, time, names[]}`，条目按原名移入批次目录
  - 列出：遍历一层批次读 meta.json
  - 恢复：原目录不存在则重建 → 逐项 rename 回去（冲突自动改名）
  - 清空/彻底删除：`RemoveAll`
- [ ] T5.2 handlers：`POST /api/delete`（`mode:"trash"|"permanent"`）、`GET /api/trash`、`POST /api/trash/restore`（`{ids[]}`）、`POST /api/trash/purge`（`{ids[]}` 或 `{all:true}`）

### 前端
- [ ] T5.3 删除确认框：主按钮「移入回收站」+ 红色破坏性按钮「永久删除」
- [ ] T5.4 接通多选底栏「删除」与单文件操作面板「删除」
- [ ] T5.5 回收站面板（`⋯` 菜单进入）：列出 `{time, path, names[]}`，支持恢复（整批）、彻底删除（整批）、清空全部；操作后 toast + 刷新

### 验收
- [ ] 删除 → 回收站面板可见 → 恢复到原位置（原目录被删也能恢复）；永久删除、清空可用；列表永远不出现 `.kfm-trash`

---

## M6 搜索

**目标：输入即出递归结果，点结果可跳转，大量结果不卡。**

### 后端
- [ ] T6.1 `internal/fs/search.go`：`filepath.WalkDir` 从当前目录递归；unicode 大小写不敏感文件名包含匹配；上限 500 条（`truncated:true`）；`context` 8 秒超时
- [ ] T6.2 handler：`GET /api/search?path=&q=`

### 前端
- [ ] T6.3 搜索 UI：点 🔍 后面包屑行切换为输入框 + 取消按钮
- [ ] T6.4 300ms 防抖 + `AbortController` 取消上一次请求；结果行显示文件名 + 相对路径副标题
- [ ] T6.5 结果交互：点目录结果进入该目录；点文件结果跳到其父目录并短暂高亮该行；排序对结果同样生效；显示 truncated 提示

### 验收
- [ ] 输入即搜索、连续输入不发出冗余请求；结果跳转正确；深层大目录 8 秒内兜底返回

---

## M7 打磨与交付

**目标：真机整体流畅，`go test ./...` 通过，交付 README。**

- [ ] T7.1 大目录分块渲染：每批 200 行，列表底部哨兵（IntersectionObserver）触发下一批
- [ ] T7.2 事件全部委托挂列表容器；检查触摸目标/安全区/深色模式细节；`theme-color` 随深浅色切换
- [ ] T7.3 toast / loading spinner / 空状态统一组件化，清理交互边角
- [ ] T7.4 单元测试（`internal/fs` 为主）：
  - Resolve 越界防护（`..`、绝对路径、symlink 出界）
  - 冲突自动改名递增
  - copy/move/delete/restore 往返
  - 名称校验、搜索上限与匹配
- [ ] T7.5 端口占用错误明确提示 `-addr`；验证 flag `-addr` / `-open=false`
- [ ] T7.6 交叉编译验证（Windows PowerShell）：`CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o kfm .`
- [ ] T7.7 编写 `README.md`：功能简介、构建（Termux 内 / 交叉编译）、运行参数、API 一览、回收站机制说明
- [ ] T7.8 真机整体回归：按 PLAN.md 各里程碑验收标准过一遍

### 验收
- [ ] `go test ./...` 全绿
- [ ] 真机浏览/操作流畅，单二进制约 8–10 MB 部署即用

---

## 依赖关系与提交建议

```
M0 ──► M1 ──► M2 ──► M3 ──► M4 ──► M5 ──► M6 ──► M7
                │           │
                │           └── 回收站 API 依赖 ops.go 的改名/移动逻辑
                └── 排序/过滤独立于写操作，可与 M3 并行
```

- 每个里程碑完成即独立 commit（M0–M7 共 8 个提交），commit message 建议 `M0: skeleton with list API and minimal UI` 风格。
- 后端测试（T7.4）可随 M0–M6 各步陆续补充，M7 只做汇总补齐。
- 预估总量：Go ~900 行 + 前端 ~1100 行 ≈ 2000 行。

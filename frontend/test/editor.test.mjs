/* 编辑器会话的无依赖回归测试（纯 node）：
 *   cd frontend && node test/editor.test.mjs
 *
 * 覆盖：
 *   1. 换行风格：detectEOL / normalizeEOL / applyEOL（CRLF 原样写回）；
 *   2. 文本类型判定 isTextName（放行源码、拒绝图片/压缩包/二进制）；
 *   3. 会话生命周期：openEditor 读文件 → dirty → saveEditor 写回（带 mtime）→
 *      409 冲突三选一 → reloadEditor 丢弃修改；
 *   4. dirty 判定：编辑后为 true，保存后为 false，重新打开/重载复位；
 *   5. 关闭：closeEditor 丢弃会话，anyDirty 反映全局状态。
 *
 * 用假 fetch 模拟 /api/read、/api/write；用假 CM 会话（getText/markSaved）代替
 * 真实 CodeMirror 实例——editor.js 与 CM 之间只通过这几个钩子交互。
 */
const { detectEOL, normalizeEOL, applyEOL, isTextName, HIGHLIGHT_MAX } = await (async () => ({
  ...(await import('../src/editor-lang.js')),
  ...(await import('../src/editor.js')),
}))()

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}

/* 等确认框弹出（fetch / 错误处理跨多个微任务轮次） */
async function waitConfirm() {
  for (let i = 0; i < 50; i++) {
    if (confirmState.show) return true
    await new Promise((r) => setTimeout(r, 0))
  }
  return false
}

/* ---------- 1. 换行风格 ---------- */
{
  assert(detectEOL('a\r\nb') === '\r\n', 'CRLF 文件识别为 CRLF')
  assert(detectEOL('a\nb') === '\n', 'LF 文件识别为 LF')
  assert(detectEOL('') === '\n', '空文件默认 LF')
  assert(normalizeEOL('a\r\nb\rc\nd') === 'a\nb\nc\nd', '归一：CRLF 与孤立 CR 都变 LF')
  assert(applyEOL('a\nb', '\r\n') === 'a\r\nb', '写回：LF → CRLF')
  assert(applyEOL('a\nb', '\n') === 'a\nb', '写回：LF 保持不变')
  assert(applyEOL(normalizeEOL('a\r\nb'), '\r\n') === 'a\r\nb', '往返：CRLF 原样保留')
}

/* ---------- 2. 文本类型判定 ---------- */
{
  const yes = ['a.js', 'b.ts', 'c.go', 'd.py', 'e.md', 'f.json', 'g.html', 'h.css',
    'i.txt', 'j.log', 'k.yaml', 'l.toml', 'm.sh', 'Makefile', 'Dockerfile', '.gitignore',
    'n.cpp', 'o.rs', 'p.sql', 'q.xml']
  const no = ['a.png', 'b.jpg', 'c.gif', 'd.zip', 'e.tar.gz', 'f.exe', 'g.pdf',
    'h.mp4', 'i.woff2', 'j.sqlite', 'k.so', 'noext']
  for (const n of yes) assert(isTextName(n) === true, `${n} 可编辑`)
  for (const n of no) assert(isTextName(n) === false, `${n} 不可编辑`)
}

/* ---------- 假环境 ---------- */
/* 最小 history 模拟（enterEditorView 会 pushState 以支持返回手势） */
globalThis.history = {
  stack: [{ tabId: 1, path: '' }],
  i: 0,
  get state() {
    return this.stack[this.i]
  },
  pushState(s) {
    this.stack = this.stack.slice(0, this.i + 1)
    this.stack.push(s)
    this.i++
  },
  replaceState(s) {
    this.stack[this.i] = s
  },
  back() {
    if (this.i > 0) this.i--
  },
}

const { state } = await import('../src/store.js')
const { confirmState, closeConfirm } = await import('../src/confirm.js')
const api = await import('../src/editor.js')

/* 磁盘模型：path -> {content, mtime} */
const disk = new Map()
let writes = []
let readCalls = 0

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url, 'http://localhost')
  if (u.pathname === '/api/read') {
    readCalls++
    const f = disk.get(u.searchParams.get('path'))
    if (!f) return json({ error: '路径不存在' }, 404)
    return json({ content: f.content, mtime: f.mtime, size: f.content.length })
  }
  if (u.pathname === '/api/write') {
    const body = JSON.parse(opts.body)
    const f = disk.get(body.path)
    if (!f) return json({ error: '路径不存在' }, 404)
    if (f.mtime !== body.mtime) return json({ error: '文件已被其他程序修改' }, 409)
    writes.push(body)
    const next = { content: body.content, mtime: f.mtime + 1 }
    disk.set(body.path, next)
    return json({ ok: true, mtime: next.mtime })
  }
  return json({ error: '未知端点' }, 404)
}
function json(obj, status = 200) {
  return { ok: status < 400, status, json: async () => obj }
}

/* 模拟 EditorView 挂载：给会话装上 CM 钩子（此处用纯文本字符串代替 CM 文档） */
function attach(docText) {
  const e = state.editors.get(1)
  let text = docText
  let orig = docText
  e.getText = () => text
  e.applyDoc = (t) => {
    text = t
    orig = t
    e.text = t
    e.dirty = false
  }
  e.markSaved = () => {
    orig = text
  }
  return {
    type: (t) => {
      text = t
      e.dirty = t !== orig
    },
  }
}

function reset() {
  state.editors.clear()
  state.tabs = [{ id: 1, path: '', history: [''], histIdx: 0, cache: null, loading: false }]
  state.activeTabId = 1
  state.view = 'files'
  disk.clear()
  writes = []
  readCalls = 0
}

/* ---------- 3. 会话生命周期 ---------- */
{
  reset()
  disk.set('a.txt', { content: 'line1\r\nline2\r\n', mtime: 1000 })
  const ok = await api.openEditor(state.tabs[0], { name: 'a.txt', isDir: false })
  assert(ok === true, '打开文本文件成功')
  assert(state.view === 'editor', '打开后进入编辑视图')
  const e = api.activeEditor()
  assert(e && e.relPath === 'a.txt' && e.name === 'a.txt', '会话指向正确文件')
  assert(e.text === 'line1\nline2\n', '读入内容已归一为 LF')
  assert(e.eol === '\r\n', '记录原文件换行风格为 CRLF')
  assert(e.dirty === false, '刚打开不 dirty')

  const cm = attach(e.text)
  cm.type('line1\nline2\nline3\n')
  assert(e.dirty === true, '编辑后 dirty')
  assert(api.anyDirty() === true, 'anyDirty 反映全局')

  const saved = await api.saveEditor(1)
  assert(saved === true, '保存成功')
  assert(e.dirty === false, '保存后 dirty 清除')
  assert(writes.length === 1 && writes[0].mtime === 1000, '写回带上打开的 mtime')
  assert(writes[0].content === 'line1\r\nline2\r\nline3\r\n', 'CRLF 原样写回（不产生 diff 噪音）')
  assert(e.modTime === 1001, '保存后记录新 mtime')

  // 二次保存应带新 mtime
  cm.type('x\n')
  await api.saveEditor(1)
  assert(writes[1].mtime === 1001, '二次保存用新 mtime')
}

/* ---------- 4. 只读模式下不可保存 ---------- */
{
  reset()
  disk.set('a.txt', { content: 'v1', mtime: 10 })
  await api.openEditor(state.tabs[0], { name: 'a.txt', isDir: false })
  const e = api.activeEditor()
  attach(e.text).type('v2')
  api.toggleReadOnly(1)
  assert(api.editorReadOnly(1) === true, '只读标记已开')
  const ok = await api.saveEditor(1)
  assert(ok === false && writes.length === 0, '只读模式拒绝保存')
  api.toggleReadOnly(1)
}

/* ---------- 5. mtime 冲突：重新加载（丢弃当前修改） ---------- */
{
  reset()
  disk.set('a.txt', { content: 'v1', mtime: 10 })
  await api.openEditor(state.tabs[0], { name: 'a.txt', isDir: false })
  const e = api.activeEditor()
  attach(e.text).type('local edit')
  // 外部改写
  disk.set('a.txt', { content: 'external', mtime: 99 })

  const p = api.saveEditor(1)
  assert(await waitConfirm(), '冲突时弹出三选一确认框')
  closeConfirm(true) // 重新加载
  const ok = await p
  assert(ok === false, '重新加载不落盘')
  assert(e.text === 'external', '重新加载后内容为磁盘版本')
  assert(e.dirty === false, '重新加载清除 dirty')
  assert(e.modTime === 99, '重新加载更新 mtime')
  assert(writes.length === 0, '未发生写入')
}

/* ---------- 6. mtime 冲突：覆盖保存 ---------- */
{
  reset()
  disk.set('a.txt', { content: 'v1', mtime: 10 })
  await api.openEditor(state.tabs[0], { name: 'a.txt', isDir: false })
  const e = api.activeEditor()
  attach(e.text).type('mine')
  disk.set('a.txt', { content: 'external', mtime: 99 })

  const p = api.saveEditor(1)
  await waitConfirm()
  closeConfirm('danger') // 覆盖保存
  const ok = await p
  assert(ok === true, '覆盖保存成功')
  assert(writes.length === 1 && writes[0].content === 'mine', '写入的是本地内容')
  assert(writes[0].mtime === 99, '覆盖时使用磁盘最新 mtime')
}

/* ---------- 7. mtime 冲突：取消 ---------- */
{
  reset()
  disk.set('a.txt', { content: 'v1', mtime: 10 })
  await api.openEditor(state.tabs[0], { name: 'a.txt', isDir: false })
  const e = api.activeEditor()
  attach(e.text).type('mine')
  disk.set('a.txt', { content: 'external', mtime: 99 })

  const p = api.saveEditor(1)
  await waitConfirm()
  closeConfirm(false) // 取消
  const ok = await p
  assert(ok === false, '取消不落盘')
  assert(e.dirty === true, '取消后仍保持 dirty（改动未丢）')
  assert(writes.length === 0, '未发生写入')
}

/* ---------- 8. requestReload 先确认 ---------- */
{
  reset()
  disk.set('a.txt', { content: 'v1', mtime: 10 })
  await api.openEditor(state.tabs[0], { name: 'a.txt', isDir: false })
  const e = api.activeEditor()
  attach(e.text).type('dirty edit')

  let p = api.requestReload(1)
  assert(await waitConfirm(), '重载前提示未保存修改')
  closeConfirm(false) // 拒绝丢弃
  assert((await p) === false, '拒绝后不重载')
  assert(e.dirty === true, '拒绝后改动保留')

  disk.set('a.txt', { content: 'v2', mtime: 20 })
  p = api.requestReload(1)
  assert(await waitConfirm(), '再次提示')
  closeConfirm(true) // 同意
  assert((await p) === true, '同意后重载')
  assert(e.text === 'v2' && e.dirty === false, '重载后为磁盘内容且不 dirty')
}

/* ---------- 9. closeEditor / dropEditor / 会话替换 ---------- */
{
  reset()
  disk.set('a.txt', { content: 'v1', mtime: 10 })
  disk.set('b.txt', { content: 'bb', mtime: 11 })
  await api.openEditor(state.tabs[0], { name: 'a.txt', isDir: false })
  attach(api.activeEditor().text).type('dirty')

  // 打开另一个文件要先确认（有未保存改动）
  let p = api.openEditor(state.tabs[0], { name: 'b.txt', isDir: false })
  assert(await waitConfirm(), '换文件前提示放弃修改')
  closeConfirm(false)
  assert((await p) === false, '取消则不换文件')
  assert(api.activeEditor().name === 'a.txt', '仍是原文件')

  p = api.openEditor(state.tabs[0], { name: 'b.txt', isDir: false })
  await waitConfirm()
  closeConfirm(true)
  assert((await p) === true, '确认后切换文件')
  assert(api.activeEditor().name === 'b.txt', '会话已指向新文件')
  assert(api.activeEditor().dirty === false, '新会话不 dirty')

  // 关闭（无 dirty，不问）
  assert((await api.closeEditor(1)) === true, '关闭编辑器会话')
  assert(api.isEditorOpen(1) === false, '会话已移除')
  assert(state.view === 'files', '关闭后回到文件视图')

  // 有 dirty 时关闭要确认
  await api.openEditor(state.tabs[0], { name: 'a.txt', isDir: false })
  attach(api.activeEditor().text).type('dirty again')
  p = api.closeEditor(1)
  await waitConfirm()
  closeConfirm(false)
  assert((await p) === false, '取消则不关闭')
  assert(api.isEditorOpen(1) === true, '会话保留')

  api.dropEditor(1)
  assert(api.isEditorOpen(1) === false, 'dropEditor 静默移除')
  assert(api.anyDirty() === false, '清空后无 dirty')
}

/* ---------- 10. 非文本文件 / 目录拒绝 ---------- */
{
  reset()
  disk.set('a.png', { content: 'x', mtime: 1 })
  assert((await api.openEditor(state.tabs[0], { name: 'a.png', isDir: false })) === false, '图片拒绝编辑')
  assert((await api.openEditor(state.tabs[0], { name: 'dir', isDir: true })) === false, '目录拒绝编辑')
  assert(state.editors.size === 0, '未建立任何会话')
}

/* ---------- 11. 服务端错误（二进制 / 过大）原样透传 ---------- */
{
  reset()
  disk.set('bin.dat', { content: 'x', mtime: 1 })
  const orig = globalThis.fetch
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url, 'http://localhost')
    if (u.pathname === '/api/read') return json({ error: '二进制文件不支持编辑' }, 400)
    return orig(url, opts)
  }
  assert((await api.openEditor(state.tabs[0], { name: 'bin.dat', isDir: false })) === false, '读取失败不建会话')
  assert(state.editors.size === 0, '无会话残留')
  globalThis.fetch = orig
}

/* ---------- 12. 大文件关闭高亮 ---------- */
{
  reset()
  const big = 'a'.repeat(HIGHLIGHT_MAX + 1)
  disk.set('big.txt', { content: big, mtime: 1 })
  await api.openEditor(state.tabs[0], { name: 'big.txt', isDir: false })
  assert(api.activeEditor().highlight === false, '超过 512KB 关闭语法高亮')
  reset()
  disk.set('small.txt', { content: 'x', mtime: 1 })
  await api.openEditor(state.tabs[0], { name: 'small.txt', isDir: false })
  assert(api.activeEditor().highlight === true, '小文件开启语法高亮')
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')

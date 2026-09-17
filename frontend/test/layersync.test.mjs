/* 视图层同步注册时机的无依赖回归测试（纯 node）：
 *   cd frontend && node test/layersync.test.mjs
 *
 * 锁住的契约：懒挂载组件（EditorView 的 v-if）必须在 onMounted 时主动同步一次。
 *
 * 背景 bug：EditorView 只在 `state.editors.size > 0` 时挂载，而 openEditor 在挂载
 * 前就已把 state.view 置为 'editor'。若只注册 watch（无 immediate），组件挂载后
 * 依赖值早已稳定、不会再变化 → 同步永不执行 → 层不建 → 界面停在「正在打开编辑器…」。
 */
const { installLayerSync } = await import('../src/layersync.js')

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}

/* ---------- 模拟 Vue 的 onMounted / watch ---------- */
function harness() {
  const mounted = []
  const watchers = [] // {src, fn, opts}
  const api = {
    onMounted: (fn) => mounted.push(fn),
    watch: (src, fn, opts) => watchers.push({ src, fn, opts }),
  }
  return {
    api,
    mounted,
    watchers,
    /* 模拟组件挂载完成 */
    mount: () => mounted.forEach((fn) => fn()),
  }
}

/* ---------- 1. 挂载即同步（核心契约） ---------- */
{
  const h = harness()
  const calls = []
  let view = 'editor' // 挂载前视图已是 editor（关键前提）
  const sync = () => calls.push('sync:' + view)
  installLayerSync({
    ...h.api,
    keys: () => '1:a.txt',
    deps: () => [view, 1],
    sync,
  })
  assert(h.mounted.length === 1, '注册了 1 个 onMounted 同步')
  assert(h.watchers.length === 2, '注册了 2 个 watch（键 + 依赖）')
  assert(calls.length === 0, '挂载前不执行同步（组件还未挂载）')
  h.mount()
  assert(calls.length === 1, '挂载后立即同步一次 —— 这正是原 bug 缺失的一步')
  assert(calls[0] === 'sync:editor', '同步时视图已是 editor')
}

/* ---------- 2. 挂载后依赖变化仍走 watch ---------- */
{
  const h = harness()
  const calls = []
  let view = 'files'
  installLayerSync({
    ...h.api,
    keys: () => '1:a.txt',
    deps: () => [view, 1],
    sync: () => calls.push(view),
  })
  h.mount()
  assert(calls.length === 1, '挂载时同步（此时是 files，同步内部会因视图不符而早退）')

  // 模拟后续变化：手动触发依赖 watch
  view = 'editor'
  h.watchers[1].fn()
  assert(calls.length === 2 && calls[1] === 'editor', '依赖变化触发再次同步')
}

/* ---------- 3. 键变化也触发同步（换文件 / 关闭会话） ---------- */
{
  const h = harness()
  let key = '1:a.txt'
  const calls = []
  installLayerSync({
    ...h.api,
    keys: () => key,
    deps: () => ['editor', 1],
    sync: () => calls.push(key),
  })
  h.mount()
  key = '1:b.txt'
  h.watchers[0].fn()
  assert(calls.length === 2 && calls[1] === '1:b.txt', '会话键变化触发同步（换文件重建层）')
}

/* ---------- 4. flush 默认 'post'（等 layersEl 渲染完成） ---------- */
{
  const h = harness()
  installLayerSync({ ...h.api, keys: () => 'k', deps: () => [1], sync: () => {} })
  assert(h.watchers.every((w) => w.opts.flush === 'post'), '默认 flush 为 post（DOM ref 就绪后再建层）')

  const h2 = harness()
  installLayerSync({ ...h2.api, keys: () => 'k', deps: () => [1], sync: () => {}, flush: 'sync' })
  assert(h2.watchers.every((w) => w.opts.flush === 'sync'), 'flush 可覆盖')
}

/* ---------- 5. 返回 sync 供手动调用 ---------- */
{
  const h = harness()
  let n = 0
  const sync = installLayerSync({ ...h.api, keys: () => 'k', deps: () => [1], sync: () => n++ })
  h.mount()
  assert(n === 1, '挂载后 n=1')
  sync()
  assert(n === 2, '返回的 sync 可手动触发（异步加载完成等场景）')
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')

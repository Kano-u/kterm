/* 视图层同步的注册时机（编辑器 CM 层、终端 xterm 层共用同一契约）。
 *
 * 为什么单独抽出来：`EditorView` 由 App.vue 用
 * `defineAsyncComponent` + `v-if="state.editors.size > 0"` **懒挂载**，
 * 而 `openEditor` 在挂载之前就已经把 `state.view` 置为 `'editor'` 并写好了会话。
 * 如果只用 watch 接线，组件挂载后依赖值早已稳定、不会再变化，watch 永远不会触发
 * → 层永远建不出来，界面卡在「正在打开编辑器…」。
 *
 * 因此同步必须**同时**注册在两条时机上：
 *   1. onMounted —— 兜住「挂载前依赖就已就绪」的首次同步；
 *   2. watch     —— 负责挂载之后的所有变化。
 *
 * 本模块把这段时机逻辑抽成纯函数（Vue 原语由调用方注入），以便用纯 node 测试
 * 把该契约锁死。`installLayerSync` 返回一个 sync 手动入口，便于调用方在
 * 非响应式时机（如异步加载完成）主动同步。
 */

/**
 * @param {object} o
 * @param {(fn: () => any) => any} o.onMounted  Vue 的 onMounted
 * @param {(src: () => any, fn: () => any, opts?: object) => any} o.watch  Vue 的 watch
 * @param {() => any} o.keys  会话集合键（值变化触发同步）
 * @param {() => any} o.deps  视图 / 激活标签等依赖
 * @param {() => any} o.sync  同步函数（可 async）
 * @param {'pre'|'post'|'sync'} [o.flush]  watch 刷新时机，默认 'post'
 * @returns {() => any} 同步函数（调用方可手动触发）
 */
export function installLayerSync({ onMounted, watch, keys, deps, sync, flush = 'post' }) {
  onMounted(sync)
  watch(keys, sync, { flush })
  watch(deps, sync, { flush })
  return sync
}

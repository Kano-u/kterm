/* 按键栏（KeyboardBar）的显隐判定，供 App.vue 与 Taskbar.vue 共用。
 *
 * 行为：
 *   - 窄屏（≤ 768px）+ 终端视图 → 自动显示内置键盘，并顶替底部任务栏；
 *   - 宽屏 / 非终端视图 → 不显示，任务栏保持原样；
 *   - 右下角系统输入法入口打开时，内置键盘收起，把屏幕让给系统候选栏。
 *
 * 窄屏判定在模块里集中一处，App.vue 与 Taskbar.vue 不各自散落一个 768。
 */
import { computed } from 'vue'
import { state } from './store.js'

export const MOBILE_MAX_WIDTH = 768

/* 窄屏判定：优先 visualViewport 宽度，回退 innerWidth；测试可注入 window */
export function isNarrowViewport(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false
  const vv = win.visualViewport
  const w = vv && Number.isFinite(vv.width) ? vv.width : win.innerWidth
  return Number.isFinite(w) && w > 0 && w <= MOBILE_MAX_WIDTH
}

/* 内置键盘是否显示（显示即顶替底部任务栏） */
export const keyBarVisible = computed(
  () => state.view === 'term' && !state.imeActive && state.mobileKeyboard,
)

/* 任务栏是否应当被内置键盘顶替 */
export const taskbarVisible = computed(() => !keyBarVisible.value)

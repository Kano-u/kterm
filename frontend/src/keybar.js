/* 按键栏（KeyboardBar）的显隐判定，供 App.vue 与 Taskbar.vue 共用。
 *
 * 单点判定保证「按键栏」与「底部任务栏」不会同时出现（两者互斥地占底部）。
 *
 *   - 只在终端视图生效；keyBarMode 为 off 时始终不显示；
 *   - auto（默认）：软键盘弹出时显示并顶替底部任务栏（用户需求）；
 *     软键盘收起或检测失灵时，可用任务栏的「按键」按钮手动唤出；
 *   - always：终端视图常显并顶替任务栏，可用「收起」还原任务栏；
 *   - 粘滞修饰键按下期间（lockKeyBar）即使软键盘已收起也保留按键栏，
 *     否则用户会失去取消修饰键的入口。
 */
import { computed } from 'vue'
import { state } from './store.js'
import { settings } from './settings.js'
import { lockKeyBar } from './terminal.js'

/* 按键栏是否显示（显示即顶替底部任务栏） */
export const keyBarVisible = computed(() => {
  if (state.view !== 'term' || settings.keyBarMode === 'off') return false
  const manual = state.keyBarManual
  if (manual === true) return true // 手动唤出（含 always 模式）
  if (manual === false) return false // 手动收起
  if (settings.keyBarMode === 'always') return true
  return state.keyboardBar || lockKeyBar.value
})

/* 任务栏是否应给出「按键」唤出入口（按键栏当前没显示时才需要） */
export const keyBarHidable = computed(
  () => state.view === 'term' && settings.keyBarMode !== 'off' && !keyBarVisible.value,
)

/* 软键盘状态变化时清掉手动覆盖，让 auto 模式重新接管 */
export function resetKeyBarManual() {
  state.keyBarManual = null
}

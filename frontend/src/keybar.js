/* 按键栏（KeyboardBar）的显隐判定，供 App.vue 与 Taskbar.vue 共用。
 *
 * 单点判定保证「按键栏」与「底部任务栏」不会同时出现（两者互斥地占底部）。
 * 行为只有一种：终端视图 + 软键盘弹出时显示并顶替任务栏，软键盘收起即还原。
 * 整个键盘增强可在设置页关闭（settings.keyBarEnabled）。
 */
import { computed } from 'vue'
import { state } from './store.js'
import { settings } from './settings.js'

/* 按键栏是否显示（显示即顶替底部任务栏） */
export const keyBarVisible = computed(
  () => state.view === 'term' && settings.keyBarEnabled && state.keyboardBar,
)

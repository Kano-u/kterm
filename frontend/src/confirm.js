import { reactive } from 'vue'

/* 全局确认对话框状态（删除等破坏性操作） */
export const confirmState = reactive({
  show: false,
  title: '',
  message: '',
  dangerText: '', // 红色破坏性按钮文案；为空则不显示
  okText: '确定',
  _resolve: null,
})

/**
 * 打开确认对话框，返回 Promise<boolean>：
 * - 点主按钮（okText）→ true
 * - 点红色破坏性按钮（dangerText）→ 'danger'
 * - 取消 / 遮罩 → false
 */
export function confirm(opts) {
  return new Promise((resolve) => {
    confirmState.title = opts.title || '确认操作'
    confirmState.message = opts.message || ''
    confirmState.dangerText = opts.dangerText || ''
    confirmState.okText = opts.okText || '确定'
    confirmState._resolve = resolve
    confirmState.show = true
  })
}

export function closeConfirm(value) {
  confirmState.show = false
  if (confirmState._resolve) {
    confirmState._resolve(value)
    confirmState._resolve = null
  }
}

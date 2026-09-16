import { reactive } from 'vue'

/* 全局命名对话框状态：任何组件都可通过 ask() 唤起 */
export const dialogState = reactive({
  show: false,
  title: '',
  value: '',
  mode: 'text', // 'text' 普通（确定/取消）| 'new' 新建（文件/文件夹）
  selectBase: false,
  _resolve: null,
})

/**
 * 打开输入对话框，返回 Promise。
 * mode='text'：resolve(string|null)
 * mode='new'：resolve({name, kind:'file'|'dir'}|null)
 */
export function ask(opts) {
  return new Promise((resolve) => {
    dialogState.title = opts.title || '请输入'
    dialogState.value = opts.value || ''
    dialogState.mode = opts.mode || 'text'
    dialogState.selectBase = !!opts.selectBase
    dialogState._resolve = resolve
    dialogState.show = true
  })
}

export function closeDialog(value) {
  dialogState.show = false
  if (dialogState._resolve) {
    dialogState._resolve(value)
    dialogState._resolve = null
  }
}

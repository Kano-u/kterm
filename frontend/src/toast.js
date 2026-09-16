import { reactive } from 'vue'

export const toastState = reactive({ msg: '', show: false, type: 'error' })

let timer = null
export function toast(msg, type = 'error') {
  toastState.msg = msg
  toastState.type = type
  toastState.show = true
  clearTimeout(timer)
  timer = setTimeout(() => {
    toastState.show = false
  }, 2500)
}

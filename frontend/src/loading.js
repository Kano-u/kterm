import { reactive } from 'vue'

export const loading = reactive({ count: 0 })

export function showLoading(on) {
  loading.count += on ? 1 : -1
  if (loading.count < 0) loading.count = 0
}

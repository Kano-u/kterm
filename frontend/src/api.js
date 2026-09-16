import { showLoading } from './loading.js'

export async function apiList(path) {
  const res = await fetch('/api/list?path=' + encodeURIComponent(path))
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

/* 写操作：同步请求 + loading 遮罩 */
export async function apiOp(url, body) {
  showLoading(true)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '操作失败')
    return data
  } finally {
    showLoading(false)
  }
}

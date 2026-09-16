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

/* GET 请求（回收站列表等） */
export async function apiGet(url) {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '请求失败')
  return data
}

/* 搜索：支持 AbortController 取消上一次请求 */
export async function apiSearch(path, q, signal) {
  const res = await fetch(`/api/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}`, {
    signal,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '搜索失败')
  return data
}

import { showLoading } from './loading.js'

/* 请求失败：错误对象带上 HTTP 状态码（编辑器据此识别 409 mtime 冲突） */
function httpError(data, fallback, status) {
  const err = new Error((data && data.error) || fallback)
  err.status = status
  return err
}

export async function apiList(path) {
  const res = await fetch('/api/list?path=' + encodeURIComponent(path))
  const data = await res.json()
  if (!res.ok) throw httpError(data, '请求失败', res.status)
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
    if (!res.ok) throw httpError(data, '操作失败', res.status)
    return data
  } finally {
    showLoading(false)
  }
}

/* GET 请求（回收站列表、文件读取等） */
export async function apiGet(url) {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw httpError(data, '请求失败', res.status)
  return data
}

/* 搜索：支持 AbortController 取消上一次请求 */
export async function apiSearch(path, q, signal) {
  const res = await fetch(`/api/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}`, {
    signal,
  })
  const data = await res.json()
  if (!res.ok) throw httpError(data, '搜索失败', res.status)
  return data
}

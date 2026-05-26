/* API client for Idea Collision backend */

const BASE = ''  // Vite proxy handles /api and /ws

// ── HTTP helpers ──

export async function fetchProviders() {
  const res = await fetch(`${BASE}/api/providers`)
  if (!res.ok) throw new Error('获取模型列表失败')
  return res.json()
}

export async function startCollision(payload) {
  const res = await fetch(`${BASE}/api/collision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || '启动碰撞失败')
  }
  return res.json()
}

export async function getCollision(sessionId) {
  const res = await fetch(`${BASE}/api/collision/${sessionId}`)
  if (!res.ok) throw new Error('获取碰撞状态失败')
  return res.json()
}

export async function cancelCollision(sessionId) {
  const res = await fetch(`${BASE}/api/collision/${sessionId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('取消碰撞失败')
  return res.json()
}

export async function deleteCollision(sessionId) {
  const res = await fetch(`${BASE}/api/collision/${sessionId}/delete`, { method: 'DELETE' })
  if (!res.ok) throw new Error('删除记录失败')
  return res.json()
}

export async function listCollisions() {
  const res = await fetch(`${BASE}/api/collisions`)
  if (!res.ok) throw new Error('获取碰撞列表失败')
  return res.json()
}

export async function getKnowledgeStats(sessionId) {
  const res = await fetch(`${BASE}/api/knowledge/stats/${sessionId}`)
  if (!res.ok) return null
  return res.json()
}

export async function getKnowledgeGraph(domain = null, limit = 200) {
  let url = `${BASE}/api/knowledge/graph?limit=${limit}`
  if (domain) url += `&domain=${encodeURIComponent(domain)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('获取知识图谱失败')
  return res.json()
}

export async function exportKnowledge(format = 'json') {
  const res = await fetch(`${BASE}/api/knowledge/export?format=${format}`)
  if (!res.ok) throw new Error('导出失败')
  return res
}

export async function importKnowledge(data, mode = 'merge') {
  const res = await fetch(`${BASE}/api/knowledge/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, mode }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || '导入失败')
  }
  return res.json()
}

// ── Export API ──

export function getExportMdUrl(sessionId) {
  return `${BASE}/api/collision/${sessionId}/export/md`
}

export function getExportHtmlUrl(sessionId) {
  return `${BASE}/api/collision/${sessionId}/export/html`
}

// ── PDF API ──

export async function uploadPdfs(files) {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  const res = await fetch(`${BASE}/api/pdf/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'PDF 上传失败')
  }
  return res.json()
}

export async function listPdfs() {
  const res = await fetch(`${BASE}/api/pdf/list`)
  if (!res.ok) throw new Error('获取 PDF 列表失败')
  return res.json()
}

export async function searchPdf(q) {
  const res = await fetch(`${BASE}/api/pdf/search?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error('PDF 搜索失败')
  return res.json()
}

// ── Materials API ──

export async function getMaterials() {
  const res = await fetch(`${BASE}/api/materials`)
  if (!res.ok) throw new Error('获取素材列表失败')
  return res.json()
}

export async function uploadMaterials(files) {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  const res = await fetch(`${BASE}/api/materials/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || '素材上传失败')
  }
  return res.json()
}

export async function deleteMaterial(id) {
  const res = await fetch(`${BASE}/api/materials/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('删除素材失败')
  return res.json()
}

export async function previewMaterial(id) {
  const res = await fetch(`${BASE}/api/materials/${id}/preview`)
  if (!res.ok) throw new Error('获取预览失败')
  return res.json()
}

// ── WebSocket helper ──

export function connectCollisionWS(sessionId, handlers) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = `${protocol}//${window.location.host}/ws/collision/${sessionId}`

  let ws = null
  let reconnectTimer = null
  let closed = false
  let retryCount = 0
  const MAX_RETRIES = 5

  function connect() {
    if (closed) return
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      retryCount = 0
      handlers.onOpen?.()
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        handlers.onMessage?.(msg)
      } catch (e) {
        console.error('WS parse error:', e)
      }
    }

    ws.onclose = () => {
      if (closed) return
      // Auto-reconnect with backoff
      if (retryCount < MAX_RETRIES) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000)
        retryCount++
        reconnectTimer = setTimeout(connect, delay)
      } else {
        handlers.onClose?.()
      }
    }

    ws.onerror = (err) => {
      handlers.onError?.(err)
    }
  }

  connect()

  return {
    send(data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(typeof data === 'string' ? data : JSON.stringify(data))
      }
    },
    close() {
      closed = true
      clearTimeout(reconnectTimer)
      if (ws) ws.close()
    },
  }
}

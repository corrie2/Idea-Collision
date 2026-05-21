import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { listCollisions, getExportMdUrl, getExportHtmlUrl, deleteCollision } from '../api/client'

export default function HistoryPage() {
  const navigate = useNavigate()
  const [collisions, setCollisions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openExport, setOpenExport] = useState(null)

  useEffect(() => {
    listCollisions()
      .then((data) => setCollisions(data.collisions || []))
      .catch(() => setError('获取历史记录失败'))
      .finally(() => setLoading(false))
  }, [])

  // Auto-refresh for running collisions
  useEffect(() => {
    const hasRunning = collisions.some(c => c.status === 'running')
    if (!hasRunning) return

    const timer = setInterval(() => {
      listCollisions()
        .then((data) => setCollisions(data.collisions || []))
        .catch(() => {})
    }, 5000)

    return () => clearInterval(timer)
  }, [collisions])

  function handleExport(e, type, sessionId) {
    e.stopPropagation()
    const url = type === 'md' ? getExportMdUrl(sessionId) : getExportHtmlUrl(sessionId)
    window.open(url, '_blank')
    setOpenExport(null)
  }

  async function handleDelete(e, sessionId) {
    e.stopPropagation()
    if (!window.confirm('确定删除这条记录？相关知识库数据也会被清除。')) return
    try {
      await deleteCollision(sessionId)
      setCollisions(prev => prev.filter(c => c.session_id !== sessionId))
    } catch {
      alert('删除失败，请重试')
    }
  }

  function formatDateTime(ts) {
    const d = new Date(ts * 1000)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  function formatDuration(seconds) {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    if (m > 0) return `${m}分${s}秒`
    return `${s}秒`
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'done':
        return <span className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-600">✅ 完成</span>
      case 'running':
        return <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 animate-pulse">⚡ 运行中</span>
      case 'cancelled':
        return <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">已取消</span>
      case 'error':
        return <span className="text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-500">错误</span>
      default:
        return <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">{status}</span>
    }
  }

  function handleRowClick(c) {
    if (openExport) return
    if (c.status === 'done') {
      navigate(`/report/${c.session_id}`)
    } else {
      navigate(`/collision/${c.session_id}`)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">📋 碰撞历史</h1>
        <p className="text-sm text-gray-500">查看所有已完成和进行中的碰撞记录</p>
      </div>

      {error && (
        <div className="text-center py-12">
          <p className="text-red-500">{error}</p>
        </div>
      )}

      {!error && collisions.length === 0 && (
        <div className="text-center py-20">
          <p className="text-4xl mb-4">📭</p>
          <p className="text-gray-500 mb-4">暂无碰撞记录</p>
          <button
            onClick={() => navigate('/')}
            className="px-5 py-2 text-sm text-amber-600 bg-amber-50 rounded-full
                       hover:bg-amber-100 transition-colors cursor-pointer"
          >
            ⚡ 发起第一次碰撞
          </button>
        </div>
      )}

      {collisions.length > 0 && (
        <div className="space-y-3">
          {collisions.map((c) => (
            <button
              key={c.session_id}
              onClick={() => handleRowClick(c)}
              className="w-full text-left bg-white border border-gray-100 rounded-xl p-5
                         hover:border-gray-200 hover:shadow-sm transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-medium text-gray-900 truncate group-hover:text-amber-700 transition-colors">
                    {c.topic}
                  </h3>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    <span>{c.session_id}</span>
                    <span>·</span>
                    <span>{c.rounds} 轮</span>
                    <span>·</span>
                    <span>{c.agents} 智能体</span>
                    {c.status === 'done' && c.started_at && (
                      <>
                        <span>·</span>
                        <span>完成于 {formatDateTime(c.started_at + (c.duration || 0))}</span>
                        <span>·</span>
                        <span>耗时 {formatDuration(c.duration || 0)}</span>
                      </>
                    )}
                  </div>
                </div>
                {getStatusBadge(c.status)}
                {c.status === 'done' && (
                  <div className="relative flex items-center gap-2">
                    <button
                      onClick={(e) => handleDelete(e, c.session_id)}
                      className="px-2 py-1 text-xs text-red-400 hover:text-red-600
                                 border border-red-200 rounded-lg hover:border-red-300
                                 transition-colors cursor-pointer"
                    >
                      删除
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenExport(openExport === c.session_id ? null : c.session_id)
                      }}
                      className="px-2 py-1 text-xs text-gray-400 hover:text-amber-600
                                 border border-gray-200 rounded-lg hover:border-amber-300
                                 transition-colors cursor-pointer"
                    >
                      导出 ▾
                    </button>
                    {openExport === c.session_id && (
                      <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200
                                      rounded-lg shadow-lg z-10 overflow-hidden">
                        <button
                          onClick={(e) => handleExport(e, 'md', c.session_id)}
                          className="block w-full text-left px-4 py-2 text-xs text-gray-600
                                     hover:bg-amber-50 hover:text-amber-700 cursor-pointer whitespace-nowrap"
                        >
                          导出 MD
                        </button>
                        <button
                          onClick={(e) => handleExport(e, 'html', c.session_id)}
                          className="block w-full text-left px-4 py-2 text-xs text-gray-600
                                     hover:bg-amber-50 hover:text-amber-700 cursor-pointer whitespace-nowrap"
                        >
                          导出 HTML
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { listCollisions, getKnowledgeStats } from '../api/client'

const CATEGORIES = [
  { key: 'ideas', label: '💡 想法', desc: '碰撞中产出的创新想法' },
  { key: 'insights', label: '🔍 洞见', desc: '深度分析得出的关键洞察' },
  { key: 'critiques', label: '🎯 批评', desc: '批评家提出的改进建议' },
  { key: 'concepts', label: '🧠 概念', desc: '跨领域的核心概念提炼' },
]

export default function KnowledgePage() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState(null)
  const [recentSessions, setRecentSessions] = useState([])

  useEffect(() => {
    // Get stats from most recent completed sessions
    listCollisions()
      .then((data) => {
        const done = (data.collisions || []).filter(c => c.status === 'done')
        setRecentSessions(done.slice(0, 10))

        // Try to get stats from the latest session
        if (done.length > 0) {
          return getKnowledgeStats(done[0].session_id)
        }
        return null
      })
      .then((s) => {
        if (s) setStats(s)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const totalEntries = stats ? Object.values(stats).reduce((a, b) => a + b, 0) : 0

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
        <h1 className="text-2xl font-bold text-gray-900 mb-2">🧠 知识库</h1>
        <p className="text-sm text-gray-500">
          碰撞过程中积累的知识资产，可在后续碰撞中被检索和复用
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {CATEGORIES.map((cat) => {
          const count = stats?.[cat.key] || 0
          const isActive = activeCategory === cat.key

          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(isActive ? null : cat.key)}
              className={`
                p-4 rounded-xl border text-left transition-all cursor-pointer
                ${isActive
                  ? 'border-amber-300 bg-amber-50 shadow-sm'
                  : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm'
                }
              `}
            >
              <p className="text-2xl font-bold text-gray-900">{count}</p>
              <p className="text-xs text-gray-500 mt-1">{cat.label}</p>
            </button>
          )
        })}
      </div>

      {/* Total */}
      <div className="text-center mb-8">
        <span className="text-sm text-gray-400">
          共 <span className="font-semibold text-amber-600">{totalEntries}</span> 条知识条目
        </span>
      </div>

      {/* Search */}
      <div className="mb-8">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索知识库..."
            className="w-full pl-10 pr-4 py-3 text-sm bg-gray-50 border border-gray-100 rounded-xl
                       focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400
                       placeholder-gray-400 transition-all"
          />
          <span className="absolute left-3.5 top-3.5 text-gray-400 text-sm">🔍</span>
        </div>
        {searchQuery && (
          <p className="text-xs text-gray-400 mt-2">
            搜索功能需要后端知识库 API 支持
          </p>
        )}
      </div>

      {/* Category details */}
      {activeCategory && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">
            {CATEGORIES.find(c => c.key === activeCategory)?.label}
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            {CATEGORIES.find(c => c.key === activeCategory)?.desc}
          </p>
          <div className="bg-gray-50 rounded-xl p-6 text-center">
            <p className="text-sm text-gray-400">
              知识浏览功能开发中...
            </p>
          </div>
        </section>
      )}

      {/* Knowledge sources */}
      <section>
        <h2 className="text-sm font-semibold text-gray-800 mb-3">知识来源</h2>
        {recentSessions.length === 0 ? (
          <div className="bg-gray-50 rounded-xl p-6 text-center">
            <p className="text-3xl mb-3">🌱</p>
            <p className="text-sm text-gray-500 mb-1">知识库为空</p>
            <p className="text-xs text-gray-400">完成一次碰撞后，知识将自动积累到此处</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentSessions.map((s) => (
              <div
                key={s.session_id}
                className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg"
              >
                <span className="text-amber-500 text-sm">📖</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{s.topic}</p>
                  <p className="text-xs text-gray-400">{s.session_id}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

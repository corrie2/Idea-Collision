import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getCollision, getExportMdUrl, getExportHtmlUrl } from '../api/client'
import ReactMarkdown from 'react-markdown'
import { AGENT_META, getAgentMeta } from '../components/AgentBubble'

export default function ReportPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState('all')
  const [showBackToTop, setShowBackToTop] = useState(false)

  // Listen for scroll to show/hide back-to-top button
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    getCollision(id)
      .then((res) => {
        if (res.result) {
          setData(res.result)
        } else if (res.status === 'running') {
          navigate(`/collision/${id}`, { replace: true })
        } else {
          setError('未找到报告数据')
        }
      })
      .catch(() => setError('获取报告失败'))
      .finally(() => setLoading(false))
  }, [id, navigate])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-4">{error}</p>
        <Link to="/" className="text-sm text-amber-600 hover:text-amber-700">返回首页</Link>
      </div>
    )
  }

  const { topic, history, synthesis, review } = data

  // Group history by round
  const rounds = {}
  for (const entry of history) {
    const r = String(entry.round)
    if (!rounds[r]) rounds[r] = []
    rounds[r].push(entry)
  }

  const roundOrder = Object.keys(rounds).sort((a, b) => {
    if (a === 'final') return 100
    if (a === 'review') return 101
    if (b === 'final') return -100
    if (b === 'review') return -101
    return Number(a) - Number(b)
  })

  function roundLabel(r) {
    if (r === 'final') return ' 最终融合'
    if (r === 'review') return ' 方案审查'
    return `第 ${r} 轮 · 碰撞交锋`
  }

  function formatContent(content) {
    if (Array.isArray(content)) {
      return content.map((c, i) => `- ${c}`).join('\n')
    }
    return String(content)
  }

  // Filter sections
  const showRounds = activeSection === 'all'
    ? roundOrder
    : activeSection === 'synthesis' ? ['final']
    : activeSection === 'review' ? ['review']
    : roundOrder.filter(r => r !== 'final' && r !== 'review')

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link to="/" className="text-xs text-gray-400 hover:text-gray-600 no-underline mb-3 inline-block">
          ← 返回首页
        </Link>
        <div className="float-right flex gap-2 mt-1">
          <a
            href={getExportMdUrl(id)}
            className="px-3 py-1 text-xs text-amber-600 border border-amber-300 rounded-lg
                       hover:bg-amber-50 transition-colors no-underline"
          >
            导出 MD
          </a>
          <a
            href={getExportHtmlUrl(id)}
            className="px-3 py-1 text-xs text-amber-600 border border-amber-300 rounded-lg
                       hover:bg-amber-50 transition-colors no-underline"
          >
            导出 HTML
          </a>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          {topic}
        </h1>
        <p className="text-sm text-gray-400">
          {id} · {history.length} 条记录
        </p>
      </div>

      {/* Table of Contents */}
      <nav className="mb-8 p-4 bg-gray-50 rounded-xl">
        <h3 className="text-xs font-medium text-gray-400 mb-3">目录导航</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveSection('all')}
            className={`px-3 py-1.5 text-xs rounded-full transition-colors cursor-pointer ${
              activeSection === 'all'
                ? 'bg-amber-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            全部
          </button>
          {roundOrder.filter(r => r !== 'final' && r !== 'review').map(r => (
            <button
              key={r}
              onClick={() => setActiveSection(`round-${r}`)}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors cursor-pointer ${
                activeSection === `round-${r}`
                  ? 'bg-amber-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              第 {r} 轮
            </button>
          ))}
          {synthesis && (
            <button
              onClick={() => setActiveSection('synthesis')}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors cursor-pointer ${
                activeSection === 'synthesis'
                  ? 'bg-cyan-500 text-white'
                  : 'bg-white text-cyan-600 hover:bg-cyan-50 border border-cyan-200'
              }`}
            >
               融合
            </button>
          )}
          {review && (
            <button
              onClick={() => setActiveSection('review')}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors cursor-pointer ${
                activeSection === 'review'
                  ? 'bg-purple-500 text-white'
                  : 'bg-white text-purple-600 hover:bg-purple-50 border border-purple-200'
              }`}
            >
               审查
            </button>
          )}
        </div>
      </nav>

      {/* Sections */}
      <div className="space-y-8">
        {showRounds.map((r) => {
          const entries = rounds[r]
          const isSpecial = r === 'final' || r === 'review'

          return (
            <section key={r} id={`round-${r}`}>
              <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className={`
                  w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold
                  ${r === 'final' ? 'bg-cyan-100 text-cyan-600' :
                    r === 'review' ? 'bg-purple-100 text-purple-600' :
                    'bg-amber-100 text-amber-600'}
                `}>
                  {r === 'final' ? '' : r === 'review' ? '' : r}
                </span>
                {roundLabel(r)}
              </h2>

              <div className="space-y-4">
                {entries.map((entry, idx) => {
                  const meta = getAgentMeta(entry.agent)
                  const content = formatContent(entry.content)

                  return (
                    <div
                      key={idx}
                      className={`
                        bg-white rounded-xl border border-gray-100 overflow-hidden
                        ${isSpecial ? 'ring-1 ring-amber-100' : ''}
                      `}
                    >
                      {/* Agent badge */}
                      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50/50 border-b border-gray-50">
                        <span className="text-base">{meta.emoji}</span>
                        <span className="text-sm font-semibold" style={{ color: meta.color }}>
                          {meta.name}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="px-4 py-3 markdown-content text-sm text-gray-700 leading-relaxed">
                        <ReactMarkdown>{content}</ReactMarkdown>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {/* Back button */}
      <div className="mt-12 text-center">
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-6 py-2.5 text-sm text-amber-600 bg-amber-50
                     rounded-full hover:bg-amber-100 transition-colors no-underline"
        >
           发起新碰撞
        </Link>
      </div>

      {/* Back to Top floating button */}
      {showBackToTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-8 right-8 w-11 h-11 bg-amber-500 text-white rounded-full
                     shadow-lg hover:bg-amber-600 hover:shadow-xl transition-all cursor-pointer
                     flex items-center justify-center text-lg z-50
                     animate-fade-in"
          title="回到顶部"
        >
          ↑
        </button>
      )}
    </div>
  )
}

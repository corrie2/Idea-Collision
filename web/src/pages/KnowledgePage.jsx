import { useState, useEffect, useRef, useCallback } from 'react'
import { listCollisions, getKnowledgeStats, getKnowledgeGraph, exportKnowledge, importKnowledge } from '../api/client'

const CATEGORIES = [
  { key: 'ideas', label: '💡 想法', desc: '碰撞中产出的创新想法', color: '#f59e0b' },
  { key: 'insights', label: '🔍 洞见', desc: '深度分析得出的关键洞察', color: '#3b82f6' },
  { key: 'critiques', label: '🎯 批评', desc: '批评家提出的改进建议', color: '#ef4444' },
  { key: 'concepts', label: '🧠 概念', desc: '跨领域的核心概念提炼', color: '#10b981' },
]

const NODE_COLORS = {
  concept: '#10b981',
  idea: '#f59e0b',
  insight: '#3b82f6',
  critique: '#ef4444',
}

// Simple force-directed graph using Canvas
function KnowledgeGraph({ graphData, onNodeClick }) {
  const canvasRef = useRef(null)
  const nodesRef = useRef([])
  const animFrameRef = useRef(null)
  const [hoveredNode, setHoveredNode] = useState(null)
  const [tooltip, setTooltip] = useState(null)
  const dragRef = useRef({ dragging: false, node: null, offsetX: 0, offsetY: 0 })

  useEffect(() => {
    if (!graphData || !graphData.nodes.length) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width = canvas.offsetWidth * 2
    const H = canvas.height = canvas.offsetHeight * 2
    ctx.scale(1, 1)

    // Initialize node positions
    const nodes = graphData.nodes.map((n, i) => ({
      ...n,
      x: W / 2 + (Math.random() - 0.5) * W * 0.6,
      y: H / 2 + (Math.random() - 0.5) * H * 0.6,
      vx: 0,
      vy: 0,
      radius: Math.max(8, Math.min(30, 8 + (n.degree || 0) * 3 + (n.mention_count || 1) * 0.5)),
    }))
    nodesRef.current = nodes

    const nodeMap = {}
    nodes.forEach(n => { nodeMap[n.id] = n })

    const edges = graphData.edges.map(e => ({
      ...e,
      sourceNode: nodeMap[e.source],
      targetNode: nodeMap[e.target],
    })).filter(e => e.sourceNode && e.targetNode)

    // Force simulation
    function simulate() {
      const alpha = 0.3

      // Repulsion between nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x
          const dy = nodes[j].y - nodes[i].y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = 5000 / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          nodes[i].vx -= fx
          nodes[i].vy -= fy
          nodes[j].vx += fx
          nodes[j].vy += fy
        }
      }

      // Attraction along edges
      edges.forEach(e => {
        const dx = e.targetNode.x - e.sourceNode.x
        const dy = e.targetNode.y - e.sourceNode.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - 150) * 0.005
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        e.sourceNode.vx += fx
        e.sourceNode.vy += fy
        e.targetNode.vx -= fx
        e.targetNode.vy -= fy
      })

      // Center gravity
      nodes.forEach(n => {
        n.vx += (W / 2 - n.x) * 0.001
        n.vy += (H / 2 - n.y) * 0.001
      })

      // Apply velocities with damping
      nodes.forEach(n => {
        if (dragRef.current.dragging && dragRef.current.node === n) return
        n.vx *= 0.85
        n.vy *= 0.85
        n.x += n.vx * alpha
        n.y += n.vy * alpha
        // Bounds
        n.x = Math.max(n.radius, Math.min(W - n.radius, n.x))
        n.y = Math.max(n.radius, Math.min(H - n.radius, n.y))
      })
    }

    function draw() {
      ctx.clearRect(0, 0, W, H)

      // Draw edges
      edges.forEach(e => {
        ctx.beginPath()
        ctx.moveTo(e.sourceNode.x, e.sourceNode.y)
        ctx.lineTo(e.targetNode.x, e.targetNode.y)
        ctx.strokeStyle = '#e5e7eb'
        ctx.lineWidth = 1
        ctx.stroke()

        // Edge label
        const mx = (e.sourceNode.x + e.targetNode.x) / 2
        const my = (e.sourceNode.y + e.targetNode.y) / 2
        ctx.font = '16px sans-serif'
        ctx.fillStyle = '#9ca3af'
        ctx.textAlign = 'center'
        ctx.fillText(e.relation, mx, my - 5)
      })

      // Draw nodes
      nodes.forEach(n => {
        const color = NODE_COLORS[n.type] || '#6b7280'
        const isHovered = hoveredNode === n.id

        // Glow for hovered
        if (isHovered) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.radius + 4, 0, Math.PI * 2)
          ctx.fillStyle = color + '30'
          ctx.fill()
        }

        // Node circle
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
        ctx.fillStyle = isHovered ? color : color + 'cc'
        ctx.fill()
        ctx.strokeStyle = isHovered ? '#111' : '#fff'
        ctx.lineWidth = isHovered ? 3 : 2
        ctx.stroke()

        // Node label
        ctx.font = `${Math.max(14, n.radius * 0.8)}px sans-serif`
        ctx.fillStyle = '#111'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const label = n.label.length > 8 ? n.label.slice(0, 8) + '...' : n.label
        ctx.fillText(label, n.x, n.y + n.radius + 18)
      })
    }

    function tick() {
      simulate()
      draw()
      animFrameRef.current = requestAnimationFrame(tick)
    }

    tick()

    // Mouse interaction
    function getNodeAt(mx, my) {
      const rect = canvas.getBoundingClientRect()
      const x = (mx - rect.left) * (W / rect.width)
      const y = (my - rect.top) * (H / rect.height)
      for (let i = nodes.length - 1; i >= 0; i--) {
        const dx = x - nodes[i].x
        const dy = y - nodes[i].y
        if (dx * dx + dy * dy < nodes[i].radius * nodes[i].radius) {
          return nodes[i]
        }
      }
      return null
    }

    function onMouseMove(e) {
      const node = getNodeAt(e.clientX, e.clientY)
      if (node) {
        setHoveredNode(node.id)
        setTooltip({
          x: e.clientX,
          y: e.clientY,
          node: node,
        })
        canvas.style.cursor = 'pointer'
      } else {
        setHoveredNode(null)
        setTooltip(null)
        canvas.style.cursor = 'default'
      }

      if (dragRef.current.dragging && dragRef.current.node) {
        const rect = canvas.getBoundingClientRect()
        dragRef.current.node.x = (e.clientX - rect.left) * (W / rect.width)
        dragRef.current.node.y = (e.clientY - rect.top) * (H / rect.height)
        dragRef.current.node.vx = 0
        dragRef.current.node.vy = 0
      }
    }

    function onMouseDown(e) {
      const node = getNodeAt(e.clientX, e.clientY)
      if (node) {
        dragRef.current = { dragging: true, node: node, offsetX: 0, offsetY: 0 }
      }
    }

    function onMouseUp(e) {
      if (dragRef.current.dragging && dragRef.current.node) {
        const node = getNodeAt(e.clientX, e.clientY)
        if (node === dragRef.current.node && onNodeClick) {
          onNodeClick(node)
        }
      }
      dragRef.current = { dragging: false, node: null, offsetX: 0, offsetY: 0 }
    }

    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mouseup', onMouseUp)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mouseup', onMouseUp)
    }
  }, [graphData, hoveredNode])

  if (!graphData || !graphData.nodes.length) {
    return (
      <div className="bg-gray-50 rounded-xl p-8 text-center">
        <p className="text-3xl mb-3">🕸️</p>
        <p className="text-sm text-gray-500">知识图谱为空</p>
        <p className="text-xs text-gray-400">完成碰撞后，知识关系将自动构建</p>
      </div>
    )
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full rounded-xl border border-gray-100 bg-white"
        style={{ height: '400px' }}
      />
      {/* Legend */}
      <div className="absolute top-3 right-3 bg-white/90 backdrop-blur rounded-lg p-2 text-xs space-y-1">
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
            <span className="text-gray-600">{type}</span>
          </div>
        ))}
      </div>
      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded-lg p-2.5 shadow-lg max-w-xs pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <p className="font-semibold">{tooltip.node.label}</p>
          <p className="text-gray-300 mt-0.5">类型: {tooltip.node.type}</p>
          {tooltip.node.domain && <p className="text-gray-300">领域: {tooltip.node.domain}</p>}
          {tooltip.node.degree > 0 && <p className="text-gray-300">连接数: {tooltip.node.degree}</p>}
          {tooltip.node.description && <p className="text-gray-400 mt-1">{tooltip.node.description}</p>}
        </div>
      )}
    </div>
  )
}

export default function KnowledgePage() {
  const [stats, setStats] = useState(null)
  const [graphData, setGraphData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('graph') // 'stats' | 'graph' | 'import'
  const [recentSessions, setRecentSessions] = useState([])
  const [exportStatus, setExportStatus] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    Promise.all([
      listCollisions().then(data => {
        const done = (data.collisions || []).filter(c => c.status === 'done')
        setRecentSessions(done.slice(0, 10))
        if (done.length > 0) return getKnowledgeStats(done[0].session_id)
        return null
      }),
      getKnowledgeGraph().catch(() => null),
    ])
      .then(([s, g]) => {
        if (s) setStats(s)
        if (g) setGraphData(g)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const totalEntries = stats ? Object.values(stats).reduce((a, b) => a + b, 0) : 0

  const handleExport = async (format) => {
    setExportStatus('导出中...')
    try {
      const res = await exportKnowledge(format)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `knowledge_export.${format}`
      a.click()
      URL.revokeObjectURL(url)
      setExportStatus('导出成功！')
      setTimeout(() => setExportStatus(''), 2000)
    } catch (e) {
      setExportStatus('导出失败: ' + e.message)
    }
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImportStatus('导入中...')
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const result = await importKnowledge(data, 'merge')
      setImportStatus(`导入成功！${JSON.stringify(result.stats)}`)
      // Refresh graph
      const g = await getKnowledgeGraph().catch(() => null)
      if (g) setGraphData(g)
      setTimeout(() => setImportStatus(''), 3000)
    } catch (err) {
      setImportStatus('导入失败: ' + err.message)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">🧠 知识库</h1>
        <p className="text-sm text-gray-500">
          碰撞过程中积累的知识资产，可在后续碰撞中被检索和复用
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {CATEGORIES.map((cat) => {
          const count = stats?.[cat.key] || 0
          return (
            <div
              key={cat.key}
              className="p-4 rounded-xl border border-gray-100 bg-white"
            >
              <p className="text-2xl font-bold text-gray-900">{count}</p>
              <p className="text-xs text-gray-500 mt-1">{cat.label}</p>
            </div>
          )
        })}
      </div>

      <div className="text-center mb-6">
        <span className="text-sm text-gray-400">
          共 <span className="font-semibold text-amber-600">{totalEntries}</span> 条知识条目
          {graphData && (
            <span className="ml-3">
              | 图谱: <span className="font-semibold text-green-600">{graphData.stats.total_nodes}</span> 节点
              + <span className="font-semibold text-blue-600">{graphData.stats.total_edges}</span> 边
            </span>
          )}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {[
          { key: 'graph', label: '🕸️ 知识图谱' },
          { key: 'stats', label: '📊 统计详情' },
          { key: 'import', label: '📦 导入/导出' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-2 text-sm rounded-md transition-all cursor-pointer ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'graph' && (
        <section>
          <KnowledgeGraph
            graphData={graphData}
            onNodeClick={(node) => console.log('Clicked node:', node)}
          />
        </section>
      )}

      {activeTab === 'stats' && (
        <section className="space-y-4">
          {/* Knowledge sources */}
          <h2 className="text-sm font-semibold text-gray-800">知识来源</h2>
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
      )}

      {activeTab === 'import' && (
        <section className="space-y-6">
          {/* Export */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">📤 导出知识库</h3>
            <p className="text-xs text-gray-500 mb-4">导出所有知识数据，用于备份或迁移到其他实例</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleExport('json')}
                className="px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors cursor-pointer"
              >
                导出 JSON
              </button>
              <button
                onClick={() => handleExport('md')}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
              >
                导出 Markdown
              </button>
            </div>
            {exportStatus && <p className="text-xs text-green-600 mt-2">{exportStatus}</p>}
          </div>

          {/* Import */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">📥 导入知识库</h3>
            <p className="text-xs text-gray-500 mb-4">从 JSON 文件导入知识数据（合并模式，不会覆盖已有数据）</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100 cursor-pointer"
            />
            {importStatus && <p className="text-xs text-green-600 mt-2">{importStatus}</p>}
          </div>
        </section>
      )}
    </div>
  )
}

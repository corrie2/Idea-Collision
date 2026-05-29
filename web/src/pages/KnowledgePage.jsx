import { useState, useEffect, useRef, useCallback } from 'react'
import { listCollisions, getKnowledgeStats, getKnowledgeGraph, getKnowledgeIdeas, getKnowledgeConcepts, exportKnowledge, importKnowledge } from '../api/client'

const CATEGORIES = [
  { key: 'ideas', label: '想法', desc: '碰撞中产出的创新想法', color: '#f59e0b' },
  { key: 'insights', label: '洞见', desc: '深度分析得出的关键洞察', color: '#3b82f6' },
  { key: 'critiques', label: '批评', desc: '批评家提出的改进建议', color: '#ef4444' },
  { key: 'concepts', label: '概念', desc: '跨领域的核心概念提炼', color: '#10b981' },
]

const NODE_COLORS = {
  concept: '#10b981',
  idea: '#f59e0b',
  insight: '#3b82f6',
  critique: '#ef4444',
}

// Force-directed graph with zoom, pan, search, domain clustering
function KnowledgeGraph({ graphData }) {
  const canvasRef = useRef(null)
  const nodesRef = useRef([])
  const animFrameRef = useRef(null)
  const [hoveredNode, setHoveredNode] = useState(null)
  const [tooltip, setTooltip] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const dragRef = useRef({ dragging: false, node: null })
  const panRef = useRef({ panning: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 })
  const zoomRef = useRef(1)

  const domains = graphData ? [...new Set(graphData.nodes.map(n => n.domain).filter(Boolean))] : []

  useEffect(() => {
    if (!graphData || !graphData.nodes.length) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width = canvas.offsetWidth * 2
    const H = canvas.height = canvas.offsetHeight * 2

    let filteredNodes = graphData.nodes
    if (domainFilter) {
      filteredNodes = graphData.nodes.filter(n => n.domain === domainFilter)
    }
    const filteredNodeIds = new Set(filteredNodes.map(n => n.id))

    const domainOffsets = {}
    domains.forEach((d, i) => {
      const angle = (i / domains.length) * Math.PI * 2
      domainOffsets[d] = { x: Math.cos(angle) * W * 0.2, y: Math.sin(angle) * H * 0.2 }
    })

    const nodes = filteredNodes.map((n) => {
      const off = domainOffsets[n.domain] || { x: 0, y: 0 }
      return {
        ...n,
        x: W / 2 + off.x + (Math.random() - 0.5) * W * 0.3,
        y: H / 2 + off.y + (Math.random() - 0.5) * H * 0.3,
        vx: 0, vy: 0,
        radius: Math.max(6, Math.min(40, 6 + (n.mention_count || 1) * 2 + (n.degree || 0) * 3)),
      }
    })
    nodesRef.current = nodes

    const nodeMap = {}
    nodes.forEach(n => { nodeMap[n.id] = n })

    const edges = graphData.edges
      .filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target))
      .map(e => ({ ...e, sourceNode: nodeMap[e.source], targetNode: nodeMap[e.target] }))
      .filter(e => e.sourceNode && e.targetNode)

    function simulate() {
      const alpha = 0.3
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x
          const dy = nodes[j].y - nodes[i].y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = 8000 / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          nodes[i].vx -= fx; nodes[i].vy -= fy
          nodes[j].vx += fx; nodes[j].vy += fy
        }
      }
      edges.forEach(e => {
        const dx = e.targetNode.x - e.sourceNode.x
        const dy = e.targetNode.y - e.sourceNode.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - 120) * 0.004
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        e.sourceNode.vx += fx; e.sourceNode.vy += fy
        e.targetNode.vx -= fx; e.targetNode.vy -= fy
      })
      nodes.forEach(n => {
        const off = domainOffsets[n.domain] || { x: 0, y: 0 }
        n.vx += (W / 2 + off.x - n.x) * 0.0008
        n.vy += (H / 2 + off.y - n.y) * 0.0008
      })
      nodes.forEach(n => {
        n.vx += (W / 2 - n.x) * 0.0005
        n.vy += (H / 2 - n.y) * 0.0005
      })
      nodes.forEach(n => {
        if (dragRef.current.dragging && dragRef.current.node === n) return
        n.vx *= 0.85; n.vy *= 0.85
        n.x += n.vx * alpha; n.y += n.vy * alpha
        n.x = Math.max(n.radius, Math.min(W - n.radius, n.x))
        n.y = Math.max(n.radius, Math.min(H - n.radius, n.y))
      })
    }

    function draw() {
      ctx.save()
      ctx.setTransform(zoomRef.current, 0, 0, zoomRef.current, panRef.current.offsetX, panRef.current.offsetY)
      ctx.clearRect(-panRef.current.offsetX / zoomRef.current, -panRef.current.offsetY / zoomRef.current, W / zoomRef.current, H / zoomRef.current)

      const searchLower = search.toLowerCase()
      const hasSearch = searchLower.length > 0

      edges.forEach(e => {
        const w = Math.max(1, Math.min(4, 1 + (e.strength || 1)))
        ctx.beginPath()
        ctx.moveTo(e.sourceNode.x, e.sourceNode.y)
        ctx.lineTo(e.targetNode.x, e.targetNode.y)
        ctx.strokeStyle = '#d1d5db'
        ctx.lineWidth = w
        ctx.stroke()
      })

      nodes.forEach(n => {
        const color = NODE_COLORS[n.type] || '#6b7280'
        const isHovered = hoveredNode === n.id
        const isSelected = selectedNode?.id === n.id
        const isMatch = hasSearch && n.label.toLowerCase().includes(searchLower)
        const dimmed = hasSearch && !isMatch

        if (isHovered || isSelected) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.radius + 5, 0, Math.PI * 2)
          ctx.fillStyle = color + '25'
          ctx.fill()
        }
        if (isMatch) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.radius + 3, 0, Math.PI * 2)
          ctx.fillStyle = '#fbbf2440'
          ctx.fill()
        }

        ctx.beginPath()
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
        ctx.fillStyle = dimmed ? color + '30' : (isHovered || isSelected ? color : color + 'cc')
        ctx.fill()
        ctx.strokeStyle = isSelected ? '#111' : (isHovered ? '#555' : '#fff')
        ctx.lineWidth = isSelected ? 3 : (isHovered ? 2 : 1.5)
        ctx.stroke()

        const showLabel = n.radius > 12 || isHovered || isMatch || isSelected
        if (showLabel && !dimmed) {
          ctx.font = `${Math.max(12, n.radius * 0.7)}px sans-serif`
          ctx.fillStyle = '#111'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const label = n.label.length > 10 ? n.label.slice(0, 10) + '..' : n.label
          ctx.fillText(label, n.x, n.y + n.radius + 16)
        }
      })

      ctx.restore()
    }

    function tick() {
      simulate()
      draw()
      animFrameRef.current = requestAnimationFrame(tick)
    }
    tick()

    function getNodeAt(mx, my) {
      const rect = canvas.getBoundingClientRect()
      const x = (mx - rect.left - panRef.current.offsetX) * (W / rect.width) / zoomRef.current
      const y = (my - rect.top - panRef.current.offsetY) * (H / rect.height) / zoomRef.current
      for (let i = nodes.length - 1; i >= 0; i--) {
        const dx = x - nodes[i].x
        const dy = y - nodes[i].y
        if (dx * dx + dy * dy < nodes[i].radius * nodes[i].radius) return nodes[i]
      }
      return null
    }

    function onMouseMove(e) {
      if (panRef.current.panning) {
        panRef.current.offsetX = e.clientX - panRef.current.startX
        panRef.current.offsetY = e.clientY - panRef.current.startY
        return
      }
      const node = getNodeAt(e.clientX, e.clientY)
      if (node) {
        setHoveredNode(node.id)
        setTooltip({ x: e.clientX, y: e.clientY, node })
        canvas.style.cursor = 'pointer'
      } else {
        setHoveredNode(null)
        setTooltip(null)
        canvas.style.cursor = 'grab'
      }
      if (dragRef.current.dragging && dragRef.current.node) {
        const rect = canvas.getBoundingClientRect()
        dragRef.current.node.x = (e.clientX - rect.left - panRef.current.offsetX) / zoomRef.current * (W / rect.width)
        dragRef.current.node.y = (e.clientY - rect.top - panRef.current.offsetY) / zoomRef.current * (H / rect.height)
        dragRef.current.node.vx = 0
        dragRef.current.node.vy = 0
      }
    }

    function onMouseDown(e) {
      const node = getNodeAt(e.clientX, e.clientY)
      if (node) {
        dragRef.current = { dragging: true, node }
      } else {
        panRef.current.panning = true
        panRef.current.startX = e.clientX - panRef.current.offsetX
        panRef.current.startY = e.clientY - panRef.current.offsetY
        canvas.style.cursor = 'grabbing'
      }
    }

    function onMouseUp(e) {
      if (dragRef.current.dragging && dragRef.current.node) {
        const node = getNodeAt(e.clientX, e.clientY)
        if (node === dragRef.current.node) {
          setSelectedNode(node)
        }
      }
      dragRef.current = { dragging: false, node: null }
      panRef.current.panning = false
      canvas.style.cursor = 'grab'
    }

    function onWheel(e) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      zoomRef.current = Math.max(0.3, Math.min(5, zoomRef.current * delta))
    }

    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [graphData, hoveredNode, search, domainFilter, selectedNode, domains])

  if (!graphData || !graphData.nodes.length) {
    return (
      <div className="bg-gray-50 rounded-xl p-8 text-center">
        <p className="text-3xl mb-3 text-gray-300">[空]</p>
        <p className="text-sm text-gray-500">知识图谱为空</p>
        <p className="text-xs text-gray-400">完成碰撞后，知识关系将自动构建</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="搜索节点..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-amber-400"
        />
        <select
          value={domainFilter}
          onChange={e => setDomainFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
        >
          <option value="">全部领域</option>
          {domains.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full rounded-xl border border-gray-100 bg-white"
          style={{ height: '500px', cursor: 'grab' }}
        />
        <div className="absolute top-3 right-3 bg-white/90 backdrop-blur rounded-lg p-2 text-xs space-y-1">
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              <span className="text-gray-600">{type}</span>
            </div>
          ))}
        </div>
        {tooltip && (
          <div
            className="fixed z-50 bg-gray-900 text-white text-xs rounded-lg p-2.5 shadow-lg max-w-xs pointer-events-none"
            style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
          >
            <p className="font-semibold">{tooltip.node.label}</p>
            <p className="text-gray-300 mt-0.5">类型: {tooltip.node.type}</p>
            {tooltip.node.domain && <p className="text-gray-300">领域: {tooltip.node.domain}</p>}
            {tooltip.node.mention_count > 1 && <p className="text-gray-300">提及: {tooltip.node.mention_count}次</p>}
            {tooltip.node.degree > 0 && <p className="text-gray-300">连接: {tooltip.node.degree}</p>}
            {tooltip.node.description && <p className="text-gray-400 mt-1 max-w-[200px]">{tooltip.node.description}</p>}
          </div>
        )}
      </div>

      {selectedNode && (
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">{selectedNode.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">类型: {selectedNode.type} {selectedNode.domain && `| 领域: ${selectedNode.domain}`}</p>
              {selectedNode.description && <p className="text-xs text-gray-600 mt-2">{selectedNode.description}</p>}
              {selectedNode.mention_count > 1 && <p className="text-xs text-gray-400 mt-1">提及次数: {selectedNode.mention_count}</p>}
            </div>
            <button onClick={() => setSelectedNode(null)} className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer">x</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function KnowledgePage() {
  const [stats, setStats] = useState(null)
  const [graphData, setGraphData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('graph')
  const [recentSessions, setRecentSessions] = useState([])
  const [exportStatus, setExportStatus] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [ideas, setIdeas] = useState([])
  const [concepts, setConcepts] = useState([])
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
      getKnowledgeIdeas().catch(() => ({ ideas: [] })),
      getKnowledgeConcepts().catch(() => ({ concepts: [] })),
    ])
      .then(([s, g, i, c]) => {
        if (s) setStats(s)
        if (g) setGraphData(g)
        if (i) setIdeas(i.ideas || [])
        if (c) setConcepts(c.concepts || [])
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
        <h1 className="text-2xl font-bold text-gray-900 mb-2">知识库</h1>
        <p className="text-sm text-gray-500">
          碰撞过程中积累的知识资产，可在后续碰撞中被检索和复用
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {CATEGORIES.map((cat) => {
          const count = stats?.[cat.key] || 0
          return (
            <div key={cat.key} className="p-4 rounded-xl border border-gray-100 bg-white">
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

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {[
          { key: 'graph', label: '知识图谱' },
          { key: 'ideas', label: '想法' },
          { key: 'concepts', label: '概念' },
          { key: 'stats', label: '统计详情' },
          { key: 'import', label: '导入/导出' },
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

      {activeTab === 'graph' && (
        <section>
          <KnowledgeGraph graphData={graphData} />
        </section>
      )}

      {activeTab === 'ideas' && (
        <section>
          {ideas.length === 0 ? (
            <div className="bg-gray-50 rounded-xl p-8 text-center">
              <p className="text-3xl mb-3 text-gray-300">[空]</p>
              <p className="text-sm text-gray-500">暂无想法</p>
              <p className="text-xs text-gray-400">完成碰撞后，想法将自动提取到此处</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">共 {ideas.length} 个想法</p>
              {ideas.map((idea, i) => (
                <div key={idea.id} className="bg-white border border-gray-100 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-amber-500 font-bold text-sm mt-0.5">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 leading-relaxed">{idea.content}</p>
                      <div className="flex gap-3 mt-2">
                        {idea.domain && <span className="text-xs text-gray-400">领域: {idea.domain}</span>}
                        {idea.session_id && <span className="text-xs text-gray-400">来源: {idea.session_id.slice(0, 16)}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'concepts' && (
        <section>
          {concepts.length === 0 ? (
            <div className="bg-gray-50 rounded-xl p-8 text-center">
              <p className="text-3xl mb-3 text-gray-300">[空]</p>
              <p className="text-sm text-gray-500">暂无概念</p>
              <p className="text-xs text-gray-400">完成碰撞后，核心概念将自动提炼到此处</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">共 {concepts.length} 个概念</p>
              {concepts.map((c) => (
                <div key={c.id} className="bg-white border border-gray-100 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                      {c.description && <p className="text-xs text-gray-600 mt-1">{c.description}</p>}
                      <div className="flex gap-3 mt-2">
                        {c.domain && <span className="text-xs text-gray-400">领域: {c.domain}</span>}
                      </div>
                    </div>
                    <span className="text-xs bg-green-50 text-green-600 px-2 py-1 rounded-full whitespace-nowrap">
                      x{c.mention_count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'stats' && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">知识来源</h2>
          {recentSessions.length === 0 ? (
            <div className="bg-gray-50 rounded-xl p-6 text-center">
              <p className="text-3xl mb-3 text-gray-300">[空]</p>
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
                  <span className="text-amber-500 text-sm font-mono">[i]</span>
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
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">导出知识库</h3>
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

          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">导入知识库</h3>
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

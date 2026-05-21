import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { connectCollisionWS, getCollision, cancelCollision } from '../api/client'
import AgentBubble from '../components/AgentBubble'

export default function CollisionPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [messages, setMessages] = useState([])       // [{agent, content, round, streaming}]
  const [currentRound, setCurrentRound] = useState(0)
  const [totalRounds, setTotalRounds] = useState(0)
  const [status, setStatus] = useState('connecting')  // connecting | running | done | cancelled | error
  const [statusMsg, setStatusMsg] = useState('正在连接...')
  const [topic, setTopic] = useState('')
  const [agentProgress, setAgentProgress] = useState({}) // agentName -> {active, done}

  const wsRef = useRef(null)
  const messagesEndRef = useRef(null)
  const msgIndexMap = useRef({}) // agent_round -> index in messages array

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Connect WebSocket
  useEffect(() => {
    // First try to get existing status
    getCollision(id).then((data) => {
      if (data.topic) setTopic(data.topic)
      if (data.status === 'done') {
        navigate(`/report/${id}`, { replace: true })
        return
      }
    }).catch(() => {})

    const ws = connectCollisionWS(id, {
      onOpen: () => setStatus('running'),
      onClose: () => setStatus(s => s === 'running' ? 'error' : s),
      onError: () => setStatus('error'),
      onMessage: handleWSMessage,
    })

    wsRef.current = ws

    return () => {
      ws.close()
    }
  }, [id])

  const handleWSMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'round_start':
        setCurrentRound(msg.round)
        setStatusMsg(`第 ${msg.round} 轮碰撞进行中...`)
        break

      case 'agent_start': {
        setAgentProgress(prev => ({ ...prev, [msg.agent]: { active: true, done: false } }))
        const key = `${msg.agent}_${msg.round}`
        setMessages(prev => {
          const newMsg = { agent: msg.agent, content: '', round: msg.round, streaming: true }
          // Check if already exists
          if (msgIndexMap.current[key] !== undefined) return prev
          msgIndexMap.current[key] = prev.length
          return [...prev, newMsg]
        })
        break
      }

      case 'agent_token': {
        const key = `${msg.agent}_${currentRound}`
        // Find the latest message for this agent (might be final/review round)
        setMessages(prev => {
          const newMsgs = [...prev]
          // Find last message for this agent that's still streaming
          for (let i = newMsgs.length - 1; i >= 0; i--) {
            if (newMsgs[i].agent === msg.agent && newMsgs[i].streaming) {
              newMsgs[i] = { ...newMsgs[i], content: newMsgs[i].content + msg.token }
              break
            }
          }
          return newMsgs
        })
        break
      }

      case 'agent_end': {
        setAgentProgress(prev => ({ ...prev, [msg.agent]: { active: false, done: true } }))
        setMessages(prev => {
          const newMsgs = [...prev]
          for (let i = newMsgs.length - 1; i >= 0; i--) {
            if (newMsgs[i].agent === msg.agent && newMsgs[i].streaming) {
              newMsgs[i] = { ...newMsgs[i], streaming: false }
              break
            }
          }
          return newMsgs
        })
        break
      }

      case 'round_end':
        setStatusMsg(`第 ${msg.round} 轮完成`)
        break

      case 'status':
        setStatusMsg(msg.message)
        break

      case 'knowledge_loaded':
        setStatusMsg(`知识库已加载 (${msg.injected}/${msg.total} 个智能体)`)
        break

      case 'knowledge_update':
        setStatusMsg(`知识已更新: ${msg.ideas || 0} 想法, ${msg.insights || 0} 洞见`)
        break

      case 'collision_done':
        setStatus('done')
        setStatusMsg('碰撞完成！')
        // Navigate to report after a brief delay
        setTimeout(() => navigate(`/report/${id}`, { replace: true }), 1500)
        break

      case 'collision_cancelled':
        setStatus('cancelled')
        setStatusMsg('碰撞已取消')
        break

      case 'error':
        setStatus('error')
        setStatusMsg(msg.message || '发生错误')
        break

      default:
        break
    }
  }, [currentRound, id, navigate])

  async function handleCancel() {
    try {
      await cancelCollision(id)
    } catch {}
    wsRef.current?.send({ type: 'cancel' })
  }

  // Compute unique rounds from messages
  const rounds = [...new Set(messages.map(m => m.round))].sort((a, b) => {
    if (a === 'final') return 100
    if (a === 'review') return 101
    if (b === 'final') return -100
    if (b === 'review') return -101
    return a - b
  })

  const isActive = status === 'running' || status === 'connecting'
  const progress = currentRound > 0 ? Math.round((currentRound / (totalRounds || 4)) * 100) : 0

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Sidebar */}
      <aside className="lg:w-56 shrink-0">
        <div className="lg:sticky lg:top-20 space-y-4">
          {/* Topic */}
          {topic && (
            <div>
              <h2 className="text-xs font-medium text-gray-400 mb-1">碰撞主题</h2>
              <p className="text-sm text-gray-800 font-medium leading-relaxed">{topic}</p>
            </div>
          )}

          {/* Status */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {isActive && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              )}
              {status === 'done' && (
                <span className="w-2 h-2 rounded-full bg-green-400" />
              )}
              {status === 'error' && (
                <span className="w-2 h-2 rounded-full bg-red-400" />
              )}
              <span className="text-xs text-gray-500">{statusMsg}</span>
            </div>
          </div>

          {/* Round progress */}
          {rounds.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-gray-400 mb-2">碰撞进度</h3>
              <div className="space-y-1">
                {rounds.map((r) => {
                  const roundMsgs = messages.filter(m => m.round === r)
                  const isCurrentRound = r === currentRound
                  const label = r === 'final' ? '融合' : r === 'review' ? '审查' : `第 ${r} 轮`

                  return (
                    <div
                      key={r}
                      className={`
                        flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors
                        ${isCurrentRound ? 'bg-amber-50 text-amber-700' : 'text-gray-500'}
                      `}
                    >
                      <span className={`
                        w-1.5 h-1.5 rounded-full shrink-0
                        ${isCurrentRound ? 'bg-amber-400 animate-pulse' :
                          roundMsgs.every(m => !m.streaming) ? 'bg-green-400' : 'bg-gray-300'}
                      `} />
                      <span>{label}</span>
                      <span className="text-gray-300 ml-auto">{roundMsgs.length}条</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Agent progress */}
          <div>
            <h3 className="text-xs font-medium text-gray-400 mb-2">智能体状态</h3>
            <div className="space-y-1">
              {Object.entries(agentProgress).map(([name, prog]) => (
                <div key={name} className="flex items-center gap-2 text-xs text-gray-500">
                  <span className={`
                    w-1.5 h-1.5 rounded-full shrink-0
                    ${prog.active ? 'bg-amber-400 animate-pulse' : prog.done ? 'bg-green-400' : 'bg-gray-300'}
                  `} />
                  <span className="truncate">{name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Cancel button */}
          {isActive && (
            <button
              onClick={handleCancel}
              className="w-full px-3 py-2 text-xs text-red-500 bg-red-50 rounded-lg
                         hover:bg-red-100 transition-colors cursor-pointer"
            >
              ⛔ 取消碰撞
            </button>
          )}

          {/* View report when done */}
          {status === 'done' && (
            <button
              onClick={() => navigate(`/report/${id}`)}
              className="w-full px-3 py-2 text-xs text-amber-600 bg-amber-50 rounded-lg
                         hover:bg-amber-100 transition-colors cursor-pointer"
            >
              📊 查看完整报告
            </button>
          )}
        </div>
      </aside>

      {/* Main content - messages */}
      <div className="flex-1 min-w-0">
        {messages.length === 0 && isActive ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 border-3 border-amber-200 border-t-amber-500 rounded-full animate-spin mb-4" />
            <p className="text-sm text-gray-500">{statusMsg}</p>
            <p className="text-xs text-gray-400 mt-1">智能体正在准备中...</p>
          </div>
        ) : (
          <div className="space-y-2">
            {messages.map((msg, idx) => (
              <AgentBubble
                key={`${msg.agent}_${msg.round}_${idx}`}
                agentId={msg.agent}
                content={msg.content}
                round={msg.round}
                isStreaming={msg.streaming}
                isFinal={msg.round === 'final'}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <div className="text-center py-12">
            <p className="text-red-500 mb-4">{statusMsg}</p>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 cursor-pointer"
            >
              返回首页
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

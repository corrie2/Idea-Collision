import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'

const AGENT_META = {
  provocateur: { emoji: '', name: '挑衅者', color: '#ef4444', bg: 'bg-red-50', border: 'border-red-100' },
  researcher: { emoji: '', name: '研究者', color: '#3b82f6', bg: 'bg-blue-50', border: 'border-blue-100' },
  critic: { emoji: '', name: '批评家', color: '#8b5cf6', bg: 'bg-purple-50', border: 'border-purple-100' },
  connector: { emoji: '', name: '连接者', color: '#10b981', bg: 'bg-green-50', border: 'border-green-100' },
  experimenter: { emoji: '', name: '实验者', color: '#f97316', bg: 'bg-orange-50', border: 'border-orange-100' },
  synthesizer: { emoji: '', name: '融合者', color: '#06b6d4', bg: 'bg-cyan-50', border: 'border-cyan-100' },
  pragmatist: { emoji: '', name: '务实者', color: '#6b7280', bg: 'bg-gray-50', border: 'border-gray-100' },
}

function getAgentMeta(agentId) {
  const key = Object.keys(AGENT_META).find(k =>
    agentId?.toLowerCase()?.includes(k)
  )
  return key ? AGENT_META[key] : { emoji: '', name: agentId || '未知', color: '#6b7280', bg: 'bg-gray-50', border: 'border-gray-100' }
}

// Inline markdown styles for bubble content
const markdownStyles = {
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="text-base font-bold mt-2 mb-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mt-2 mb-1" style={{ color: '#f59e0b' }}>{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-1.5 mb-0.5">{children}</h3>,
  code: ({ inline, className, children }) =>
    inline
      ? <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
      : <code className="block bg-gray-900 text-gray-100 p-2 rounded-lg text-xs font-mono overflow-x-auto my-1">{children}</code>,
  pre: ({ children }) => <pre className="bg-gray-900 rounded-lg overflow-x-auto my-1">{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-amber-400 pl-3 my-1 text-gray-500 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-gray-200 my-2" />,
  a: ({ href, children }) => <a href={href} className="text-amber-600 underline" target="_blank" rel="noreferrer">{children}</a>,
  table: ({ children }) => <table className="border-collapse text-xs my-1">{children}</table>,
  th: ({ children }) => <th className="border border-gray-200 px-2 py-1 bg-gray-50 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-gray-200 px-2 py-1">{children}</td>,
}

export default function AgentBubble({ agentId, content, round, isStreaming = false, isFinal = false }) {
  const meta = getAgentMeta(agentId)
  const [displayContent, setDisplayContent] = useState('')
  const contentRef = useRef(null)
  const prevContentRef = useRef('')

  // Typewriter effect for streaming
  useEffect(() => {
    if (!isStreaming) {
      setDisplayContent(content)
      return
    }

    const prev = prevContentRef.current
    if (content.length > prev.length) {
      const newPart = content.slice(prev.length)
      let i = 0
      const interval = setInterval(() => {
        if (i < newPart.length) {
          // Stream by larger chunks for markdown (not char by char)
          const chunkSize = Math.min(20, newPart.length - i)
          setDisplayContent(prev + newPart.slice(0, i + chunkSize))
          i += chunkSize
        } else {
          clearInterval(interval)
        }
      }, 30)
      prevContentRef.current = content
      return () => clearInterval(interval)
    } else {
      setDisplayContent(content)
      prevContentRef.current = content
    }
  }, [content, isStreaming])

  // Auto-scroll to bottom when streaming
  useEffect(() => {
    if (isStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [displayContent, isStreaming])

  const roundLabel = round === 'final' ? '最终融合' : round === 'review' ? '方案审查' : `第 ${round} 轮`

  return (
    <div className="mb-4 animate-[fadeIn_0.3s_ease-out]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-lg">{meta.emoji}</span>
        <span className="text-sm font-semibold" style={{ color: meta.color }}>
          {meta.name}
        </span>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
          {roundLabel}
        </span>
        {isStreaming && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs text-amber-500">输出中</span>
          </span>
        )}
      </div>

      {/* Bubble */}
      <div
        ref={contentRef}
        className={`
          ${meta.bg} ${meta.border} border rounded-2xl rounded-tl-md px-4 py-3
          text-sm text-gray-800
          max-h-[32rem] overflow-y-auto
          ${isFinal ? 'ring-2 ring-amber-200' : ''}
        `}
      >
        <div className="markdown-content">
          {isStreaming ? (
            <>
              <ReactMarkdown components={markdownStyles}>{displayContent}</ReactMarkdown>
              <span className="typewriter" />
            </>
          ) : (
            <ReactMarkdown components={markdownStyles}>{content}</ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  )
}

export { AGENT_META, getAgentMeta }

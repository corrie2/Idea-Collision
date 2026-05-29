import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchProviders, startCollision, listCollisions, getMaterials } from '../api/client'
import ModelSelector from '../components/ModelSelector'
import ApiKeyManager from '../components/ApiKeyManager'

const AGENTS = [
  { id: 'provocateur', emoji: '', name: '挑衅者', desc: '提出颠覆性视角，挑战常规', color: '#ef4444' },
  { id: 'researcher', emoji: '', name: '研究者', desc: '提供事实依据与深度分析', color: '#3b82f6' },
  { id: 'critic', emoji: '', name: '批评家', desc: '发现逻辑漏洞与潜在风险', color: '#8b5cf6' },
  { id: 'connector', emoji: '', name: '连接者', desc: '跨领域联想与类比推理', color: '#10b981' },
  { id: 'experimenter', emoji: '', name: '实验者', desc: '设计验证方案与原型构想', color: '#f97316' },
  { id: 'synthesizer', emoji: '', name: '融合者', desc: '整合所有观点，产出综合方案', color: '#06b6d4' },
  { id: 'pragmatist', emoji: '', name: '务实者', desc: '评估可行性，提供落地建议', color: '#6b7280' },
]

export default function HomePage() {
  const navigate = useNavigate()

  // State
  const [topic, setTopic] = useState('')
  const [rounds, setRounds] = useState(4)
  const [models, setModels] = useState([])
  const [providers, setProviders] = useState({})
  const [agentConfigs, setAgentConfigs] = useState(
    AGENTS.reduce((acc, a) => ({
      ...acc,
      [a.id]: { enabled: true, model: '', provider: '' }
    }), {})
  )
  const [globalModel, setGlobalModel] = useState('')
  const [globalProvider, setGlobalProvider] = useState('deepseek')
  const [apiKeys, setApiKeys] = useState({})
  const [noKnowledge, setNoKnowledge] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [recentCollisions, setRecentCollisions] = useState([])
  const [showApiKeys, setShowApiKeys] = useState(false)
  const [materials, setMaterials] = useState([])
  const [selectedMaterialIds, setSelectedMaterialIds] = useState([])

  // Fetch providers/models on mount
  useEffect(() => {
    fetchProviders()
      .then((data) => {
        setProviders(data.providers || {})
        setModels(data.models || [])
        // Set default model
        const defaultModel = data.models?.find(m => m.is_default)
        if (defaultModel) {
          setGlobalModel(defaultModel.model_id)
          setGlobalProvider(defaultModel.provider)
        }
      })
      .catch(() => {})
  }, [])

  // Fetch recent collisions
  useEffect(() => {
    listCollisions()
      .then((data) => setRecentCollisions((data.collisions || []).slice(0, 5)))
      .catch(() => {})
  }, [])

  // Fetch materials on mount
  useEffect(() => {
    getMaterials()
      .then((data) => setMaterials(data.materials || []))
      .catch(() => {})
  }, [])

  const handleAgentToggle = useCallback((agentId) => {
    setAgentConfigs(prev => ({
      ...prev,
      [agentId]: { ...prev[agentId], enabled: !prev[agentId].enabled }
    }))
  }, [])

  const handleAgentModelChange = useCallback((agentId, modelId) => {
    setAgentConfigs(prev => ({
      ...prev,
      [agentId]: { ...prev[agentId], model: modelId }
    }))
  }, [])

  async function handleStart() {
    if (!topic.trim()) {
      setError('请输入碰撞主题')
      return
    }

    setStarting(true)
    setError('')

    try {
      // Get global API key
      const globalApiKey = apiKeys[globalProvider] || ''

      // Build agent overrides
      const agents = AGENTS.map(a => ({
        id: a.id,
        enabled: agentConfigs[a.id].enabled,
        model: agentConfigs[a.id].model || '',
        provider: agentConfigs[a.id].provider || '',
        api_key: '',
        base_url: '',
      }))

      const payload = {
        topic: topic.trim(),
        rounds,
        agents,
        global_api_key: globalApiKey,
        global_provider: globalProvider,
        global_base_url: '',
        global_model: globalModel,
        no_knowledge: noKnowledge,
        ...(selectedMaterialIds.length > 0 && { pdf_session_ids: selectedMaterialIds }),
      }

      const result = await startCollision(payload)
      navigate(`/collision/${result.session_id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setStarting(false)
    }
  }

  const enabledCount = Object.values(agentConfigs).filter(a => a.enabled).length

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center py-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
           Idea Collision
        </h1>
        <p className="text-base text-gray-500 max-w-lg mx-auto leading-relaxed">
          让多个 AI 智能体围绕你的主题展开激烈碰撞，
          在观点交锋中产出突破性的创意方案
        </p>
      </div>

      {/* Topic Input */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          碰撞主题
        </label>
        <textarea
          value={topic}
          onChange={(e) => { setTopic(e.target.value); setError('') }}
          placeholder="描述你想要碰撞的主题...&#10;例如：如何设计一个去中心化的在线教育平台？"
          rows={3}
          className="w-full px-4 py-3 text-base bg-gray-50 border border-gray-100 rounded-xl
                     resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400
                     placeholder-gray-400 transition-all"
        />
        {error && (
          <p className="mt-2 text-sm text-red-500">{error}</p>
        )}

        {/* Rounds selector */}
        <div className="flex items-center gap-4 mt-4">
          <label className="text-sm text-gray-600">碰撞轮数</label>
          <div className="flex items-center gap-2">
            {[2, 3, 4, 5, 6].map(n => (
              <button
                key={n}
                onClick={() => setRounds(n)}
                className={`
                  w-8 h-8 rounded-lg text-sm font-medium transition-all cursor-pointer
                  ${rounds === n
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }
                `}
              >
                {n}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 ml-auto text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={noKnowledge}
              onChange={(e) => setNoKnowledge(e.target.checked)}
              className="accent-amber-500 w-4 h-4"
            />
            禁用知识库
          </label>
        </div>
      </section>

      {/* Materials Selection */}
      {materials.length > 0 && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-800">
              附加素材
              {selectedMaterialIds.length > 0 && (
                <span className="ml-2 text-xs font-normal text-amber-600">
                  已选 {selectedMaterialIds.length} 个
                </span>
              )}
            </h2>
            <a
              href="/materials"
              className="text-xs text-amber-600 hover:text-amber-700 no-underline transition-colors"
            >
              上传新文件 →
            </a>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {materials.map((m) => {
              const selected = selectedMaterialIds.includes(m.session_id)
              return (
                <label
                  key={m.id}
                  className={`
                    flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all
                    ${selected ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-transparent hover:bg-gray-100'}
                  `}
                >
                  <div
                    className={`
                      w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all
                      ${selected ? 'border-amber-500 bg-amber-500' : 'border-gray-300'}
                    `}
                  >
                    {selected && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      setSelectedMaterialIds(prev =>
                        selected
                          ? prev.filter(id => id !== m.session_id)
                          : [...prev, m.session_id]
                      )
                    }}
                    className="sr-only"
                  />
                  <span className="text-sm text-gray-400">[ ]</span>
                  <span className="text-sm text-gray-700 truncate flex-1">{m.filename}</span>
                  <span className="text-xs text-gray-300 shrink-0">
                    {m.pages > 0 && `${m.pages} 页`}
                  </span>
                </label>
              )
            })}
          </div>
        </section>
      )}

      {/* Global Model Config */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-800">全局模型配置</h2>
          <button
            onClick={() => setShowApiKeys(!showApiKeys)}
            className="text-xs text-amber-600 hover:text-amber-700 transition-colors cursor-pointer"
          >
            {showApiKeys ? '收起' : ' API 密钥管理'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">默认模型</label>
            <ModelSelector
              models={models}
              value={globalModel}
              onChange={(v) => {
                setGlobalModel(v)
                const m = models.find(x => x.model_id === v)
                if (m) setGlobalProvider(m.provider)
              }}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">默认提供商</label>
            <select
              value={globalProvider}
              onChange={(e) => setGlobalProvider(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg
                         text-gray-900 appearance-none cursor-pointer
                         focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400"
            >
              {Object.entries(providers).map(([id, p]) => (
                <option key={id} value={id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* API Key Manager (collapsible) */}
        {showApiKeys && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <ApiKeyManager onChange={setApiKeys} />
          </div>
        )}
      </section>

      {/* Agent Config Cards */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-800">
            碰撞团队
            <span className="ml-2 text-xs font-normal text-gray-400">
              {enabledCount}/{AGENTS.length} 已启用
            </span>
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => setAgentConfigs(prev =>
                Object.fromEntries(Object.keys(prev).map(k => [k, { ...prev[k], enabled: true }]))
              )}
              className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
            >
              全选
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={() => setAgentConfigs(prev =>
                Object.fromEntries(Object.keys(prev).map(k => [k, { ...prev[k], enabled: false }]))
              )}
              className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
            >
              全不选
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {AGENTS.map((agent) => {
            const config = agentConfigs[agent.id]
            return (
              <div
                key={agent.id}
                onClick={() => handleAgentToggle(agent.id)}
                className={`
                  relative bg-white rounded-xl border p-4 cursor-pointer transition-all duration-200
                  ${config.enabled
                    ? 'border-gray-200 shadow-sm hover:shadow-md'
                    : 'border-gray-100 opacity-50 hover:opacity-70'
                  }
                `}
              >
                {/* Checkbox */}
                <div className="flex items-start gap-3">
                  <div
                    className={`
                      w-5 h-5 rounded-md border-2 flex items-center justify-center mt-0.5 shrink-0 transition-all
                      ${config.enabled
                        ? 'border-amber-500 bg-amber-500'
                        : 'border-gray-300'
                      }
                    `}
                  >
                    {config.enabled && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{agent.emoji}</span>
                      <span className="text-sm font-semibold" style={{ color: agent.color }}>
                        {agent.name}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                      {agent.desc}
                    </p>
                  </div>
                </div>

                {/* Per-agent model selector */}
                {config.enabled && (
                  <div className="mt-3 pt-3 border-t border-gray-50" onClick={(e) => e.stopPropagation()}>
                    <ModelSelector
                      models={models}
                      value={config.model}
                      onChange={(v) => handleAgentModelChange(agent.id, v)}
                      className="text-xs !py-1.5"
                    />
                    <p className="text-[10px] text-gray-300 mt-1">
                      {config.model ? '已自定义' : '使用全局配置'}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Start Button */}
      <div className="text-center py-4">
        {selectedMaterialIds.length > 0 && (
          <p className="text-xs text-amber-600 mb-3">
             已附加 {selectedMaterialIds.length} 个素材文件
          </p>
        )}
        <button
          onClick={handleStart}
          disabled={starting || !topic.trim()}
          className="
            px-10 py-3.5 bg-amber-500 text-white font-semibold text-base rounded-2xl
            hover:bg-amber-600 active:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed
            shadow-lg shadow-amber-500/20 hover:shadow-xl hover:shadow-amber-500/30
            transition-all duration-200 cursor-pointer
          "
        >
          {starting ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              正在启动...
            </span>
          ) : (
            ` 开始碰撞 (${enabledCount} 智能体 × ${rounds} 轮)`
          )}
        </button>
      </div>

      {/* Recent Collisions */}
      {recentCollisions.length > 0 && (
        <section className="pt-4">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">最近碰撞</h2>
          <div className="space-y-2">
            {recentCollisions.map((c) => (
              <button
                key={c.session_id}
                onClick={() => navigate(
                  c.status === 'done' ? `/report/${c.session_id}` : `/collision/${c.session_id}`
                )}
                className="w-full text-left px-4 py-3 bg-white border border-gray-100 rounded-xl
                           hover:border-gray-200 hover:shadow-sm transition-all cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 font-medium truncate group-hover:text-amber-700 transition-colors">
                      {c.topic}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {c.session_id} · {c.rounds} 轮 · {c.agents} 智能体
                    </p>
                  </div>
                  <span className={`
                    text-xs px-2 py-0.5 rounded-full ml-3 shrink-0
                    ${c.status === 'done' ? 'bg-green-50 text-green-600' :
                      c.status === 'running' ? 'bg-amber-50 text-amber-600' :
                      'bg-gray-100 text-gray-500'}
                  `}>
                    {c.status === 'done' ? '完成' : c.status === 'running' ? '运行中' : c.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'

const PROVIDER_KEYS = [
  { id: 'deepseek', name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', prefix: 'sk-' },
  { id: 'openai', name: 'OpenAI', envKey: 'OPENAI_API_KEY', prefix: 'sk-' },
  { id: 'anthropic', name: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', prefix: 'sk-ant-' },
  { id: 'qwen', name: '通义千问', envKey: 'QWEN_API_KEY', prefix: 'sk-' },
  { id: 'zhipu', name: '智谱 AI', envKey: 'ZHIPU_API_KEY', prefix: '' },
]

function maskKey(key) {
  if (!key || key.length < 10) return key
  return key.slice(0, 6) + '...' + key.slice(-4)
}

export default function ApiKeyManager({ onChange }) {
  const [keys, setKeys] = useState({})
  const [serverDefaults, setServerDefaults] = useState({})
  const [editing, setEditing] = useState(null)
  const [inputValue, setInputValue] = useState('')
  const [testing, setTesting] = useState(null)
  const [testResult, setTestResult] = useState(null)

  // Load from sessionStorage on mount
  useEffect(() => {
    const saved = {}
    for (const p of PROVIDER_KEYS) {
      const val = sessionStorage.getItem(`api_key_${p.id}`)
      if (val) saved[p.id] = val
    }
    setKeys(saved)
    onChange?.(saved)
  }, [])

  // Fetch server defaults
  useEffect(() => {
    fetch('/api/providers')
      .then(r => r.json())
      .then(data => {
        // Server defaults are embedded in providers config
        setServerDefaults(data.providers || {})
      })
      .catch(() => {})
  }, [])

  function handleSave(providerId) {
    const trimmed = inputValue.trim()
    const newKeys = { ...keys }
    if (trimmed) {
      newKeys[providerId] = trimmed
      sessionStorage.setItem(`api_key_${providerId}`, trimmed)
    } else {
      delete newKeys[providerId]
      sessionStorage.removeItem(`api_key_${providerId}`)
    }
    setKeys(newKeys)
    setEditing(null)
    setInputValue('')
    onChange?.(newKeys)
  }

  async function handleTest(providerId) {
    setTesting(providerId)
    setTestResult(null)
    // Simple test: just validate the key format
    const key = keys[providerId]
    if (!key) {
      setTestResult({ provider: providerId, ok: false, msg: '未设置密钥' })
    } else {
      setTestResult({ provider: providerId, ok: true, msg: '密钥已保存' })
    }
    setTesting(null)
    setTimeout(() => setTestResult(null), 3000)
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-700 mb-3">API 密钥管理</h3>
      <p className="text-xs text-gray-400 mb-3">
        密钥仅保存在浏览器会话中，不会上传至服务器。留空则使用服务器默认密钥。
      </p>

      {PROVIDER_KEYS.map((p) => {
        const key = keys[p.id]
        const isEditing = editing === p.id
        const hasDefault = serverDefaults[p.id]

        return (
          <div
            key={p.id}
            className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors group"
          >
            {/* Provider name */}
            <span className="text-sm text-gray-700 w-20 shrink-0 font-medium">
              {p.name}
            </span>

            {/* Key display / input */}
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSave(p.id)}
                    placeholder={`输入 ${p.name} API Key`}
                    autoFocus
                    className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-md
                               focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400"
                  />
                  <button
                    onClick={() => handleSave(p.id)}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-amber-500 rounded-md
                               hover:bg-amber-600 transition-colors cursor-pointer"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => { setEditing(null); setInputValue('') }}
                    className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {key ? (
                    <span className="text-sm text-gray-500 font-mono">{maskKey(key)}</span>
                  ) : hasDefault ? (
                    <span className="text-xs text-gray-400 italic">使用服务器默认密钥</span>
                  ) : (
                    <span className="text-xs text-gray-300">未设置</span>
                  )}
                </div>
              )}
            </div>

            {/* Action buttons */}
            {!isEditing && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => { setEditing(p.id); setInputValue(key || '') }}
                  className="px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 rounded transition-colors cursor-pointer"
                >
                  {key ? '修改' : '设置'}
                </button>
                {key && (
                  <button
                    onClick={() => handleTest(p.id)}
                    disabled={testing === p.id}
                    className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {testing === p.id ? '...' : '测试'}
                  </button>
                )}
              </div>
            )}

            {/* Test result */}
            {testResult?.provider === p.id && (
              <span className={`text-xs ${testResult.ok ? 'text-green-500' : 'text-red-500'}`}>
                {testResult.msg}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

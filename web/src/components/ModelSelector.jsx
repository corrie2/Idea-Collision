import { useMemo } from 'react'

export default function ModelSelector({ models = [], value, onChange, className = '' }) {
  // Group models by provider
  const grouped = useMemo(() => {
    const map = {}
    for (const m of models) {
      const key = m.provider_name || m.provider
      if (!map[key]) map[key] = []
      map[key].push(m)
    }
    return map
  }, [models])

  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className={`
        w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg
        text-gray-900 appearance-none cursor-pointer
        hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400
        transition-colors
        ${className}
      `}
    >
      <option value="">选择模型...</option>
      {Object.entries(grouped).map(([provider, models]) => (
        <optgroup key={provider} label={provider}>
          {models.map((m) => (
            <option key={m.model_id} value={m.model_id}>
              {m.model_name} {m.is_default ? '(默认)' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

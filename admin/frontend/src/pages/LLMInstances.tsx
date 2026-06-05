import { useEffect, useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { configApi } from '@/lib/api'

interface LLMInstance {
  id: string
  name: string
  provider: string
  base_url: string
  model_name: string
  max_parallel: number
  priority: number
  is_active: boolean
  health_endpoint: string | null
}

const PROVIDER_BADGE: Record<string, string> = {
  anthropic:    'bg-purple-50 text-purple-700 border-purple-100',
  gemini:       'bg-blue-50 text-blue-700 border-blue-100',
  llamacpp:     'bg-green-50 text-green-700 border-green-100',
  openai_compat:'bg-orange-50 text-orange-700 border-orange-100',
}

export default function LLMInstances() {
  const [instances, setInstances] = useState<LLMInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [editVals, setEditVals] = useState<{ priority: number; model_name: string; max_parallel: number }>({ priority: 0, model_name: '', max_parallel: 4 })

  async function load() {
    setLoading(true)
    try {
      const res = await configApi.get('/internal/llm/instances')
      setInstances(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleActive(inst: LLMInstance) {
    const updated = await configApi.patch(`/internal/llm/instances/${inst.id}`, { is_active: !inst.is_active })
    setInstances(prev => prev.map(i => i.id === inst.id ? updated.data : i))
  }

  function startEdit(inst: LLMInstance) {
    setEditing(inst.id)
    setEditVals({ priority: inst.priority, model_name: inst.model_name, max_parallel: inst.max_parallel })
  }

  async function saveEdit(id: string) {
    const updated = await configApi.patch(`/internal/llm/instances/${id}`, editVals)
    setInstances(prev => prev.map(i => i.id === id ? updated.data : i))
    setEditing(null)
  }

  return (
    <>
      <div className="mb-6">
        <p className="text-base font-semibold text-[var(--color-text-muted)]">
          Configure and prioritise LLM backends used by agents. Lower priority number = preferred.
        </p>
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-bg)] border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)] text-xs font-semibold uppercase tracking-wider">
              <th className="px-4 py-3.5">Instance</th>
              <th className="px-4 py-3.5">Model</th>
              <th className="px-4 py-3.5 w-24">Priority</th>
              <th className="px-4 py-3.5 w-24">Parallel</th>
              <th className="px-4 py-3.5 w-20">Active</th>
              <th className="px-4 py-3.5 w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
            ) : instances.map(inst => (
              <tr key={inst.id} className="hover:bg-[var(--color-bg)] transition-colors">
                <td className="px-4 py-3">
                  <div className="font-semibold text-[var(--color-text-main)]">{inst.name}</div>
                  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border mt-1 shadow-xs uppercase tracking-wider ${PROVIDER_BADGE[inst.provider] ?? 'bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-border)]'}`}>
                    {inst.provider}
                  </span>
                  <div className="text-xs text-[var(--color-text-muted)] mt-1 font-mono truncate max-w-[200px]">{inst.base_url}</div>
                </td>

                <td className="px-4 py-3">
                  {editing === inst.id ? (
                    <input
                      className="border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-main)] rounded-lg px-2 py-1.5 text-xs w-full font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                      value={editVals.model_name}
                      onChange={e => setEditVals(v => ({ ...v, model_name: e.target.value }))}
                    />
                  ) : (
                    <span className="font-mono text-xs text-[var(--color-text-main)] bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-0.5 rounded shadow-xs">{inst.model_name || <span className="text-[var(--color-text-muted)] italic">not set</span>}</span>
                  )}
                </td>

                <td className="px-4 py-3">
                  {editing === inst.id ? (
                    <input
                      type="number"
                      className="border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-main)] rounded-lg px-2 py-1.5 text-xs w-16 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                      value={editVals.priority}
                      onChange={e => setEditVals(v => ({ ...v, priority: Number(e.target.value) }))}
                    />
                  ) : (
                    <span className="font-mono text-xs font-semibold text-[var(--color-text-main)] bg-[var(--color-bg)] border border-[var(--color-border)] px-2 py-0.5 rounded shadow-xs">{inst.priority}</span>
                  )}
                </td>

                <td className="px-4 py-3">
                  {editing === inst.id ? (
                    <input
                      type="number"
                      className="border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-main)] rounded-lg px-2 py-1.5 text-xs w-16 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                      value={editVals.max_parallel}
                      onChange={e => setEditVals(v => ({ ...v, max_parallel: Number(e.target.value) }))}
                    />
                  ) : (
                    <span className="font-mono text-xs text-[var(--color-text-muted)]">{inst.max_parallel}</span>
                  )}
                </td>

                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleActive(inst)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${inst.is_active ? 'app-toggle-active' : 'app-toggle-inactive'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${inst.is_active ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                </td>

                <td className="px-4 py-3">
                  {editing === inst.id ? (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => saveEdit(inst.id)}
                        title="Save"
                        className="p-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors shadow-sm cursor-pointer"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        title="Cancel"
                        className="p-1.5 bg-[var(--color-bg)] hover:bg-[var(--color-border)] text-[var(--color-text-muted)] rounded-lg transition-colors cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEdit(inst)}
                      title="Edit"
                      className="p-1.5 bg-[var(--color-bg)] hover:bg-teal-950/20 border border-[var(--color-border)] hover:border-teal-800 text-[var(--color-text-muted)] hover:text-teal-400 rounded-lg transition-colors cursor-pointer"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

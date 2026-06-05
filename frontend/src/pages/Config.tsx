import { useEffect, useState, useRef, useCallback } from 'react'
import { configApi } from '@/lib/api'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/custom/Button'
import { CustomDialog } from '@/components/custom/CustomDialog'
import {
  Save, Plus, Trash2, Eye, EyeOff, X, Search,
  Globe, Hash, Type, ToggleLeft, Braces, AlertCircle,
  Loader2, SaveAll, Undo2, Settings2,
} from 'lucide-react'

interface ConfigEntry {
  id: number
  agent_name: string | null
  key: string
  value: unknown
  is_secret: boolean
  description?: string
}

interface AgentInfo {
  name: string
  display_name?: string
}

type ValueType = 'string' | 'number' | 'boolean' | 'json'

function detectType(v: unknown): ValueType {
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'object' && v !== null) return 'json'
  return 'string'
}

const TYPE_BADGE: Record<ValueType, { icon: typeof Type; color: string; label: string }> = {
  string:  { icon: Type,        color: 'bg-sky-50 text-sky-600',     label: 'str' },
  number:  { icon: Hash,        color: 'bg-violet-50 text-violet-600', label: 'num' },
  boolean: { icon: ToggleLeft,  color: 'bg-amber-50 text-amber-600',  label: 'bool' },
  json:    { icon: Braces,      color: 'bg-emerald-50 text-emerald-600', label: 'json' },
}

function serialize(v: unknown): string {
  if (typeof v === 'string') return v
  return JSON.stringify(v, null, 2)
}

function isMultiline(v: unknown): boolean {
  if (typeof v === 'object' && v !== null) return true
  if (typeof v === 'string' && v.length > 80) return true
  return false
}

export default function Config() {
  const [agents, setAgents] = useState<string[]>(['global'])
  const [selectedAgent, setSelectedAgent] = useState('global')
  const [entries, setEntries] = useState<ConfigEntry[]>([])
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Auto-mask timers for secrets
  const maskTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // Add form
  const [showAdd, setShowAdd] = useState(false)
  const [newEntry, setNewEntry] = useState({ key: '', value: '', description: '', is_secret: false })
  const [deleteConfigEntry, setDeleteConfigEntry] = useState<ConfigEntry | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Fetch agent list from registry
  useEffect(() => {
    configApi.get('/internal/agents/')
      .then(res => {
        const names: string[] = (res.data as AgentInfo[]).map(a => a.name)
        const all = ['global', ...names.filter(n => n !== 'global').sort()]
        setAgents(all)
        if (!all.includes(selectedAgent)) setSelectedAgent('global')
      })
      .catch(() => { /* keep fallback */ })
  }, [])

  const load = useCallback(async (agent: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await configApi.get(`/config/${agent}`)
      setEntries(res.data)
      setEditing({})
    } catch {
      setError(`Failed to load config for "${agent}"`)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(selectedAgent) }, [selectedAgent, load])

  // Filtered entries
  const filtered = search
    ? entries.filter(e =>
        e.key.toLowerCase().includes(search.toLowerCase()) ||
        (e.description ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : entries

  const pendingCount = Object.keys(editing).length

  async function handleSave(entry: ConfigEntry) {
    const newVal = editing[entry.key]
    if (newVal === undefined) return
    let parsed: unknown
    try { parsed = JSON.parse(newVal) } catch { parsed = newVal }
    const agent = entry.agent_name ?? 'global'
    try {
      await configApi.put(`/config/${agent}/${entry.key}`, { value: parsed })
      setEditing(prev => { const c = { ...prev }; delete c[entry.key]; return c })
      load(selectedAgent)
    } catch {
      setError(`Failed to save "${entry.key}"`)
    }
  }

  async function handleSaveAll() {
    setSaving(true)
    setError(null)
    const keys = Object.keys(editing)
    let failed = 0
    for (const key of keys) {
      const entry = entries.find(e => e.key === key)
      if (!entry) continue
      let parsed: unknown
      try { parsed = JSON.parse(editing[key]) } catch { parsed = editing[key] }
      const agent = entry.agent_name ?? 'global'
      try {
        await configApi.put(`/config/${agent}/${key}`, { value: parsed })
      } catch {
        failed++
      }
    }
    if (failed > 0) setError(`${failed} entries failed to save`)
    setEditing({})
    await load(selectedAgent)
    setSaving(false)
  }

  function cancelEdit(key: string) {
    setEditing(prev => { const c = { ...prev }; delete c[key]; return c })
  }

  function cancelAll() {
    setEditing({})
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    let parsed: unknown
    try { parsed = JSON.parse(newEntry.value) } catch { parsed = newEntry.value }
    try {
      await configApi.post('/config/', {
        agent_name: selectedAgent === 'global' ? null : selectedAgent,
        key: newEntry.key,
        value: parsed,
        description: newEntry.description || undefined,
        is_secret: newEntry.is_secret,
      })
      setShowAdd(false)
      setNewEntry({ key: '', value: '', description: '', is_secret: false })
      load(selectedAgent)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail ?? 'Failed to add entry')
    }
  }

  async function confirmDelete() {
    if (!deleteConfigEntry) return
    setIsDeleting(true)
    const agent = deleteConfigEntry.agent_name ?? 'global'
    try {
      await configApi.delete(`/config/${agent}/${deleteConfigEntry.key}`)
      await load(selectedAgent)
      setDeleteConfigEntry(null)
    } catch {
      setError(`Failed to delete "${deleteConfigEntry.key}"`)
    } finally {
      setIsDeleting(false)
    }
  }

  function toggleReveal(key: string) {
    setRevealed(prev => {
      const copy = new Set(prev)
      if (copy.has(key)) {
        copy.delete(key)
        clearTimeout(maskTimers.current[key])
      } else {
        copy.add(key)
        // Auto-mask after 30s
        maskTimers.current[key] = setTimeout(() => {
          setRevealed(p => { const c = new Set(p); c.delete(key); return c })
        }, 30000)
      }
      return copy
    })
  }

  function displayValue(entry: ConfigEntry): string {
    if (entry.is_secret && !revealed.has(entry.key)) return '••••••••'
    return serialize(entry.value)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-5 border-b border-[var(--color-border)] gap-4 animate-in fade-in duration-200">
        <PageHeader title="Configuration" />
        <div>
          <p className="text-base font-bold text-[var(--color-text-main)] font-medium">
            Agent-scoped and global config entries. Changes take effect on next agent restart.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <>
              <Button
                onClick={cancelAll}
                variant="outline"
                size="sm"
                icon={<Undo2 size={14} />}
                className="whitespace-nowrap"
              >
                Discard ({pendingCount})
              </Button>
              <Button
                onClick={handleSaveAll}
                disabled={saving}
                variant="primary"
                size="sm"
                icon={saving ? <Loader2 size={14} className="animate-spin" /> : <SaveAll size={14} />}
                className="whitespace-nowrap"
              >
                Save All ({pendingCount})
              </Button>
            </>
          )}
          <Button
            onClick={() => setShowAdd(!showAdd)}
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
            className="whitespace-nowrap"
          >
            Add Entry
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center justify-between">
          <div className="flex items-center gap-2"><AlertCircle size={14} /> {error}</div>
          <button onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      <div className="flex gap-6">
        {/* Agent sidebar */}
        <div className="w-52 flex-shrink-0 space-y-3">
          <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-[var(--color-bg)] border-b border-[var(--color-border)]">
              <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Scope</span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {agents.map(a => (
                <button
                  key={a}
                  onClick={() => setSelectedAgent(a)}
                  className={`w-full text-left px-4 py-2.5 text-sm border-b border-[var(--color-border)] last:border-0 transition-all flex items-center gap-2 ${
                    selectedAgent === a
                      ? 'bg-teal-50 text-teal-700 font-semibold border-l-2 border-l-teal-500'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]'
                  }`}
                >
                  {a === 'global' ? <Globe size={14} /> : <Settings2 size={14} className="text-[var(--color-text-muted)]" />}
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder="Filter by key or description…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2.5 border border-[var(--color-border)] rounded-xl text-sm text-[var(--color-text-main)] bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 shadow-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Add form */}
          {showAdd && (
            <form onSubmit={handleAdd} className="bg-[var(--color-surface)] border border-teal-200 rounded-xl p-5 space-y-3 shadow-sm">
              <h4 className="text-xs font-semibold text-teal-700 uppercase tracking-wider flex items-center gap-1.5">
                <Plus size={13} /> New entry for <span className="font-mono">{selectedAgent}</span>
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={newEntry.key}
                  onChange={e => setNewEntry({ ...newEntry, key: e.target.value })}
                  placeholder="Key (e.g. max_retries)"
                  required
                  className="border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                />
                <input
                  value={newEntry.value}
                  onChange={e => setNewEntry({ ...newEntry, value: e.target.value })}
                  placeholder='Value (JSON or string)'
                  required
                  className="border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm font-mono bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                />
              </div>
              <input
                value={newEntry.description}
                onChange={e => setNewEntry({ ...newEntry, description: e.target.value })}
                placeholder="Description (optional)"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newEntry.is_secret}
                    onChange={e => setNewEntry({ ...newEntry, is_secret: e.target.checked })}
                    className="rounded border-[var(--color-border)] text-teal-600 accent-teal-600 focus:ring-teal-500"
                  />
                  Secret value
                </label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAdd(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                  >
                    Add
                  </Button>
                </div>
              </div>
            </form>
          )}

          {/* Loading */}
          {loading && (
            <div className="text-center py-12 text-[var(--color-text-muted)] text-sm flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading config…
            </div>
          )}

          {/* Empty state */}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)]">
              <Settings2 size={32} className="text-[var(--color-text-muted)] mx-auto mb-3" />
              <p className="text-[var(--color-text-muted)] text-sm font-medium">
                {search
                  ? `No entries matching "${search}"`
                  : `No config entries for "${selectedAgent}"`
                }
              </p>
              <p className="text-[var(--color-text-muted)] text-xs mt-1">
                {!search && 'Click "Add Entry" to create one.'}
              </p>
            </div>
          )}

          {/* Entries */}
          {!loading && filtered.map(entry => {
            const type = detectType(entry.value)
            const badge = TYPE_BADGE[type]
            const BadgeIcon = badge.icon
            const isEditing = editing[entry.key] !== undefined
            const useTextarea = isMultiline(entry.value) || (isEditing && editing[entry.key].includes('\n'))

            return (
              <div
                key={entry.key}
                className={`bg-[var(--color-surface)] rounded-xl border p-4 shadow-sm transition-all ${
                  isEditing ? 'border-teal-300 ring-1 ring-teal-100' : 'border-[var(--color-border)]'
                }`}
              >
                {/* Top row: key + badges + actions */}
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[var(--color-text-main)] text-sm font-mono">{entry.key}</span>
                    {/* Type badge */}
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${badge.color}`}>
                      <BadgeIcon size={10} /> {badge.label}
                    </span>
                    {/* Global badge */}
                    {entry.agent_name === null && selectedAgent !== 'global' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-600 uppercase">
                        global
                      </span>
                    )}
                    {/* Secret badge */}
                    {entry.is_secret && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-500 uppercase">
                        secret
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {entry.is_secret && (
                      <button
                        onClick={() => toggleReveal(entry.key)}
                        className="p-1.5 rounded-lg hover:bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition"
                        title={revealed.has(entry.key) ? 'Hide value (auto-hides in 30s)' : 'Reveal value'}
                      >
                        {revealed.has(entry.key) ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteConfigEntry(entry)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-muted)] hover:text-red-600 transition"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Description */}
                {entry.description && (
                  <p className="text-xs text-[var(--color-text-muted)] mb-2">{entry.description}</p>
                )}

                {/* Value editor */}
                <div className="flex gap-2 items-start">
                  {useTextarea ? (
                    <textarea
                      value={editing[entry.key] ?? displayValue(entry)}
                      onChange={e => setEditing({ ...editing, [entry.key]: e.target.value })}
                      rows={Math.min(10, (editing[entry.key] ?? displayValue(entry)).split('\n').length + 1)}
                      className="flex-1 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm font-mono bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 resize-y min-h-[60px]"
                    />
                  ) : (
                    <input
                      value={editing[entry.key] ?? displayValue(entry)}
                      onChange={e => setEditing({ ...editing, [entry.key]: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter' && isEditing) handleSave(entry) }}
                      className="flex-1 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm font-mono bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                    />
                  )}
                  {isEditing && (
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => cancelEdit(entry.key)}
                        className="p-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] transition"
                        title="Cancel"
                      >
                        <Undo2 size={14} />
                      </button>
                      <button
                        onClick={() => handleSave(entry)}
                        className="flex items-center gap-1 px-3 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 transition"
                        title="Save (Enter)"
                      >
                        <Save size={14} /> Save
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Entry count */}
          {!loading && filtered.length > 0 && (
            <p className="text-xs text-[var(--color-text-muted)] text-right pt-1">
              {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
              {search && entries.length !== filtered.length && ` (${entries.length} total)`}
            </p>
          )}
        </div>
      </div>

      <CustomDialog
        isOpen={deleteConfigEntry !== null}
        onClose={() => setDeleteConfigEntry(null)}
        onConfirm={confirmDelete}
        title="Delete Config Entry"
        description="Are you sure you want to permanently delete this config entry? This action is irreversible."
        itemName={deleteConfigEntry ? `Config: ${deleteConfigEntry.key}` : undefined}
        isDeleting={isDeleting}
        type="delete"
      />
    </div>
  )
}

import { useState, useEffect } from 'react'
import { orchestratorApi } from '@/lib/api'
import { cn } from '@/lib/cn'
import {
  Plus, Building2, KeyRound, X, CheckCircle,
  AlertTriangle, Copy, ChevronRight, Power,
} from 'lucide-react'
import { Button } from '@/components/custom/Button'
import PageHeader from '@/components/PageHeader'

interface Org {
  id: string
  name: string
  is_active: boolean
  created_by?: string
  created_at: string
}

interface KeySummary {
  id: string
  key_prefix: string
  name: string
  pipeline_ids: string[]
  rate_limit_rpm: number
  is_active: boolean
  created_at: string
}

interface OrgDetail {
  org: Org
  keys: KeySummary[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function KeyDisplay({ rawKey, onDismiss }: { rawKey: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(rawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs font-bold text-amber-800">
          Store this key securely — it will not be shown again.
        </p>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <code className="flex-1 text-xs bg-[var(--color-bg)] border border-amber-200 rounded-lg px-3 py-2 font-mono text-[var(--color-text-main)] break-all">
          {rawKey}
        </code>
        <button
          onClick={copy}
          className="shrink-0 p-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 transition-colors"
          title="Copy key"
        >
          {copied ? <CheckCircle size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <button onClick={onDismiss} className="mt-3 text-xs text-amber-600 hover:text-amber-800 font-semibold">
        I've saved the key — dismiss
      </button>
    </div>
  )
}

// ── Create Org modal ──────────────────────────────────────────────────────────

function CreateOrgModal({ onCreated, onClose }: { onCreated: (org: Org) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await orchestratorApi.post('/admin/v1/orgs/', { name })
      onCreated(res.data)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setError(detail ?? 'Failed to create organisation')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-[1px] p-4 animate-in fade-in duration-150">
      <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl w-full max-w-md mx-auto border border-[var(--color-border)] overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="px-6 py-5 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg)]">
          <p className="text-sm font-bold text-[var(--color-text-main)] flex items-center gap-2">
            <Building2 size={18} className="text-teal-600" /> New Organisation
          </p>
          <button 
            type="button"
            onClick={onClose} 
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] p-1.5 rounded-lg hover:bg-[var(--color-bg)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">Organisation Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. City General Hospital (leave blank to use key name)"
              required
              autoFocus
              className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-main)] placeholder:text-[var(--color-text-muted)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all"
            />
          </div>
          {error && (
            <p className="text-xs text-red-655 bg-red-50 border border-red-150 rounded-lg px-3 py-2 animate-in fade-in">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button 
              type="button" 
              variant="outline"
              size="sm"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit" 
              variant="primary"
              size="sm"
              disabled={submitting || !name.trim()}
              icon={<Plus size={14} />}
            >
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Org detail panel ──────────────────────────────────────────────────────────

function OrgDetailPanel({
  orgId,
  onClose,
  onRefresh,
}: {
  orgId: string
  onClose: () => void
  onRefresh: () => void
}) {
  const [detail, setDetail] = useState<OrgDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [rawKey, setRawKey] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)
  const [editName, setEditName] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)

  
  const [showCreateKey, setShowCreateKey] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [pipelineIds, setPipelineIds] = useState('')
  const [rpm, setRpm] = useState(60)
  const [submittingKey, setSubmittingKey] = useState(false)
  const [keyError, setKeyError] = useState('')

  useEffect(() => { 
    setDetail(null)
    load() 
    setShowCreateKey(false)
    setRawKey(null)
    setKeyError('')
  }, [orgId])

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const res = await orchestratorApi.get(`/admin/v1/orgs/${orgId}`)
      setDetail(res.data)
      setEditName(res.data.org.name)
    } catch { /* ignore */ }
    finally {
      if (!silent) setLoading(false)
    }
  }

  async function handleToggle() {
    if (!detail) return
    setToggling(true)
    try {
      if (detail.org.is_active) {
        await orchestratorApi.delete(`/admin/v1/orgs/${orgId}`)
      } else {
        await orchestratorApi.post(`/admin/v1/orgs/${orgId}/activate`)
      }
      await load(true) 
      onRefresh()
    } finally { setToggling(false) }
  }

  async function handleSaveName() {
    if (!editName?.trim()) return
    setSavingName(true)
    try {
      await orchestratorApi.patch(`/admin/v1/orgs/${orgId}`, { name: editName })
      await load(true)
      onRefresh()
    } finally { setSavingName(false) }
  }

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault()
    setSubmittingKey(true)
    setKeyError('')
    try {
      const res = await orchestratorApi.post('/v1/access-keys', {
        name: keyName,
        tenant_name: tenantName || keyName,
        pipeline_ids: pipelineIds ? pipelineIds.split(',').map(s => s.trim()).filter(Boolean) : [],
        rate_limit_rpm: rpm,
        org_id: orgId,
      })
      setRawKey(res.data.raw_key)
      setShowCreateKey(false)
      
      setKeyName('')
      setTenantName('')
      setPipelineIds('')
      setRpm(60)
      await load(true) 
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setKeyError(detail ?? 'Failed to create access key')
    } finally {
      setSubmittingKey(false)
    }
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm flex flex-col overflow-hidden animate-in fade-in duration-200 min-h-[480px]">
      
      <div className="px-6 py-5 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg)]">
        <div>
          <p className="text-base font-bold text-[var(--color-text-main)] mt-0.5 flex items-center gap-2">
            <Building2 size={16} className="text-teal-600" />
            {loading || !detail ? (
              <span className="inline-block h-5 w-36 bg-[var(--color-border)] rounded animate-pulse" />
            ) : (
              detail.org.name
            )}
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-1 font-mono">
            {loading || !detail ? (
              <span className="inline-block h-3.5 w-20 bg-[var(--color-border)] rounded animate-pulse" />
            ) : (
              `ID: ${detail.org.id.slice(0, 8)}`
            )}
          </p>
        </div>
        <button 
          onClick={onClose} 
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] p-1.5 rounded-lg hover:bg-[var(--color-bg)] transition-colors"
          title="Close Workspace"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-6 space-y-6 flex-1">
        {loading || !detail ? (
          <div className="space-y-6">
            
            <div className="space-y-2">
              <div className="h-3 w-28 bg-[var(--color-border)] rounded animate-pulse" />
              <div className="flex gap-2">
                <div className="flex-1 h-9 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg animate-pulse" />
                <div className="w-14 h-9 bg-[var(--color-border)] rounded-lg animate-pulse" />
              </div>
            </div>

            
            <div className="border-t border-[var(--color-border)] pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="h-3 w-32 bg-[var(--color-border)] rounded animate-pulse" />
                <div className="w-20 h-7 bg-[var(--color-border)] rounded-lg animate-pulse" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {[1, 2].map(i => (
                  <div key={i} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-start gap-4">
                      <div className="space-y-2 flex-1">
                        <div className="h-3 w-2/3 bg-[var(--color-border)] rounded animate-pulse" />
                        <div className="h-2 w-1/3 bg-[var(--color-border)] rounded animate-pulse" />
                      </div>
                      <div className="h-5 w-12 bg-[var(--color-border)] rounded-full animate-pulse" />
                    </div>
                    <div className="h-4 w-20 bg-[var(--color-border)] rounded-full animate-pulse mt-2" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {rawKey && <KeyDisplay rawKey={rawKey} onDismiss={() => setRawKey(null)} />}

            
            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Rename Organisation</label>
              <div className="flex gap-2">
                <input
                  value={editName ?? ''}
                  onChange={e => setEditName(e.target.value)}
                  className="flex-1 border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all bg-[var(--color-bg)] text-[var(--color-text-main)]"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveName}
                  disabled={savingName || !editName?.trim() || editName === detail.org.name}
                >
                  {savingName ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>

            
            <div className="border-t border-[var(--color-border)] pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-extrabold text-[var(--color-text-main)] uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound size={13} className="text-[var(--color-text-muted)]" /> ACCESS KEYS ({detail.keys.length})
                </h3>
                {!showCreateKey && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus size={14} />}
                    onClick={() => {
                      setShowCreateKey(true)
                      setKeyError('')
                    }}
                  >
                    Add Key
                  </Button>
                )}
              </div>

              
              {showCreateKey && (
                <form onSubmit={handleCreateKey} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-4 space-y-3.5 mb-6 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-[var(--color-text-main)] flex items-center gap-1.5">
                      <KeyRound size={13} className="text-teal-600" /> Create Access Key
                    </p>
                    <button 
                      type="button" 
                      onClick={() => {
                        setShowCreateKey(false)
                        setKeyError('')
                      }}
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] p-1 rounded-md hover:bg-[var(--color-border)] transition-all"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Key Name</label>
                      <input
                        value={keyName}
                        onChange={e => setKeyName(e.target.value)}
                        placeholder="e.g. prod-stt-key"
                        required
                        autoFocus
                        className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Tenant Name</label>
                      <input
                        value={tenantName}
                        onChange={e => setTenantName(e.target.value)}
                        placeholder="e.g. City General"
                        className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                        Pipeline IDs <span className="text-[var(--color-text-muted)] font-normal normal-case">(comma-separated)</span>
                      </label>
                      <input
                        value={pipelineIds}
                        onChange={e => setPipelineIds(e.target.value)}
                        placeholder="text_summarise"
                        className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Rate Limit (RPM)</label>
                      <input
                        type="number" min={1} max={10000}
                        value={rpm}
                        onChange={e => setRpm(Number(e.target.value))}
                        className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all"
                      />
                    </div>
                  </div>

                  {keyError && (
                    <p className="text-xs text-red-655 bg-red-50 border border-red-100 rounded-lg px-3 py-2 animate-in fade-in">
                      {keyError}
                    </p>
                  )}

                  <div className="flex justify-end gap-2 pt-1.5 border-t border-[var(--color-border)]">
                    <Button 
                      type="button" 
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowCreateKey(false)
                        setKeyError('')
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit" 
                      variant="primary"
                      size="sm"
                      disabled={submittingKey || !keyName.trim()}
                    >
                      {submittingKey ? 'Creating…' : 'Create Key'}
                    </Button>
                  </div>
                </form>
              )}

              {detail.keys.length === 0 ? (
                <div className="bg-[var(--color-bg)] border border-dashed border-[var(--color-border)] rounded-xl p-8 text-center">
                  <p className="text-xs text-[var(--color-text-muted)] font-medium">No access keys created for this organisation yet.</p>
                  {!showCreateKey && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Plus size={12} />}
                      onClick={() => setShowCreateKey(true)}
                      className="mt-3 inline-flex"
                    >
                      Create first key
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {detail.keys.map(key => (
                    <div key={key.id} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-4 hover:border-[var(--color-text-muted)] transition-all hover:bg-[var(--color-surface)]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[var(--color-text-main)] truncate">{key.name}</p>
                          <p className="text-[9px] font-mono text-[var(--color-text-muted)] mt-0.5">{key.key_prefix}…</p>
                        </div>
                        {key.is_active ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 active-status-pill border rounded-full text-[10px] font-bold tracking-wide uppercase select-none shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full active-status-dot" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 inactive-status-pill border rounded-full text-[10px] font-bold tracking-wide uppercase select-none shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full inactive-status-dot" />
                            Suspended
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-3.5 pt-2.5 border-t border-[var(--color-border)]">
                        {key.pipeline_ids.length === 0 ? (
                          <span className="text-[9px] bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-bold border border-teal-100/65">
                            All pipelines
                          </span>
                        ) : key.pipeline_ids.map(p => (
                          <span key={p} className="text-[9px] bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-mono border border-teal-100/65">
                            {p}
                          </span>
                        ))}
                        <span className="text-[9.5px] text-[var(--color-text-muted)] font-bold ml-auto flex items-center gap-1 font-mono">
                          {key.rate_limit_rpm} RPM
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      
      <div className="p-4 bg-[var(--color-bg)] border-t border-[var(--color-border)] flex items-center justify-between">
        {loading || !detail ? (
          <>
            <div className="h-4 w-48 bg-slate-200 rounded animate-pulse" />
            <div className="w-20 h-8 bg-slate-200 rounded-lg animate-pulse" />
          </>
        ) : (
          <>
            <div className="text-xs text-[var(--color-text-muted)]">
              Created by{" "}
              <span className="font-bold text-[var(--color-text-main)]">
                {detail.org.created_by ?? 'System'}
              </span>{" "}
              at {new Date(detail.org.created_at).toLocaleString()}
            </div>
            <Button
              variant={detail.org.is_active ? 'danger' : 'primary'}
              size="sm"
              icon={<Power size={13} />}
              disabled={toggling}
              onClick={handleToggle}
            >
              {toggling ? '…' : detail.org.is_active ? 'Deactivate ' : 'Activate '}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Organisations() {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const res = await orchestratorApi.get('/admin/v1/orgs/')
      setOrgs(res.data)
    } catch { /* ignore */ }
    finally {
      if (!silent) setLoading(false)
    }
  }

  function handleCreated(org: Org) {
    setShowCreate(false)
    setOrgs(prev => [org, ...prev])
    setSelectedId(org.id)
  }

  return (
    <div className="space-y-6">
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-5 border-b border-[var(--color-border)] gap-4 animate-in fade-in duration-200">
        <PageHeader title="Organisation" />
        <div>
          <p className="text-base font-bold text-[var(--color-text-main)]">
            Group access keys by organisation. Each key defines which pipelines it is authorized to invoke.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {selectedId && (
            <Button
              variant="outline"
              size="sm"
              
              onClick={() => setSelectedId(null)}
            >
              All Organisations
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => setShowCreate(true)}
          >
            New Organisation
          </Button>
        </div>
      </div>

      {loading ? (
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-200">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div
              key={i}
              className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5 flex flex-col justify-between min-h-[140px] shadow-sm relative overflow-hidden"
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center shrink-0 animate-pulse" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 bg-[var(--color-border)] rounded animate-pulse w-3/4" />
                    <div className="h-3.5 bg-[var(--color-border)] rounded animate-pulse w-1/2" />
                  </div>
                </div>
                <div className="h-5.5 w-16 bg-[var(--color-border)] rounded-full animate-pulse shrink-0" />
              </div>
              <div className="flex items-center justify-between mt-auto pt-3 border-t border-[var(--color-border)]">
                <div className="h-4 bg-[var(--color-border)] rounded animate-pulse w-32" />
                <div className="h-4 w-4 bg-[var(--color-border)] rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-16 text-center shadow-sm w-full animate-in fade-in duration-300">
          <Building2 size={44} className="text-[var(--color-text-muted)] mx-auto mb-3" />
          <p className="text-[var(--color-text-main)] font-semibold">No organisations yet</p>
          <p className="text-[var(--color-text-muted)] text-sm mt-1">Create an organisation to group your teams and manage access keys</p>
          <Button 
            variant="primary"
            size="sm"
            onClick={() => setShowCreate(true)} 
            className="mt-4 mx-auto"
          >
            Create Organisation
          </Button>
        </div>
      ) : !selectedId ? (
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-200">
          {orgs.map(org => (
            <div
              key={org.id}
              onClick={() => setSelectedId(org.id)}
              className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-5 hover:shadow-lg hover:border-teal-200 transition-all cursor-pointer group flex flex-col justify-between min-h-[140px] shadow-sm relative overflow-hidden"
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[var(--color-active-badge-bg)] border border-[var(--color-active-badge-border)] flex items-center justify-center shrink-0 group-hover:bg-[var(--color-active-badge-bg)]/80 transition-colors">
                    <Building2 size={20} className="text-[var(--color-active-badge-text)]" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-[var(--color-text-main)] group-hover:text-[var(--color-primary)] transition-colors truncate">{org.name}</p>
                    
                  </div>
                </div>
                {org.is_active ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 active-status-pill border rounded-full text-[10px] font-bold tracking-wide uppercase select-none shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full active-status-dot" />
                    Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 inactive-status-pill border rounded-full text-[10px] font-bold tracking-wide uppercase select-none shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full inactive-status-dot" />
                    Inactive
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between text-xs font-bold text-[var(--color-primary)] mt-auto pt-2 border-t border-[var(--color-border)] group-hover:border-[var(--color-primary)]/20 transition-colors">
                <span className="flex items-center gap-1.5"><KeyRound size={12} /> Manage access keys</span>
                <ChevronRight size={14} className="transform group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-in fade-in duration-300">
          
          <div className="lg:col-span-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-between">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Select Organisation</span>
              <span className="text-[10px] bg-[var(--color-border)] text-[var(--color-text-main)] font-bold px-2 py-0.5 rounded-full font-mono">{orgs.length} total</span>
            </div>
            <div className="p-3 space-y-1.5 max-h-[600px] overflow-y-auto bg-[var(--color-surface)] animate-in fade-in duration-150">
              {orgs.map(org => {
                const isActive = selectedId === org.id
                return (
                  <div
                    key={org.id}
                    onClick={() => setSelectedId(org.id)}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all border",
                      isActive 
                        ? "bg-[var(--color-selected-bg)] border-[var(--color-selected-border)] shadow-sm text-[var(--color-selected-text)]" 
                        : "bg-[var(--color-surface)] border-transparent hover:bg-[var(--color-bg)] hover:border-[var(--color-border)]"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-colors",
                        isActive 
                          ? "bg-[var(--color-selected-border)]/50 border-[var(--color-selected-border)] text-[var(--color-selected-text)]" 
                          : "bg-[var(--color-bg)] border-[var(--color-border)] text-[var(--color-text-muted)]"
                      )}>
                        <Building2 size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className={cn("text-xs font-bold truncate", isActive ? "text-[var(--color-selected-text)]" : "text-[var(--color-text-main)]")}>{org.name}</p>
                        <p className="text-[8.5px] text-[var(--color-text-muted)] mt-0.5 font-medium">Created {new Date(org.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {org.is_active ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 active-status-pill border rounded-full text-[9px] font-bold tracking-wide uppercase select-none shrink-0">
                          <span className="w-1 h-1 rounded-full active-status-dot shrink-0" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 inactive-status-pill border rounded-full text-[9px] font-bold tracking-wide uppercase select-none shrink-0">
                          <span className="w-1 h-1 rounded-full inactive-status-dot shrink-0" />
                          Inactive
                        </span>
                      )}
                      {isActive && <ChevronRight size={12} className="text-teal-500 shrink-0" />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          
          <div className="lg:col-span-8">
            <OrgDetailPanel
              orgId={selectedId}
              onClose={() => setSelectedId(null)}
              onRefresh={() => load(true)}
            />
          </div>
        </div>
      )}

      {showCreate && (
        <CreateOrgModal onCreated={handleCreated} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}

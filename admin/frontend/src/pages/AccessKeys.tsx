import { useEffect, useState } from 'react'
import { orchestratorApi, configApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import PageHeader from '@/components/PageHeader'
import { Key, Plus, Trash2, Copy, Check, X, Eye, EyeOff, Shield } from 'lucide-react'
import { CustomDialog } from '@/components/custom/CustomDialog'

interface Tenant {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_at: string
}

interface AccessKey {
  id: string
  key_prefix: string
  name: string
  tenant_id: string
  pipeline_ids: string[]
  rate_limit_rpm: number
  expires_at: string | null
  last_used_at: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
}

interface AccessKeyCreated extends AccessKey {
  raw_key: string
}

// Fallback list used until ConfigService responds
const PIPELINE_FALLBACK = ['text_summarise']

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function AccessKeys() {
  const { } = useAuth()
  const [keys, setKeys] = useState<AccessKey[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [pipelineOptions, setPipelineOptions] = useState<string[]>(PIPELINE_FALLBACK)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [createdKey, setCreatedKey] = useState<AccessKeyCreated | null>(null)
  const [rawKeyVisible, setRawKeyVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  const [revokeKeyTarget, setRevokeKeyTarget] = useState<AccessKey | null>(null)
  const [isRevoking, setIsRevoking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create form state
  const [form, setForm] = useState({
    name: '',
    tenant_name: '',
    pipeline_ids: [] as string[],
    rate_limit_rpm: 60,
    expires_at: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [keysRes, tenantsRes] = await Promise.all([
        orchestratorApi.get('/v1/access-keys'),
        orchestratorApi.get('/v1/tenants'),
      ])
      setKeys(keysRes.data)
      setTenants(tenantsRes.data)
    } catch {
      setError('Failed to load access keys')
    } finally {
      setLoading(false)
    }
    // Load pipeline names from ConfigService (non-blocking)
    try {
      const res = await configApi.get('/pipelines/graph/')
      const rows = res.data as { name: string; is_active: boolean }[]
      const names = Array.from(new Set(rows.filter(p => p.is_active).map(p => p.name)))
      if (names.length > 0) setPipelineOptions(names)
    } catch {
      // keep fallback
    }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)
    try {
      const payload = {
        name: form.name,
        tenant_name: form.tenant_name,
        pipeline_ids: form.pipeline_ids,
        rate_limit_rpm: form.rate_limit_rpm,
        expires_at: form.expires_at || null,
      }
      const res = await orchestratorApi.post('/v1/access-keys', payload)
      setCreatedKey(res.data)
      setShowCreate(false)
      setForm({ name: '', tenant_name: '', pipeline_ids: [], rate_limit_rpm: 60, expires_at: '' })
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(detail ?? 'Failed to create key')
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmRevoke() {
    if (!revokeKeyTarget) return
    setIsRevoking(true)
    try {
      await orchestratorApi.delete(`/v1/access-keys/${revokeKeyTarget.id}`)
      setKeys(prev => prev.map(k => k.id === revokeKeyTarget.id ? { ...k, is_active: false } : k))
      setRevokeKeyTarget(null)
    } catch {
      setError('Failed to revoke key')
    } finally {
      setIsRevoking(false)
    }
  }

  function copyKey() {
    if (!createdKey) return
    navigator.clipboard.writeText(createdKey.raw_key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function togglePipeline(name: string) {
    setForm(prev => ({
      ...prev,
      pipeline_ids: prev.pipeline_ids.includes(name)
        ? prev.pipeline_ids.filter(p => p !== name)
        : [...prev.pipeline_ids, name],
    }))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-5 border-b border-[var(--color-border)] gap-4 animate-in fade-in duration-200">
        <PageHeader title="Access Keys" />
        <div>
          <p className="text-base font-bold text-[var(--color-text-main)] font-medium">
            Pipeline-scoped API keys for client applications
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition text-sm font-semibold whitespace-nowrap"
          >
            <Plus size={16} /> Generate Key
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Revealed key banner — shown once after creation */}
      {createdKey && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-amber-800 font-bold">
            <Shield size={18} />
            Save your key — it will not be shown again
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-[var(--color-bg)] border border-amber-200 rounded-lg px-4 py-2 text-sm font-mono text-[var(--color-text-main)] overflow-x-auto">
              {rawKeyVisible ? createdKey.raw_key : '•'.repeat(48)}
            </code>
            <button
              onClick={() => setRawKeyVisible(v => !v)}
              className="p-2 rounded-lg border border-amber-200 hover:bg-amber-100 text-amber-700"
              title={rawKeyVisible ? 'Hide' : 'Show'}
            >
              {rawKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button
              onClick={copyKey}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-200 hover:bg-amber-100 text-amber-700 text-sm font-semibold"
            >
              {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={() => setCreatedKey(null)}
              className="p-2 rounded-lg border border-amber-200 hover:bg-amber-100 text-amber-700"
            >
              <X size={16} />
            </button>
          </div>
          <p className="text-xs text-amber-700">
            Key: <strong>mk_{createdKey.key_prefix}_…</strong> &nbsp;·&nbsp; Tenant: <strong>{createdKey.tenant_id}</strong>
          </p>
        </div>
      )}

      {/* Keys table */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[var(--color-text-muted)] text-sm">Loading…</div>
        ) : keys.length === 0 ? (
          <div className="p-8 text-center text-[var(--color-text-muted)] text-sm">
            No access keys yet. Generate one to let clients call the API.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                <th className="text-left px-5 py-3">Name / Prefix</th>
                <th className="text-left px-5 py-3">Pipelines</th>
                <th className="text-left px-5 py-3">Rate limit</th>
                <th className="text-left px-5 py-3">Expires</th>
                <th className="text-left px-5 py-3">Last used</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {keys.map(k => (
                <tr key={k.id} className={k.is_active ? '' : 'opacity-50'}>
                  <td className="px-5 py-3">
                    <div className="font-semibold text-[var(--color-text-main)]">{k.name}</div>
                    <div className="text-xs text-[var(--color-text-muted)] font-mono">mk_{k.key_prefix}_…</div>
                  </td>
                  <td className="px-5 py-3">
                    {k.pipeline_ids.length === 0 ? (
                      <span className="text-[var(--color-text-muted)] text-xs">all pipelines</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {k.pipeline_ids.map(p => (
                          <span key={p} className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded text-xs font-mono">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[var(--color-text-muted)]">{k.rate_limit_rpm}/min</td>
                  <td className="px-5 py-3 text-[var(--color-text-muted)]">{fmt(k.expires_at)}</td>
                  <td className="px-5 py-3 text-[var(--color-text-muted)]">{fmt(k.last_used_at)}</td>
                  <td className="px-5 py-3">
                    {k.is_active ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 active-status-pill border rounded-full text-[10px] font-bold tracking-wide uppercase select-none">
                        <span className="w-1.5 h-1.5 rounded-full active-status-dot" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 inactive-status-pill border rounded-full text-[10px] font-bold tracking-wide uppercase select-none">
                        <span className="w-1.5 h-1.5 rounded-full inactive-status-dot" />
                        Revoked
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {k.is_active && (
                      <button
                        onClick={() => setRevokeKeyTarget(k)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-muted)] hover:text-red-600 transition disabled:opacity-50"
                        title="Revoke key"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-[1px] flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <h3 className="font-bold text-[var(--color-text-main)] flex items-center gap-2">
                <Key size={18} className="text-teal-600" /> Generate Access Key
              </h3>
              <button onClick={() => setShowCreate(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Key name</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Production API Key"
                  className="w-full border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-main)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Tenant name</label>
                <input
                  type="text"
                  required
                  list="tenant-list"
                  value={form.tenant_name}
                  onChange={e => setForm(p => ({ ...p, tenant_name: e.target.value }))}
                  placeholder="Existing or new tenant name"
                  className="w-full border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-main)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <datalist id="tenant-list">
                  {tenants.map(t => <option key={t.id} value={t.name} />)}
                </datalist>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">Tenant created automatically if it doesn't exist.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-2">
                  Allowed pipelines <span className="text-[var(--color-text-muted)] font-normal">(none = all pipelines)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {pipelineOptions.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePipeline(p)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold transition ${
                        form.pipeline_ids.includes(p)
                          ? 'border-teal-500 bg-teal-50 text-teal-700'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-text-main)] hover:bg-[var(--color-bg)]'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Rate limit (req/min)</label>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={form.rate_limit_rpm}
                    onChange={e => setForm(p => ({ ...p, rate_limit_rpm: parseInt(e.target.value) || 60 }))}
                    className="w-full border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-main)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Expires (optional)</label>
                  <input
                    type="date"
                    value={form.expires_at}
                    onChange={e => setForm(p => ({ ...p, expires_at: e.target.value }))}
                    className="w-full border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-main)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{formError}</div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm font-semibold transition"
                >
                  {submitting ? 'Generating…' : 'Generate Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CustomDialog
        isOpen={revokeKeyTarget !== null}
        onClose={() => setRevokeKeyTarget(null)}
        onConfirm={confirmRevoke}
        title="Delete Access Key"
        description="Are you sure you want to revoke this access key? Clients using it will immediately lose access."
        itemName={revokeKeyTarget ? `Key: ${revokeKeyTarget.name}` : undefined}
        confirmText="Revoke"
        isDeleting={isRevoking}
        type="delete"
      />
    </div>
  )
}

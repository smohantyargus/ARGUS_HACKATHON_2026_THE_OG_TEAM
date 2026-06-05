import { useEffect, useState } from 'react'
import PageHeader from '@/components/PageHeader'
import { CustomDialog } from '@/components/custom/CustomDialog'
import {
  dataApi,
  type Domain, type EntityDefinition, type FieldDefinition,
  type QueryDefinition, type DomainRecord, type DomainMember,
} from '@/lib/dataApi'
import {
  Plus, Trash2, X, Database, BookOpen, FileJson, Users2,
  Eye, ChevronRight, RefreshCw,
} from 'lucide-react'

// ── Shared style constants ────────────────────────────────────────────────────
const INPUT = 'w-full border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-main)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/60 placeholder:text-[var(--color-text-muted)]/50'
const LABEL = 'block text-xs font-semibold text-[var(--color-text-muted)] mb-1 uppercase tracking-wide'
const TH = 'text-left px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide'
const TD = 'px-4 py-3 text-sm text-[var(--color-text-main)]'

// ── Inline modal shell ────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[1px] flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-surface)]">
          <h3 className="font-bold text-[var(--color-text-main)] text-sm">{title}</h3>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition p-1 rounded">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// ── Domain selector pills ─────────────────────────────────────────────────────
function DomainPills({ domains, selected, onSelect }: {
  domains: Domain[]
  selected: string | null
  onSelect: (key: string) => void
}) {
  if (domains.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)] italic mb-6">No domains yet — create one in the Domains tab.</p>
  }
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {domains.map(d => (
        <button key={d.domain_key} onClick={() => onSelect(d.domain_key)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
            selected === d.domain_key
              ? 'bg-teal-600/20 border-teal-500 text-teal-300'
              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-teal-500/50 hover:text-[var(--color-text-main)]'
          }`}
        >
          {d.domain_key}
        </button>
      ))}
    </div>
  )
}

// ── Inline error banner ───────────────────────────────────────────────────────
function ErrBanner({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <div className="text-xs text-red-400 bg-red-950/30 border border-red-800/50 rounded-lg px-3 py-2 mb-4">{msg}</div>
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ msg }: { msg: string }) {
  return <div className="p-8 text-center text-[var(--color-text-muted)] text-sm">{msg}</div>
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAINS TAB
// ─────────────────────────────────────────────────────────────────────────────
function DomainsTab({ domains, loading, onRefresh }: { domains: Domain[]; loading: boolean; onRefresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Domain | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState({ domain_key: '', name: '', description: '' })

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true); setErr(null)
    try {
      await dataApi.post('/domains', form)
      setShowCreate(false)
      setForm({ domain_key: '', name: '', description: '' })
      onRefresh()
    } catch (ex: unknown) {
      const detail = (ex as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setErr(detail ?? 'Failed to create domain')
    } finally { setSubmitting(false) }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await dataApi.delete(`/domains/${deleteTarget.domain_key}`)
      setDeleteTarget(null)
      onRefresh()
    } catch { /* error surfaced via dialog */ } finally { setIsDeleting(false) }
  }

  function f(val: string) { return val.toLowerCase().replace(/[^a-z0-9_]/g, '') }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[var(--color-text-muted)]">{domains.length} domain{domains.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-xs font-semibold transition">
          <Plus size={14} /> New Domain
        </button>
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
        {loading ? <div className="p-8 text-center text-[var(--color-text-muted)] text-sm">Loading…</div>
          : domains.length === 0 ? <EmptyState msg="No domains. Create one to get started." />
          : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
                  <th className={TH}>Key</th>
                  <th className={TH}>Name</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Owner</th>
                  <th className={TH}>Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {domains.map(d => (
                  <tr key={d.domain_key} className="hover:bg-[var(--color-bg)]/40 transition">
                    <td className={TD}>
                      <code className="text-cyan-400 font-mono text-xs bg-cyan-950/30 px-2 py-0.5 rounded">{d.domain_key}</code>
                    </td>
                    <td className={TD + ' font-semibold'}>{d.name}</td>
                    <td className={TD}>
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
                        d.status === 'active'
                          ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50'
                          : 'bg-slate-800/40 text-slate-400 border-slate-700/50'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${d.status === 'active' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                        {d.status}
                      </span>
                    </td>
                    <td className={TD + ' text-[var(--color-text-muted)] text-xs font-mono'}>{d.owner_user_id ?? '—'}</td>
                    <td className={TD + ' text-[var(--color-text-muted)] text-xs'}>
                      {d.created_at ? new Date(d.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setDeleteTarget(d)}
                        className="p-1.5 rounded-lg hover:bg-red-950/40 text-[var(--color-text-muted)] hover:text-red-400 transition"
                        title="Delete domain">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {showCreate && (
        <Modal title="Create Domain" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className={LABEL}>Domain Key <span className="text-red-400">*</span></label>
              <input required className={INPUT} placeholder="civic, finance, health…"
                value={form.domain_key} onChange={e => setForm(p => ({ ...p, domain_key: f(e.target.value) }))} />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Lowercase, letters/numbers/underscores. Cannot be changed later.</p>
            </div>
            <div>
              <label className={LABEL}>Display Name <span className="text-red-400">*</span></label>
              <input required className={INPUT} placeholder="Civic Data Domain"
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className={LABEL}>Description</label>
              <textarea rows={2} className={INPUT} placeholder="Optional description"
                value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <ErrBanner msg={err} />
            <div className="flex justify-end gap-3 pt-2 border-t border-[var(--color-border)]">
              <button type="button" onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition">Cancel</button>
              <button type="submit" disabled={submitting}
                className="px-5 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm font-semibold transition">
                {submitting ? 'Creating…' : 'Create Domain'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <CustomDialog
        isOpen={deleteTarget !== null} onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete} type="delete" isDeleting={isDeleting}
        title="Delete Domain"
        description={`Permanently delete "${deleteTarget?.domain_key}"? All entities, fields, queries, records and memberships will be removed. This cannot be undone.`}
        confirmText="Delete Domain"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DICTIONARY TAB
// ─────────────────────────────────────────────────────────────────────────────
const DATA_TYPES = ['string', 'int', 'float', 'bool', 'datetime', 'enum', 'json', 'ref']

function DictionaryTab({ domains }: { domains: Domain[] }) {
  const [selectedDk, setSelectedDk] = useState<string | null>(null)
  const [entities, setEntities] = useState<EntityDefinition[]>([])
  const [selectedEntity, setSelectedEntity] = useState<EntityDefinition | null>(null)
  const [fields, setFields] = useState<FieldDefinition[]>([])
  const [queries, setQueries] = useState<QueryDefinition[]>([])
  const [loadingEnt, setLoadingEnt] = useState(false)
  const [loadingFld, setLoadingFld] = useState(false)

  // Entity form
  const [showEntityForm, setShowEntityForm] = useState(false)
  const [entityForm, setEntityForm] = useState({ entity_key: '', display_name: '', is_root: false, strict: false, parent_entity: '', description: '' })
  const [deletingEntity, setDeletingEntity] = useState<EntityDefinition | null>(null)
  const [entityErr, setEntityErr] = useState<string | null>(null)
  const [entitySubmitting, setEntitySubmitting] = useState(false)

  // Field form
  const [showFieldForm, setShowFieldForm] = useState(false)
  const [fieldForm, setFieldForm] = useState({ field_key: '', data_type: 'string', required: false, description: '', enum_values: '', min_value: '', max_value: '' })
  const [deletingField, setDeletingField] = useState<FieldDefinition | null>(null)
  const [fieldErr, setFieldErr] = useState<string | null>(null)
  const [fieldSubmitting, setFieldSubmitting] = useState(false)

  // Query form
  const [showQueryForm, setShowQueryForm] = useState(false)
  const [queryForm, setQueryForm] = useState({ query_key: '', entity_key: '', description: '', filter_spec: '{}', projection: '[]' })
  const [deletingQuery, setDeletingQuery] = useState<QueryDefinition | null>(null)
  const [queryErr, setQueryErr] = useState<string | null>(null)
  const [querySubmitting, setQuerySubmitting] = useState(false)

  async function loadEntities(dk: string) {
    setLoadingEnt(true); setSelectedEntity(null); setFields([])
    try {
      const res = await dataApi.get(`/domains/${dk}/entities`)
      setEntities(res.data)
    } finally { setLoadingEnt(false) }
  }

  async function loadFields(dk: string, ek: string) {
    setLoadingFld(true)
    try {
      const [fRes, qRes] = await Promise.all([
        dataApi.get(`/domains/${dk}/entities/${ek}/fields`),
        dataApi.get(`/domains/${dk}/queries`),
      ])
      setFields(fRes.data)
      setQueries(qRes.data.filter((q: QueryDefinition) => q.entity_key === ek))
    } finally { setLoadingFld(false) }
  }

  async function loadQueries(dk: string) {
    try {
      const res = await dataApi.get(`/domains/${dk}/queries`)
      setQueries(res.data)
    } catch { /* ignore */ }
  }

  function handleSelectDomain(dk: string) {
    setSelectedDk(dk); setEntities([]); setSelectedEntity(null); setFields([]); setQueries([])
    loadEntities(dk)
  }

  function handleSelectEntity(ent: EntityDefinition) {
    setSelectedEntity(ent)
    if (selectedDk) loadFields(selectedDk, ent.entity_key)
  }

  async function createEntity(e: React.FormEvent) {
    e.preventDefault(); setEntitySubmitting(true); setEntityErr(null)
    try {
      await dataApi.post(`/domains/${selectedDk}/entities`, {
        ...entityForm,
        parent_entity: entityForm.parent_entity || null,
        description: entityForm.description || null,
      })
      setShowEntityForm(false)
      setEntityForm({ entity_key: '', display_name: '', is_root: false, strict: false, parent_entity: '', description: '' })
      loadEntities(selectedDk!)
    } catch (ex: unknown) {
      const d = (ex as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setEntityErr(d ?? 'Failed to create entity')
    } finally { setEntitySubmitting(false) }
  }

  async function deleteEntity() {
    if (!deletingEntity || !selectedDk) return
    try {
      await dataApi.delete(`/domains/${selectedDk}/entities/${deletingEntity.entity_key}`)
      setDeletingEntity(null); setSelectedEntity(null); setFields([])
      loadEntities(selectedDk)
    } catch { /* noop */ }
  }

  async function createField(e: React.FormEvent) {
    e.preventDefault(); setFieldSubmitting(true); setFieldErr(null)
    if (!selectedDk || !selectedEntity) return
    try {
      const payload: Record<string, unknown> = {
        field_key: fieldForm.field_key,
        data_type: fieldForm.data_type,
        required: fieldForm.required,
        description: fieldForm.description || null,
      }
      if (fieldForm.data_type === 'enum' && fieldForm.enum_values) {
        payload.enum_values = fieldForm.enum_values.split(',').map(s => s.trim()).filter(Boolean)
      }
      if (fieldForm.min_value) payload.min_value = Number(fieldForm.min_value)
      if (fieldForm.max_value) payload.max_value = Number(fieldForm.max_value)
      await dataApi.post(`/domains/${selectedDk}/entities/${selectedEntity.entity_key}/fields`, payload)
      setShowFieldForm(false)
      setFieldForm({ field_key: '', data_type: 'string', required: false, description: '', enum_values: '', min_value: '', max_value: '' })
      loadFields(selectedDk, selectedEntity.entity_key)
    } catch (ex: unknown) {
      const d = (ex as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFieldErr(d ?? 'Failed to create field')
    } finally { setFieldSubmitting(false) }
  }

  async function deleteField() {
    if (!deletingField || !selectedDk || !selectedEntity) return
    try {
      await dataApi.delete(`/domains/${selectedDk}/entities/${selectedEntity.entity_key}/fields/${deletingField.field_key}`)
      setDeletingField(null)
      loadFields(selectedDk, selectedEntity.entity_key)
    } catch { /* noop */ }
  }

  async function createQuery(e: React.FormEvent) {
    e.preventDefault(); setQuerySubmitting(true); setQueryErr(null)
    if (!selectedDk) return
    try {
      let filterSpec: unknown = null
      let projection: unknown = null
      try { filterSpec = JSON.parse(queryForm.filter_spec) } catch { setQueryErr('filter_spec must be valid JSON'); setQuerySubmitting(false); return }
      try { projection = JSON.parse(queryForm.projection) } catch { setQueryErr('projection must be valid JSON array'); setQuerySubmitting(false); return }
      await dataApi.post(`/domains/${selectedDk}/queries`, {
        query_key: queryForm.query_key,
        entity_key: queryForm.entity_key,
        description: queryForm.description || null,
        filter_spec: filterSpec,
        projection: projection,
      })
      setShowQueryForm(false)
      setQueryForm({ query_key: '', entity_key: '', description: '', filter_spec: '{}', projection: '[]' })
      if (selectedEntity) loadFields(selectedDk, selectedEntity.entity_key)
      else loadQueries(selectedDk)
    } catch (ex: unknown) {
      const d = (ex as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setQueryErr(d ?? 'Failed to create query')
    } finally { setQuerySubmitting(false) }
  }

  async function deleteQuery() {
    if (!deletingQuery || !selectedDk) return
    try {
      await dataApi.delete(`/domains/${selectedDk}/queries/${deletingQuery.query_key}`)
      setDeletingQuery(null)
      if (selectedEntity) loadFields(selectedDk, selectedEntity.entity_key)
      else loadQueries(selectedDk)
    } catch { /* noop */ }
  }

  return (
    <div>
      <DomainPills domains={domains} selected={selectedDk} onSelect={handleSelectDomain} />

      {!selectedDk ? (
        <div className="text-sm text-[var(--color-text-muted)] italic">Select a domain above to manage its data dictionary.</div>
      ) : (
        <div className="space-y-6">
          {/* ── Entities + Fields ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            {/* Entities */}
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
                <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Entities</span>
                <button onClick={() => setShowEntityForm(true)}
                  className="flex items-center gap-1 px-3 py-1 bg-teal-600 text-white rounded text-xs font-semibold hover:bg-teal-700 transition">
                  <Plus size={12} /> Add
                </button>
              </div>
              {loadingEnt ? <EmptyState msg="Loading…" />
                : entities.length === 0 ? <EmptyState msg="No entities yet." />
                : (
                  <ul className="divide-y divide-[var(--color-border)]">
                    {entities.map(ent => (
                      <li key={ent.entity_key}
                        className={`flex items-center justify-between px-4 py-3 cursor-pointer transition hover:bg-[var(--color-bg)]/50 ${
                          selectedEntity?.entity_key === ent.entity_key ? 'bg-teal-950/20 border-l-2 border-teal-500' : ''
                        }`}
                        onClick={() => handleSelectEntity(ent)}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <code className="text-xs text-cyan-400 font-mono">{ent.entity_key}</code>
                            {ent.is_root && <span className="text-[9px] bg-teal-950/50 text-teal-400 border border-teal-800/50 px-1.5 py-0.5 rounded font-bold">ROOT</span>}
                          </div>
                          {ent.display_name && <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{ent.display_name}</div>}
                        </div>
                        <div className="flex items-center gap-1">
                          <ChevronRight size={14} className={`text-[var(--color-text-muted)] transition ${selectedEntity?.entity_key === ent.entity_key ? 'text-teal-400' : ''}`} />
                          <button onClick={e => { e.stopPropagation(); setDeletingEntity(ent) }}
                            className="p-1 rounded hover:bg-red-950/40 text-[var(--color-text-muted)] hover:text-red-400 transition ml-1">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
            </div>

            {/* Fields */}
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
                <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Fields {selectedEntity ? <span className="text-teal-400">— {selectedEntity.entity_key}</span> : ''}
                </span>
                {selectedEntity && (
                  <button onClick={() => setShowFieldForm(true)}
                    className="flex items-center gap-1 px-3 py-1 bg-teal-600 text-white rounded text-xs font-semibold hover:bg-teal-700 transition">
                    <Plus size={12} /> Add
                  </button>
                )}
              </div>
              {!selectedEntity ? <EmptyState msg="Select an entity to view its fields." />
                : loadingFld ? <EmptyState msg="Loading…" />
                : fields.length === 0 ? <EmptyState msg="No fields defined." />
                : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
                        <th className={TH}>Key</th>
                        <th className={TH}>Type</th>
                        <th className={TH}>Req</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {fields.map(f => (
                        <tr key={f.field_key} className="hover:bg-[var(--color-bg)]/40 transition">
                          <td className={TD + ' font-mono text-xs'}>{f.field_key}</td>
                          <td className={TD}>
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800/60 text-slate-300 font-mono">{f.data_type}</span>
                          </td>
                          <td className={TD + ' text-xs'}>
                            {f.required ? <span className="text-red-400">✓</span> : <span className="text-[var(--color-text-muted)]">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <button onClick={() => setDeletingField(f)}
                              className="p-1 rounded hover:bg-red-950/40 text-[var(--color-text-muted)] hover:text-red-400 transition">
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          </div>

          {/* ── Query Definitions ─────────────────────────────────────────────── */}
          <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
              <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Query Definitions</span>
              <button onClick={() => setShowQueryForm(true)}
                className="flex items-center gap-1 px-3 py-1 bg-teal-600 text-white rounded text-xs font-semibold hover:bg-teal-700 transition">
                <Plus size={12} /> Add Query
              </button>
            </div>
            {queries.length === 0 ? <EmptyState msg="No query definitions." />
              : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
                      <th className={TH}>Query Key</th>
                      <th className={TH}>Entity</th>
                      <th className={TH}>Description</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {queries.map(q => (
                      <tr key={q.query_key} className="hover:bg-[var(--color-bg)]/40 transition">
                        <td className={TD + ' font-mono text-xs text-cyan-400'}>{q.query_key}</td>
                        <td className={TD + ' text-xs font-mono text-[var(--color-text-muted)]'}>{q.entity_key}</td>
                        <td className={TD + ' text-xs text-[var(--color-text-muted)]'}>{q.description ?? '—'}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => setDeletingQuery(q)}
                            className="p-1 rounded hover:bg-red-950/40 text-[var(--color-text-muted)] hover:text-red-400 transition">
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      )}

      {/* Entity create modal */}
      {showEntityForm && (
        <Modal title="Add Entity" onClose={() => setShowEntityForm(false)}>
          <form onSubmit={createEntity} className="space-y-4">
            <div>
              <label className={LABEL}>Entity Key <span className="text-red-400">*</span></label>
              <input required className={INPUT} placeholder="region, icu_capacity…"
                value={entityForm.entity_key}
                onChange={e => setEntityForm(p => ({ ...p, entity_key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))} />
            </div>
            <div>
              <label className={LABEL}>Display Name</label>
              <input className={INPUT} placeholder="Human-readable name"
                value={entityForm.display_name} onChange={e => setEntityForm(p => ({ ...p, display_name: e.target.value }))} />
            </div>
            <div>
              <label className={LABEL}>Parent Entity</label>
              <select className={INPUT} value={entityForm.parent_entity}
                onChange={e => setEntityForm(p => ({ ...p, parent_entity: e.target.value }))}>
                <option value="">None (root)</option>
                {entities.map(ent => <option key={ent.entity_key} value={ent.entity_key}>{ent.entity_key}</option>)}
              </select>
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer">
                <input type="checkbox" checked={entityForm.is_root}
                  onChange={e => setEntityForm(p => ({ ...p, is_root: e.target.checked }))} />
                Root entity
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer">
                <input type="checkbox" checked={entityForm.strict}
                  onChange={e => setEntityForm(p => ({ ...p, strict: e.target.checked }))} />
                Strict (reject unknown fields)
              </label>
            </div>
            <div>
              <label className={LABEL}>Description</label>
              <textarea rows={2} className={INPUT} value={entityForm.description}
                onChange={e => setEntityForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <ErrBanner msg={entityErr} />
            <div className="flex justify-end gap-3 pt-2 border-t border-[var(--color-border)]">
              <button type="button" onClick={() => setShowEntityForm(false)}
                className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition">Cancel</button>
              <button type="submit" disabled={entitySubmitting}
                className="px-5 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm font-semibold transition">
                {entitySubmitting ? 'Creating…' : 'Add Entity'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Field create modal */}
      {showFieldForm && selectedEntity && (
        <Modal title={`Add Field — ${selectedEntity.entity_key}`} onClose={() => setShowFieldForm(false)}>
          <form onSubmit={createField} className="space-y-4">
            <div>
              <label className={LABEL}>Field Key <span className="text-red-400">*</span></label>
              <input required className={INPUT} placeholder="bed_count, daily_loss_usd…"
                value={fieldForm.field_key}
                onChange={e => setFieldForm(p => ({ ...p, field_key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))} />
            </div>
            <div>
              <label className={LABEL}>Data Type <span className="text-red-400">*</span></label>
              <select required className={INPUT} value={fieldForm.data_type}
                onChange={e => setFieldForm(p => ({ ...p, data_type: e.target.value }))}>
                {DATA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {fieldForm.data_type === 'enum' && (
              <div>
                <label className={LABEL}>Enum Values (comma-separated)</label>
                <input className={INPUT} placeholder="active, inactive, pending"
                  value={fieldForm.enum_values} onChange={e => setFieldForm(p => ({ ...p, enum_values: e.target.value }))} />
              </div>
            )}
            {(fieldForm.data_type === 'int' || fieldForm.data_type === 'float') && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Min Value</label>
                  <input type="number" className={INPUT} value={fieldForm.min_value}
                    onChange={e => setFieldForm(p => ({ ...p, min_value: e.target.value }))} />
                </div>
                <div>
                  <label className={LABEL}>Max Value</label>
                  <input type="number" className={INPUT} value={fieldForm.max_value}
                    onChange={e => setFieldForm(p => ({ ...p, max_value: e.target.value }))} />
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer">
              <input type="checkbox" checked={fieldForm.required}
                onChange={e => setFieldForm(p => ({ ...p, required: e.target.checked }))} />
              Required field
            </label>
            <div>
              <label className={LABEL}>Description</label>
              <input className={INPUT} value={fieldForm.description}
                onChange={e => setFieldForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <ErrBanner msg={fieldErr} />
            <div className="flex justify-end gap-3 pt-2 border-t border-[var(--color-border)]">
              <button type="button" onClick={() => setShowFieldForm(false)}
                className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition">Cancel</button>
              <button type="submit" disabled={fieldSubmitting}
                className="px-5 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm font-semibold transition">
                {fieldSubmitting ? 'Adding…' : 'Add Field'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Query create modal */}
      {showQueryForm && (
        <Modal title="Add Query Definition" onClose={() => setShowQueryForm(false)}>
          <form onSubmit={createQuery} className="space-y-4">
            <div>
              <label className={LABEL}>Query Key <span className="text-red-400">*</span></label>
              <input required className={INPUT} placeholder="icu_capacity_by_region"
                value={queryForm.query_key}
                onChange={e => setQueryForm(p => ({ ...p, query_key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))} />
            </div>
            <div>
              <label className={LABEL}>Entity Key <span className="text-red-400">*</span></label>
              <select required className={INPUT} value={queryForm.entity_key}
                onChange={e => setQueryForm(p => ({ ...p, entity_key: e.target.value }))}>
                <option value="">Select entity…</option>
                {entities.map(ent => <option key={ent.entity_key} value={ent.entity_key}>{ent.entity_key}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL}>Filter Spec (JSON)</label>
              <textarea rows={2} className={INPUT + ' font-mono text-xs'} placeholder='{"region_id": "{{region}}"}'
                value={queryForm.filter_spec} onChange={e => setQueryForm(p => ({ ...p, filter_spec: e.target.value }))} />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Use {'{{param}}'} for runtime parameters.</p>
            </div>
            <div>
              <label className={LABEL}>Projection (JSON array)</label>
              <textarea rows={2} className={INPUT + ' font-mono text-xs'} placeholder='["field1", "field2"]'
                value={queryForm.projection} onChange={e => setQueryForm(p => ({ ...p, projection: e.target.value }))} />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Empty array = return all fields.</p>
            </div>
            <div>
              <label className={LABEL}>Description</label>
              <input className={INPUT} value={queryForm.description}
                onChange={e => setQueryForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <ErrBanner msg={queryErr} />
            <div className="flex justify-end gap-3 pt-2 border-t border-[var(--color-border)]">
              <button type="button" onClick={() => setShowQueryForm(false)}
                className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition">Cancel</button>
              <button type="submit" disabled={querySubmitting}
                className="px-5 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm font-semibold transition">
                {querySubmitting ? 'Adding…' : 'Add Query'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <CustomDialog isOpen={deletingEntity !== null} onClose={() => setDeletingEntity(null)}
        onConfirm={deleteEntity} type="delete"
        title="Delete Entity" description={`Delete entity "${deletingEntity?.entity_key}" and all its fields?`} confirmText="Delete Entity" />
      <CustomDialog isOpen={deletingField !== null} onClose={() => setDeletingField(null)}
        onConfirm={deleteField} type="delete"
        title="Delete Field" description={`Delete field "${deletingField?.field_key}"?`} confirmText="Delete Field" />
      <CustomDialog isOpen={deletingQuery !== null} onClose={() => setDeletingQuery(null)}
        onConfirm={deleteQuery} type="delete"
        title="Delete Query" description={`Delete query "${deletingQuery?.query_key}"?`} confirmText="Delete Query" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// RECORDS TAB
// ─────────────────────────────────────────────────────────────────────────────
function RecordsTab({ domains }: { domains: Domain[] }) {
  const [selectedDk, setSelectedDk] = useState<string | null>(null)
  const [entities, setEntities] = useState<EntityDefinition[]>([])
  const [selectedEk, setSelectedEk] = useState<string | null>(null)
  const [records, setRecords] = useState<DomainRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [viewRecord, setViewRecord] = useState<DomainRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DomainRecord | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ record_key: '', data: '{}' })
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function loadEntities(dk: string) {
    setSelectedEk(null); setRecords([])
    const res = await dataApi.get(`/domains/${dk}/entities`)
    setEntities(res.data)
  }

  async function loadRecords(dk: string, ek: string) {
    setLoading(true)
    try {
      const res = await dataApi.get(`/${dk}/${ek}`)
      setRecords(res.data)
    } finally { setLoading(false) }
  }

  function handleSelectDomain(dk: string) {
    setSelectedDk(dk); setEntities([]); setSelectedEk(null); setRecords([])
    loadEntities(dk)
  }

  function handleSelectEntity(ek: string) {
    setSelectedEk(ek)
    if (selectedDk) loadRecords(selectedDk, ek)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setCreateErr(null); setSubmitting(true)
    if (!selectedDk || !selectedEk) return
    try {
      let data: unknown
      try { data = JSON.parse(createForm.data) } catch { setCreateErr('data must be valid JSON'); setSubmitting(false); return }
      await dataApi.post(`/${selectedDk}/${selectedEk}`, {
        record_key: createForm.record_key || null,
        data,
      })
      setShowCreate(false)
      setCreateForm({ record_key: '', data: '{}' })
      loadRecords(selectedDk, selectedEk)
    } catch (ex: unknown) {
      const d = (ex as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setCreateErr(d ?? 'Failed to create record')
    } finally { setSubmitting(false) }
  }

  async function handleDelete() {
    if (!deleteTarget || !selectedDk || !selectedEk) return
    try {
      await dataApi.delete(`/${selectedDk}/${selectedEk}/${deleteTarget.id}`)
      setDeleteTarget(null)
      loadRecords(selectedDk, selectedEk)
    } catch { /* noop */ }
  }

  return (
    <div>
      <DomainPills domains={domains} selected={selectedDk} onSelect={handleSelectDomain} />

      {selectedDk && entities.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {entities.map(ent => (
            <button key={ent.entity_key} onClick={() => handleSelectEntity(ent.entity_key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                selectedEk === ent.entity_key
                  ? 'bg-cyan-950/40 border-cyan-500 text-cyan-300'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-cyan-500/50 hover:text-[var(--color-text-main)]'
              }`}>
              {ent.entity_key}
            </button>
          ))}
        </div>
      )}

      {selectedDk && selectedEk && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-[var(--color-text-muted)]">{records.length} record{records.length !== 1 ? 's' : ''}</p>
            <div className="flex gap-2">
              <button onClick={() => loadRecords(selectedDk, selectedEk)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition">
                <RefreshCw size={12} /> Refresh
              </button>
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-xs font-semibold transition">
                <Plus size={14} /> New Record
              </button>
            </div>
          </div>

          <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
            {loading ? <EmptyState msg="Loading…" />
              : records.length === 0 ? <EmptyState msg="No records." />
              : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
                      <th className={TH}>ID</th>
                      <th className={TH}>Record Key</th>
                      <th className={TH}>Data Preview</th>
                      <th className={TH}>Updated</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {records.map(r => (
                      <tr key={r.id} className="hover:bg-[var(--color-bg)]/40 transition">
                        <td className={TD + ' text-xs text-[var(--color-text-muted)] font-mono'}>{r.id}</td>
                        <td className={TD + ' font-mono text-xs text-cyan-400'}>{r.record_key ?? '—'}</td>
                        <td className={TD + ' max-w-xs truncate text-xs text-[var(--color-text-muted)] font-mono'}>
                          {JSON.stringify(r.data).slice(0, 80)}…
                        </td>
                        <td className={TD + ' text-xs text-[var(--color-text-muted)]'}>
                          {r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}
                        </td>
                        <td className="px-4 py-3 flex items-center gap-1">
                          <button onClick={() => setViewRecord(r)}
                            className="p-1.5 rounded hover:bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition"
                            title="View data">
                            <Eye size={13} />
                          </button>
                          <button onClick={() => setDeleteTarget(r)}
                            className="p-1.5 rounded hover:bg-red-950/40 text-[var(--color-text-muted)] hover:text-red-400 transition"
                            title="Delete">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      )}

      {!selectedDk && <div className="text-sm text-[var(--color-text-muted)] italic">Select a domain above.</div>}
      {selectedDk && !selectedEk && entities.length > 0 && (
        <div className="text-sm text-[var(--color-text-muted)] italic">Select an entity above to browse records.</div>
      )}

      {/* View record modal */}
      {viewRecord && (
        <Modal title={`Record #${viewRecord.id} — ${viewRecord.record_key ?? 'no key'}`} onClose={() => setViewRecord(null)}>
          <pre className="text-xs font-mono bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg p-4 overflow-x-auto text-[var(--color-text-main)] leading-relaxed max-h-96 overflow-y-auto">
            {JSON.stringify(viewRecord.data, null, 2)}
          </pre>
          <div className="flex justify-end mt-4">
            <button onClick={() => setViewRecord(null)}
              className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition">Close</button>
          </div>
        </Modal>
      )}

      {/* Create record modal */}
      {showCreate && (
        <Modal title={`New Record — ${selectedEk}`} onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className={LABEL}>Record Key (optional)</label>
              <input className={INPUT} placeholder="Natural key, e.g. metro, nyc"
                value={createForm.record_key} onChange={e => setCreateForm(p => ({ ...p, record_key: e.target.value }))} />
            </div>
            <div>
              <label className={LABEL}>Data (JSON) <span className="text-red-400">*</span></label>
              <textarea required rows={8} className={INPUT + ' font-mono text-xs'}
                value={createForm.data} onChange={e => setCreateForm(p => ({ ...p, data: e.target.value }))} />
            </div>
            <ErrBanner msg={createErr} />
            <div className="flex justify-end gap-3 pt-2 border-t border-[var(--color-border)]">
              <button type="button" onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition">Cancel</button>
              <button type="submit" disabled={submitting}
                className="px-5 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm font-semibold transition">
                {submitting ? 'Creating…' : 'Create Record'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <CustomDialog isOpen={deleteTarget !== null} onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete} type="delete"
        title="Delete Record"
        description={`Delete record #${deleteTarget?.id} (key: ${deleteTarget?.record_key ?? 'none'})?`}
        confirmText="Delete Record" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MEMBERS TAB
// ─────────────────────────────────────────────────────────────────────────────
const ROLES = ['viewer', 'editor', 'owner']

function MembersTab({ domains }: { domains: Domain[] }) {
  const [selectedDk, setSelectedDk] = useState<string | null>(null)
  const [members, setMembers] = useState<DomainMember[]>([])
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ user_id: '', role: 'viewer' })
  const [addErr, setAddErr] = useState<string | null>(null)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<DomainMember | null>(null)
  const [updatingRole, setUpdatingRole] = useState<number | null>(null)

  async function loadMembers(dk: string) {
    setLoading(true)
    try {
      const res = await dataApi.get(`/domains/${dk}/members`)
      setMembers(res.data)
    } finally { setLoading(false) }
  }

  function handleSelectDomain(dk: string) {
    setSelectedDk(dk); setMembers([])
    loadMembers(dk)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault(); setAddErr(null); setAddSubmitting(true)
    if (!selectedDk) return
    try {
      await dataApi.post(`/domains/${selectedDk}/members`, addForm)
      setShowAdd(false)
      setAddForm({ user_id: '', role: 'viewer' })
      loadMembers(selectedDk)
    } catch (ex: unknown) {
      const d = (ex as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setAddErr(d ?? 'Failed to add member')
    } finally { setAddSubmitting(false) }
  }

  async function handleChangeRole(member: DomainMember, newRole: string) {
    if (!selectedDk) return
    setUpdatingRole(member.id)
    try {
      await dataApi.patch(`/domains/${selectedDk}/members/${member.user_id}`, { role: newRole })
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m))
    } catch { /* noop */ } finally { setUpdatingRole(null) }
  }

  async function handleRemove() {
    if (!removeTarget || !selectedDk) return
    try {
      await dataApi.delete(`/domains/${selectedDk}/members/${removeTarget.user_id}`)
      setRemoveTarget(null)
      loadMembers(selectedDk)
    } catch { /* noop */ }
  }

  const roleColor: Record<string, string> = {
    owner: 'bg-amber-950/40 text-amber-400 border-amber-800/50',
    editor: 'bg-blue-950/40 text-blue-400 border-blue-800/50',
    viewer: 'bg-slate-800/40 text-slate-400 border-slate-700/50',
  }

  return (
    <div>
      <DomainPills domains={domains} selected={selectedDk} onSelect={handleSelectDomain} />

      {!selectedDk && <div className="text-sm text-[var(--color-text-muted)] italic">Select a domain to manage membership.</div>}

      {selectedDk && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-[var(--color-text-muted)]">{members.length} member{members.length !== 1 ? 's' : ''}</p>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-xs font-semibold transition">
              <Plus size={14} /> Add Member
            </button>
          </div>

          <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
            {loading ? <EmptyState msg="Loading…" />
              : members.length === 0 ? <EmptyState msg="No members yet." />
              : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
                      <th className={TH}>User ID</th>
                      <th className={TH}>Role</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {members.map(m => (
                      <tr key={m.id} className="hover:bg-[var(--color-bg)]/40 transition">
                        <td className={TD + ' font-mono text-xs'}>{m.user_id}</td>
                        <td className={TD}>
                          <div className="flex items-center gap-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${roleColor[m.role] ?? roleColor.viewer}`}>
                              {m.role}
                            </span>
                            <select
                              value={m.role}
                              disabled={updatingRole === m.id}
                              onChange={e => handleChangeRole(m, e.target.value)}
                              className="text-xs border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-muted)] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500/60 disabled:opacity-50"
                            >
                              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => setRemoveTarget(m)}
                            className="p-1.5 rounded hover:bg-red-950/40 text-[var(--color-text-muted)] hover:text-red-400 transition"
                            title="Remove member">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      )}

      {showAdd && (
        <Modal title="Add Member" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className={LABEL}>User ID <span className="text-red-400">*</span></label>
              <input required className={INPUT} placeholder="username or user UUID"
                value={addForm.user_id} onChange={e => setAddForm(p => ({ ...p, user_id: e.target.value.trim() }))} />
            </div>
            <div>
              <label className={LABEL}>Role</label>
              <select className={INPUT} value={addForm.role} onChange={e => setAddForm(p => ({ ...p, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <ErrBanner msg={addErr} />
            <div className="flex justify-end gap-3 pt-2 border-t border-[var(--color-border)]">
              <button type="button" onClick={() => setShowAdd(false)}
                className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition">Cancel</button>
              <button type="submit" disabled={addSubmitting}
                className="px-5 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 text-sm font-semibold transition">
                {addSubmitting ? 'Adding…' : 'Add Member'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <CustomDialog isOpen={removeTarget !== null} onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove} type="delete"
        title="Remove Member"
        description={`Remove "${removeTarget?.user_id}" from domain "${selectedDk}"?`}
        confirmText="Remove" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
type Tab = 'domains' | 'dictionary' | 'records' | 'members'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'domains',    label: 'Domains',    icon: <Database size={14} /> },
  { id: 'dictionary', label: 'Dictionary', icon: <BookOpen size={14} /> },
  { id: 'records',    label: 'Records',    icon: <FileJson size={14} /> },
  { id: 'members',    label: 'Members',    icon: <Users2 size={14} /> },
]

export default function DataPlatform() {
  const [tab, setTab] = useState<Tab>('domains')
  const [domains, setDomains] = useState<Domain[]>([])
  const [loadingDomains, setLoadingDomains] = useState(true)

  async function loadDomains() {
    setLoadingDomains(true)
    try {
      const res = await dataApi.get('/domains')
      setDomains(res.data)
    } catch { /* auth error handled by interceptor */ } finally { setLoadingDomains(false) }
  }

  useEffect(() => { loadDomains() }, [])

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
      <PageHeader title="Data Platform" />

      <div className="flex gap-1 mb-8">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-200 ${
              tab === t.id
                ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-500/20 shadow-[0_0_12px_rgba(34,211,238,0.08)]'
                : 'text-white/40 hover:text-white/75 hover:bg-white/[0.04] border border-transparent'
            }`}
          >
            <span className={tab === t.id ? 'text-cyan-400' : 'opacity-50'}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {tab === 'domains'    && <DomainsTab    domains={domains} loading={loadingDomains} onRefresh={loadDomains} />}
        {tab === 'dictionary' && <DictionaryTab domains={domains} />}
        {tab === 'records'    && <RecordsTab    domains={domains} />}
        {tab === 'members'    && <MembersTab    domains={domains} />}
      </div>
    </div>
  )
}

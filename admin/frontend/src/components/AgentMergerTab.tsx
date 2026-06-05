import { useState, useEffect, useRef } from 'react'
import { Plus, GitMerge, X, Edit2, Info } from 'lucide-react'
import { configApi } from '@/lib/api'
import { CustomDialog } from '@/components/custom/CustomDialog'
import { ImportExportControls } from '@/components/ImportExportControls'
import { Button } from '@/components/custom/Button'

export interface ResponseMergerDef {
  id: string; name: string; display_name?: string; description?: string
  input_topic_map: Record<string, string>
  output_topic: string; timeout_seconds: number; is_active: boolean
}

interface MergerFormState {
  name: string; display_name: string; description: string
  input_topic_map: Record<string, string>
  output_topic: string; timeout_seconds: number
}

const EMPTY_MERGER: MergerFormState = {
  name: '', display_name: '', description: '',
  input_topic_map: {},
  output_topic: '', timeout_seconds: 60,
}

const inputCls = "w-full bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-main)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500/50 transition-all"
const labelCls = "block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-1 font-mono"

interface Props {
  mergers: ResponseMergerDef[]
  onRefresh: () => void
}

export function AgentMergerTab({ mergers, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editMerger, setEditMerger] = useState<ResponseMergerDef | null>(null)
  const [form, setForm] = useState<MergerFormState>({ ...EMPTY_MERGER })
  const [topicInput, setTopicInput] = useState('')
  const [fieldInput, setFieldInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteMergerName, setDeleteMergerName] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [dialog, setDialog] = useState<{
    isOpen: boolean
    title: string
    description: string
    type: 'alert' | 'confirm' | 'delete' | 'prompt'
    variant?: 'info' | 'success' | 'warning' | 'error'
    confirmText?: string
    onConfirm?: () => void | Promise<void>
    promptValue?: string
    onPromptConfirm?: (val: string) => void | Promise<void>
  }>({
    isOpen: false,
    title: '',
    description: '',
    type: 'alert'
  })

  const showAlert = (title: string, desc: string, variant: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setDialog({
      isOpen: true,
      title,
      description: desc,
      type: 'alert',
      variant
    })
  }

  function openCreate() {
    setEditMerger(null)
    setForm({ ...EMPTY_MERGER })
    setTopicInput('')
    setFieldInput('')
    setShowForm(true)
  }

  function openEdit(m: ResponseMergerDef) {
    setEditMerger(m)
    setForm({
      name: m.name, display_name: m.display_name ?? '',
      description: m.description ?? '',
      input_topic_map: { ...m.input_topic_map },
      output_topic: m.output_topic,
      timeout_seconds: m.timeout_seconds,
    })
    setTopicInput('')
    setFieldInput('')
    setShowForm(true)
  }

  function addTopic() {
    const topic = topicInput.trim()
    const field = fieldInput.trim()
    if (!topic || !field) return
    setForm(p => ({ ...p, input_topic_map: { ...p.input_topic_map, [topic]: field } }))
    setTopicInput('')
    setFieldInput('')
  }

  function removeTopic(topic: string) {
    setForm(p => {
      const m = { ...p.input_topic_map }
      delete m[topic]
      return { ...p, input_topic_map: m }
    })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        ...form,
        display_name: form.display_name || null,
        description: form.description || null,
      }
      if (editMerger) {
        await configApi.patch(`/internal/response-mergers/${editMerger.name}`, payload)
      } else {
        await configApi.post('/internal/response-mergers/', payload)
      }
      setShowForm(false)
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  function handleDelete(name: string) {
    setDeleteMergerName(name)
  }

  async function confirmDelete() {
    if (!deleteMergerName) return
    setIsDeleting(true)
    try {
      await configApi.delete(`/internal/response-mergers/${deleteMergerName}`)
      onRefresh()
      setDeleteMergerName(null)
    } catch (err) {
      console.error(err)
    } finally {
      setIsDeleting(false)
    }
  }

  async function toggleMerger(m: ResponseMergerDef) {
    await configApi.patch(`/internal/response-mergers/${m.name}`, { is_active: !m.is_active })
    onRefresh()
  }

  function handleImport(items: any[]) {
    const queue: any[] = []
    const instantUpdates: any[] = []

    for (const item of items) {
      const { created_at, updated_at, ...payload } = item
      const existsById = mergers.some(m => m.id === item.id)
      if (existsById) {
        instantUpdates.push({ id: item.id, payload })
      } else {
        queue.push(payload)
      }
    }

    Promise.all(instantUpdates.map(async (u) => {
      const existingMerger = mergers.find(m => m.id === u.id)!
      await configApi.patch(`/internal/response-mergers/${existingMerger.name}`, u.payload)
    })).then(() => {
      processNextQueueItem(queue, 0)
    }).catch(err => {
      console.error(err)
      showAlert('Import Failed', 'Failed to update existing mergers.', 'error')
    })
  }

  async function processNextQueueItem(queue: any[], index: number) {
    if (index >= queue.length) {
      onRefresh()
      showAlert('Import Successful', 'Output mergers imported successfully!', 'success')
      return
    }

    const payload = queue[index]
    const targetName = payload.name
    const existsByName = mergers.some(m => m.name.toLowerCase() === targetName.toLowerCase())

    if (existsByName) {
      showRenameDialog(queue, index, payload, targetName)
    } else {
      try {
        await configApi.post('/internal/response-mergers/', payload)
        processNextQueueItem(queue, index + 1)
      } catch (err: any) {
        console.error(err)
        showAlert('Import Failed', `Failed to import "${targetName}": ${err?.response?.data?.detail || err.message}`, 'error')
      }
    }
  }

  function showRenameDialog(queue: any[], index: number, payload: any, currentName: string, errorMsg?: string) {
    setDialog({
      isOpen: true,
      title: 'Merger Name Conflict',
      description: errorMsg || `A merger with the name "${currentName}" already exists with a different ID. Please enter a new unique name to import it:`,
      type: 'prompt',
      confirmText: 'Import',
      promptValue: currentName + "_copy",
      onPromptConfirm: async (newName: string) => {
        const trimmed = newName.trim()
        if (!trimmed) {
          showRenameDialog(queue, index, payload, currentName, 'Merger name cannot be empty. Please enter a name:')
          return
        }
        const stillExists = mergers.some(m => m.name.toLowerCase() === trimmed.toLowerCase())
        if (stillExists) {
          showRenameDialog(queue, index, payload, trimmed, `The name "${trimmed}" is also taken. Please enter a different unique name:`)
          return
        }
        setDialog(prev => ({ ...prev, isOpen: false }))
        const updatedPayload = { ...payload, name: trimmed }
        try {
          await configApi.post('/internal/response-mergers/', updatedPayload)
          processNextQueueItem(queue, index + 1)
        } catch (err: any) {
          console.error(err)
          showAlert('Import Failed', `Failed to import "${trimmed}": ${err?.response?.data?.detail || err.message}`, 'error')
        }
      }
    })
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-base font-bold text-[var(--color-text-main)]">Output Response Merging</h2>
          
        </div>
        <div className="flex items-center gap-3">
          <ImportExportControls
            onImport={handleImport}
            entityName="Output Merger"
            showExport={false}
            showImport={true}
            requiredKeys={['name', 'input_topic_map', 'output_topic']}
          />
          <Button
            onClick={openCreate}
            variant="primary"
            size="md"
            icon={<Plus size={16} />}
          >
            New Merger
          </Button>
        </div>
      </div>

      {/* Modal Dialog Form */}
      {showForm && (
        <div 
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-[1px] z-50 flex items-center justify-center p-4 md:p-6 lg:p-8 animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div 
            className="w-full max-w-2xl bg-[var(--color-surface)] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-4rem)] border border-[var(--color-border)] animate-scale-in"
          >
            
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0 bg-[var(--color-surface)]">
              <h2 className="text-base font-bold text-[var(--color-text-main)] flex items-center gap-2">
                <GitMerge size={16} className="text-cyan-400" />
                {editMerger ? 'Edit Output Merger' : 'New Output Merger'}
              </h2>
              <button 
                onClick={() => setShowForm(false)} 
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition-colors p-1.5 hover:bg-[var(--color-bg)] rounded-lg cursor-pointer"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>
 
            
            <form onSubmit={handleSave} className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--color-surface)]">
              
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 custom-scrollbar">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Name *</label>
                    <input 
                      required 
                      className={inputCls} 
                      value={form.name} 
                      disabled={!!editMerger}
                      onChange={e => setForm(p => ({ ...p, name: e.target.value }))} 
                      placeholder="epidemic_policy_merger"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Display Name</label>
                    <input 
                      className={inputCls} 
                      value={form.display_name}
                      onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))} 
                      placeholder="Epidemic Policy Merger"
                    />
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Description</label>
                  <input 
                    className={inputCls} 
                    value={form.description}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="Merges epidemiologist, economist, and compliance outputs into one JSON"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Output Topic *</label>
                    <input 
                      required 
                      className={inputCls} 
                      value={form.output_topic}
                      onChange={e => setForm(p => ({ ...p, output_topic: e.target.value }))}
                      placeholder="epidemic.merged"
                    />
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Merged JSON published here once all inputs arrive</p>
                  </div>

                  <div>
                    <label className={labelCls}>Timeout (seconds)</label>
                    <input 
                      type="number" 
                      min={5} 
                      max={300} 
                      className={inputCls} 
                      value={form.timeout_seconds}
                      onChange={e => setForm(p => ({ ...p, timeout_seconds: Number(e.target.value) }))} 
                    />
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Partial results expire from Redis after this long</p>
                  </div>
                </div>

                <div className="bg-[var(--color-bg)] p-4 rounded-xl border border-[var(--color-border)] space-y-3">
                  <div>
                    <label className={labelCls}>Input Topics → Output Fields *</label>
                    <p className="text-[10px] text-[var(--color-text-muted)] mb-2">Each input topic maps to a field name in the merged JSON output</p>
                  </div>
                  
                  <div className="flex gap-2">
                    <input 
                      className={inputCls} 
                      value={topicInput}
                      onChange={e => setTopicInput(e.target.value)}
                      placeholder="epidemiologist.completed.validated"
                    />
                    <input 
                      className="w-40 bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-main)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/25 focus:border-cyan-500/50 transition-all"
                      value={fieldInput}
                      onChange={e => setFieldInput(e.target.value)}
                      placeholder="epidemiologist"
                    />
                    <Button 
                      type="button" 
                      variant="primary"
                      onClick={addTopic}
                    >
                      Add
                    </Button>
                  </div>
                  
                  {Object.keys(form.input_topic_map).length === 0 ? (
                    <p className="text-xs text-[var(--color-text-muted)] italic pt-1">No topics added yet</p>
                  ) : (
                    <div className="space-y-1.5 pt-1">
                      {Object.entries(form.input_topic_map).map(([topic, field]) => (
                        <div key={topic} className="flex items-center gap-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs">
                          <span className="font-mono text-blue-700 flex-1 truncate">{topic}</span>
                          <span className="text-[var(--color-text-muted)]">→</span>
                          <span className="font-mono text-cyan-400 w-32 font-semibold">{field}</span>
                          <button 
                            type="button" 
                            onClick={() => removeTopic(topic)} 
                            className="text-[var(--color-text-muted)] hover:text-red-500 ml-1 cursor-pointer transition-colors"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {Object.keys(form.input_topic_map).length > 0 && (
                    <p className="text-[9px] text-[var(--color-text-muted)] font-mono mt-2 bg-[var(--color-bg)] p-2 rounded border border-[var(--color-border)] truncate">
                      Output schema preview: {`{ ${Object.values(form.input_topic_map).map(f => `"${f}": ...`).join(', ')} }`}
                    </p>
                  )}
                </div>
              </div>

              
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--color-border)] shrink-0 bg-[var(--color-bg)]">
                <Button 
                  type="button" 
                  variant="ghost"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  variant="primary"
                  loading={saving}
                >
                  {editMerger ? 'Save' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {mergers.length === 0 ? (
        <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-12 text-center text-[var(--color-text-muted)]">
          <GitMerge size={36} className="mx-auto mb-3 text-[var(--color-text-muted)] animate-pulse" />
          <p className="font-medium">No output mergers defined yet.</p>
          <p className="text-sm mt-1">Create one above — no code needed.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {mergers.map(m => (
            <MergerRow 
              key={m.name} 
              m={m} 
              onEdit={openEdit} 
              onDelete={handleDelete} 
              onToggle={toggleMerger} 
            />
          ))}
        </div>
      )}

      <CustomDialog
        isOpen={deleteMergerName !== null}
        onClose={() => setDeleteMergerName(null)}
        onConfirm={confirmDelete}
        title="Delete Output Merger"
        description="Are you sure you want to permanently delete this output merger? This action is irreversible."
        itemName={deleteMergerName || undefined}
        isDeleting={isDeleting}
        type="delete"
      />

      <CustomDialog
        isOpen={dialog.isOpen}
        title={dialog.title}
        description={dialog.description}
        type={dialog.type}
        variant={dialog.variant}
        onClose={() => setDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={dialog.onConfirm}
        confirmText={dialog.confirmText}
        promptValue={dialog.promptValue}
        onPromptConfirm={dialog.onPromptConfirm}
      />
    </>
  )
}



function MergerRow({ m, onEdit, 
  // onDelete, 
  onToggle }: {
  m: ResponseMergerDef
  onEdit: (m: ResponseMergerDef) => void
  onDelete: (name: string) => void
  onToggle: (m: ResponseMergerDef) => void
}) {
  const [showInfo, setShowInfo] = useState(false)
  const infoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(event.target as Node)) {
        setShowInfo(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="group bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] flex flex-col transition-all duration-200 hover:border-cyan-500/20 hover:shadow-[0_0_24px_rgba(34,211,238,0.06)] overflow-hidden relative z-0 animate-scale-in p-5">

      
      <div className="flex justify-between items-start mb-4">
        
        
        <div className="flex flex-col min-w-0 flex-1 pr-4">
          <h3 className="text-[var(--color-text-main)] font-bold text-[15px] leading-tight tracking-tight truncate" title={m.display_name || m.name}>
            {m.display_name || m.name}
          </h3>
          <span className="text-[var(--color-text-muted)] font-medium text-[11px] mt-1 font-mono truncate">
            {m.name}
          </span>
        </div>

        
        <div className="flex items-center gap-3 shrink-0 pt-0.5">
          
          
          <button
            onClick={() => onToggle(m)}
            type="button"
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-250 ease-in-out focus:outline-none shadow-2xs ${
              m.is_active ? 'app-toggle-active' : 'app-toggle-inactive'
            }`}
            title={m.is_active ? 'Deactivate Merger' : 'Activate Merger'}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-250 ease-in-out ${
                m.is_active ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          
          
          <button 
            onClick={() => onEdit(m)}
            className="text-[var(--color-text-muted)] hover:text-cyan-400 transition-colors cursor-pointer"
            title="Edit"
          >
            <Edit2 size={15} />
          </button>

          <ImportExportControls
            data={m}
            entityName="Output Merger"
            showExport={true}
            showImport={false}
          />

          <div className="relative flex items-center" ref={infoRef}>
            <button 
              onClick={() => setShowInfo(!showInfo)} 
              className={`transition-colors cursor-pointer ${
                showInfo ? 'text-cyan-400' : 'text-[var(--color-text-muted)] hover:text-cyan-400'
              }`}
              title="Merger Details"
            >
              <Info size={15} />
            </button>

            
            {showInfo && (
              <div className="absolute right-0 top-full mt-2.5 z-40 w-72 bg-[var(--color-surface)] rounded-xl shadow-xl border border-[var(--color-border)] p-4 text-xs animate-scale-in">
                
                
                <div className="absolute right-[6px] -top-1.5 w-3 h-3 bg-[var(--color-surface)] border-t border-l border-[var(--color-border)] rotate-45 z-40"></div>
                
                <div className="flex justify-between items-center mb-3 pb-2 border-b border-[var(--color-border)] relative z-50">
                  <span className="font-bold text-[var(--color-text-main)]">Merger Metadata</span>
                  <button 
                    onClick={() => setShowInfo(false)} 
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] p-0.5 rounded hover:bg-[var(--color-bg)]"
                  >
                    <X size={12} />
                  </button>
                </div>
                
                <div className="space-y-3 relative z-50">
                  
                  <div>
                    <span className="text-[9px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider">Timeout Duration</span>
                    <p className="font-mono text-[10px] text-[var(--color-text-main)] mt-0.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 truncate font-medium">
                      {m.timeout_seconds} seconds
                    </p>
                  </div>
                  
                  
                  <div>
                    <span className="text-[9px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider font-semibold">Input Mappings</span>
                    <div className="space-y-1 mt-1 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                      {Object.entries(m.input_topic_map).map(([topic, field]) => (
                        <div key={topic} className="flex items-center justify-between text-[10px] bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 font-mono">
                          <span className="text-[var(--color-text-muted)] truncate max-w-[120px]" title={topic}>{topic}</span>
                          <span className="text-[var(--color-text-muted)]">➔</span>
                          <span className="text-cyan-400 font-semibold">{field}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Delete Button
          <button 
            onClick={() => onDelete(m.name)} 
            className="text-slate-400 hover:text-red-500 transition-colors cursor-pointer" 
            title="Delete"
          >
            <Trash2 size={15} />
          </button> */}
        </div>

      </div>

      
      <div className="mb-4 min-h-[36px]">
        <p className="text-[var(--color-text-muted)] text-[12px] line-clamp-2 leading-relaxed">
          {m.description }
        </p>
      </div>

      
      <div className="mb-2 flex-1 mt-1">
        <h4 className="text-[9px] font-bold text-white/20 uppercase tracking-widest mb-2 font-mono">Output Topic</h4>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-2 py-1 bg-violet-950/30 text-violet-400/80 font-mono text-[10px] font-medium rounded-md border border-violet-500/15 truncate max-w-[180px]" title={m.output_topic}>
            {m.output_topic || 'none'}
          </span>
        </div>
      </div>

    </div>
  )
}

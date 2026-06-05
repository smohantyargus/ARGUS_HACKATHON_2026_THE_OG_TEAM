import { useState, useEffect, useRef } from 'react'
import { Plus, X, Edit2, Info, ArrowRight, Bot } from 'lucide-react'
import { configApi } from '@/lib/api'
import { CustomSelect } from '@/components/custom/CustomSelect'
import { CustomDialog } from '@/components/custom/CustomDialog'
import { ImportExportControls } from '@/components/ImportExportControls'
import { Button } from '@/components/custom/Button'

type ValidationRuleType = 'not_empty' | 'required_fields' | 'json_schema' | 'none'

interface ValidationRules {
  type: ValidationRuleType
  fields?: string[]
  schema?: object
}

export interface AgentDef {
  id: string; name: string; display_name?: string; description?: string
  input_topic: string; output_topic: string; input_fields: string[]
  system_prompt?: string; user_prompt_template?: string; prompt_action?: string
  llm_instance_name?: string; max_tokens: number; temperature: number
  output_schema?: object | null
  validation_rules?: ValidationRules | null
  is_active: boolean
}

export interface LLMInstance { id: string; name: string; provider: string; is_active: boolean }

interface PromptTemplate {
  action: string
  system_prompt: string
  user_prompt: string
  input_variables?: string[] | null
  output_schema?: object | null
  version: number
}

const inputCls = "w-full bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-main)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
const labelCls = "block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1"

const EMPTY_DEF: Omit<AgentDef, 'id' | 'is_active'> = {
  name: '', display_name: '', description: '',
  input_topic: '', output_topic: '',
  input_fields: [],
  system_prompt: '', user_prompt_template: '', prompt_action: '',
  llm_instance_name: '', max_tokens: 1024, temperature: 0.3,
  output_schema: null,
  validation_rules: { type: 'not_empty' },
}

interface Props {
  defs: AgentDef[]
  llms: LLMInstance[]
  onRefresh: () => void
}

export function AgentGenericTab({ defs, llms, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<AgentDef | null>(null)
  const [form, setForm] = useState({ ...EMPTY_DEF })
  const [fieldInput, setFieldInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteAgentName, setDeleteAgentName] = useState<string | null>(null)
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

  const [promptSource, setPromptSource] = useState<'inline' | 'library'>('inline')
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null)

  const modalRef = useRef<HTMLDivElement>(null)


  useEffect(() => {
    if (showForm) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [showForm])


  useEffect(() => {
    if (!showForm) return


    const focusableElements = modalRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusableElements && focusableElements.length > 0) {
      (focusableElements[0] as HTMLElement).focus()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowForm(false)
        return
      }

      if (e.key === 'Tab') {
        if (!focusableElements || focusableElements.length === 0) return
        const firstEl = focusableElements[0] as HTMLElement
        const lastEl = focusableElements[focusableElements.length - 1] as HTMLElement

        if (e.shiftKey) {
          if (document.activeElement === firstEl) {
            lastEl.focus()
            e.preventDefault()
          }
        } else {
          if (document.activeElement === lastEl) {
            firstEl.focus()
            e.preventDefault()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showForm])

  useEffect(() => {
    configApi.get('/prompts/').then(r => setPromptTemplates(r.data)).catch(() => { })
  }, [])

  function openCreate() {
    setEditTarget(null)
    setForm({ ...EMPTY_DEF })
    setFieldInput('')
    setPromptSource('inline')
    setSelectedTemplate(null)
    setShowForm(true)
  }

  function openEdit(d: AgentDef) {
    setEditTarget(d)
    const hasLibraryRef = !!d.prompt_action && !d.system_prompt && !d.user_prompt_template
    setPromptSource(hasLibraryRef ? 'library' : 'inline')
    setSelectedTemplate(hasLibraryRef ? (promptTemplates.find(t => t.action === d.prompt_action) ?? null) : null)
    setForm({
      name: d.name, display_name: d.display_name ?? '', description: d.description ?? '',
      input_topic: d.input_topic, output_topic: d.output_topic,
      input_fields: [...d.input_fields],
      system_prompt: d.system_prompt ?? '', user_prompt_template: d.user_prompt_template ?? '',
      prompt_action: d.prompt_action ?? '', llm_instance_name: d.llm_instance_name ?? '',
      max_tokens: d.max_tokens, temperature: d.temperature,
      output_schema: d.output_schema ?? null,
      validation_rules: d.validation_rules ?? { type: 'not_empty' },
    })
    setFieldInput('')
    setShowForm(true)
  }

  function addField() {
    const f = fieldInput.trim()
    if (f && !form.input_fields.includes(f)) {
      setForm(p => ({ ...p, input_fields: [...p.input_fields, f] }))
    }
    setFieldInput('')
  }

  function removeField(f: string) {
    setForm(p => ({ ...p, input_fields: p.input_fields.filter(x => x !== f) }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        ...form,
        system_prompt: form.system_prompt || null,
        user_prompt_template: form.user_prompt_template || null,
        prompt_action: form.prompt_action || null,
        llm_instance_name: form.llm_instance_name || null,
        display_name: form.display_name || null,
        description: form.description || null,
      }
      if (editTarget) {
        await configApi.patch(`/internal/agent-definitions/${editTarget.name}`, payload)
      } else {
        await configApi.post('/internal/agent-definitions/', payload)
      }
      setShowForm(false)
      onRefresh()
    } finally {
      setSaving(false)
    }
  }

  function handleDelete(name: string) {
    setDeleteAgentName(name)
  }

  async function confirmDelete() {
    if (!deleteAgentName) return
    setIsDeleting(true)
    try {
      await configApi.delete(`/internal/agent-definitions/${deleteAgentName}`)
      onRefresh()
      setDeleteAgentName(null)
    } catch (err) {
      console.error(err)
    } finally {
      setIsDeleting(false)
    }
  }

  async function toggleActive(d: AgentDef) {
    await configApi.patch(`/internal/agent-definitions/${d.name}`, { is_active: !d.is_active })
    onRefresh()
  }

  function handleImport(items: any[]) {
    const queue: any[] = []
    const instantUpdates: any[] = []

    for (const item of items) {
      const { created_at, updated_at, ...payload } = item
      const existsById = defs.some(d => d.id === item.id)
      if (existsById) {
        instantUpdates.push({ id: item.id, payload })
      } else {
        queue.push(payload)
      }
    }

    Promise.all(instantUpdates.map(async (u) => {
      const existingAgent = defs.find(d => d.id === u.id)!
      await configApi.patch(`/internal/agent-definitions/${existingAgent.name}`, u.payload)
    })).then(() => {
      processNextQueueItem(queue, 0)
    }).catch(err => {
      console.error(err)
      showAlert('Import Failed', 'Failed to update existing agents.', 'error')
    })
  }

  async function processNextQueueItem(queue: any[], index: number) {
    if (index >= queue.length) {
      onRefresh()
      showAlert('Import Successful', 'Generic agents imported successfully!', 'success')
      return
    }

    const payload = queue[index]
    const targetName = payload.name
    const existsByName = defs.some(d => d.name.toLowerCase() === targetName.toLowerCase())

    if (existsByName) {
      showRenameDialog(queue, index, payload, targetName)
    } else {
      try {
        await configApi.post('/internal/agent-definitions/', payload)
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
      title: 'Agent Name Conflict',
      description: errorMsg || `An agent with the name "${currentName}" already exists with a different ID. Please enter a new unique name to import it:`,
      type: 'prompt',
      confirmText: 'Import',
      promptValue: currentName + "_copy",
      onPromptConfirm: async (newName: string) => {
        const trimmed = newName.trim()
        if (!trimmed) {
          showRenameDialog(queue, index, payload, currentName, 'Agent name cannot be empty. Please enter a name:')
          return
        }
        const stillExists = defs.some(d => d.name.toLowerCase() === trimmed.toLowerCase())
        if (stillExists) {
          showRenameDialog(queue, index, payload, trimmed, `The name "${trimmed}" is also taken. Please enter a different unique name:`)
          return
        }
        setDialog(prev => ({ ...prev, isOpen: false }))
        const updatedPayload = { ...payload, name: trimmed }
        try {
          await configApi.post('/internal/agent-definitions/', updatedPayload)
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
      <div className="flex items-center justify-between mb-4">
        <p className="text-base font-semibold text-[var(--color-text-muted)]">
          Manage and configure your generic agents
        </p>

        <div className="flex items-center gap-3">
          <ImportExportControls
            onImport={handleImport}
            entityName="Generic Agent"
            showExport={false}
            showImport={true}
            requiredKeys={['name', 'input_topic', 'output_topic']}
          />
          <Button
            onClick={openCreate}
            variant="primary"
            size="md"
            icon={<Plus size={16} />}
            aria-haspopup="dialog"
            aria-expanded={showForm}
          >
            New Agent
          </Button>
        </div>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-[1px] z-50 flex items-center justify-center p-4 md:p-6 lg:p-8 animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div
            ref={modalRef}
            className="w-full max-w-2xl lg:max-w-5xl bg-[var(--color-surface)] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-4rem)] border border-[var(--color-border)] animate-scale-in"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0 bg-[var(--color-surface)]">
              <h2 className="text-base font-bold text-[var(--color-text-main)] flex items-center gap-2">
                <Bot size={18} className="text-teal-600" />
                {editTarget ? 'Edit Agent' : 'New Generic Agent'}
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition-colors p-1.5 hover:bg-[var(--color-bg)] rounded-lg"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSave} className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--color-surface)]">

              <div className="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">


                  <div className="space-y-6">

                    <div className="bg-[var(--color-bg)] p-5 rounded-xl border border-[var(--color-border)] space-y-4">
                      <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Basic Settings</p>


                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className={labelCls}>Name *</label>
                          <input
                            required
                            value={form.name}
                            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                            disabled={!!editTarget}
                            placeholder="icd-coder"
                            className={`${inputCls} ${editTarget ? 'bg-[var(--color-bg)] text-[var(--color-text-muted)] border-[var(--color-border)] cursor-not-allowed' : ''}`}
                          />
                          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Used as AGENT_NAME env var</p>
                        </div>
                        <div>
                          <label className={labelCls}>Display Name</label>
                          <input
                            value={form.display_name}
                            onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))}
                            placeholder="ICD Code Generator"
                            className={inputCls}
                          />
                        </div>
                      </div>


                      <div>
                        <label className={labelCls}>Description</label>
                        <input
                          value={form.description}
                          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                          placeholder="Generates ICD-10 codes from SOAP notes"
                          className={inputCls}
                        />
                      </div>
                    </div>


                    <div className="bg-[var(--color-bg)] p-5 rounded-xl border border-[var(--color-border)] space-y-4">
                      <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Kafka Pipeline</p>


                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className={labelCls}>Input Topic *</label>
                          <input
                            required
                            value={form.input_topic}
                            onChange={e => setForm(p => ({ ...p, input_topic: e.target.value }))}
                            placeholder="nlp.validated"
                            className={inputCls}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Output Topic *</label>
                          <input
                            required
                            value={form.output_topic}
                            onChange={e => setForm(p => ({ ...p, output_topic: e.target.value }))}
                            placeholder="icd.completed"
                            className={inputCls}
                          />
                        </div>
                      </div>


                      <div className="pt-2">
                        <label className={labelCls}>Input Fields</label>
                        <p className="text-[11px] text-[var(--color-text-muted)] mb-2">
                          Fields extracted from Kafka message — available as {"{{field}}"} in prompts
                        </p>
                        <div className="flex gap-2 mb-3">
                          <input
                            value={fieldInput}
                            onChange={e => setFieldInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addField() } }}
                            placeholder="transcript"
                            className={`${inputCls} flex-1`}
                          />
                          <Button
                            type="button"
                            variant="primary"
                            size="md"
                            onClick={addField}
                          >
                            Add
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {form.input_fields.map(f => (
                            <span key={f} className="flex items-center gap-1.5 bg-teal-50 text-teal-700 text-xs font-mono px-2.5 py-1 rounded-full border border-teal-100/60 shadow-xs">
                              {`{{${f}}}`}
                              <button
                                type="button"
                                onClick={() => removeField(f)}
                                className="text-teal-400 hover:text-teal-700 transition-colors p-0.5 rounded-full hover:bg-teal-100/50"
                                aria-label={`Remove ${f}`}
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>


                  <div className="space-y-6">

                    <div className="bg-[var(--color-bg)] p-5 rounded-xl border border-[var(--color-border)] space-y-4">
                      <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Prompt Configuration</p>


                      <div className="inline-flex p-1 bg-[var(--color-bg)] rounded-lg mb-2">
                        {(['inline', 'library'] as const).map(src => (
                          <button
                            key={src}
                            type="button"
                            onClick={() => {
                              setPromptSource(src)
                              if (src === 'inline') {
                                setForm(p => ({ ...p, prompt_action: '' }))
                                setSelectedTemplate(null)
                              } else {
                                setForm(p => ({ ...p, system_prompt: '', user_prompt_template: '' }))
                              }
                            }}
                            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 ${promptSource === src
                                ? 'bg-[var(--color-surface)] text-[var(--color-text-main)] shadow-xs'
                                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]'
                              }`}
                          >
                            {src === 'inline' ? 'Inline' : 'From Library'}
                          </button>
                        ))}
                      </div>

                      {promptSource === 'library' ? (
                        <div className="space-y-4">
                          <div>
                            <label className={labelCls}>Prompt Template</label>
                            {promptTemplates.length === 0 ? (
                              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                No prompt templates found. Create one in the Config → Prompts page first.
                              </p>
                            ) : (
                              <CustomSelect
                                value={form.prompt_action || ''}
                                onChange={val => {
                                  const tmpl = promptTemplates.find(t => t.action === val) ?? null
                                  setSelectedTemplate(tmpl)
                                  setForm(p => ({ ...p, prompt_action: val }))
                                }}
                                options={[
                                  { value: '', label: '— select a template —' },
                                  ...promptTemplates.map(t => ({
                                    value: t.action,
                                    label: `${t.action} (v${t.version})`
                                  }))
                                ]}
                              />
                            )}
                          </div>

                          {selectedTemplate && (
                            <div className="space-y-3 bg-[var(--color-surface)] rounded-xl p-4 border border-[var(--color-border)]">
                              {selectedTemplate.input_variables && selectedTemplate.input_variables.length > 0 && (
                                <div>
                                  <p className="text-[10px] text-[var(--color-text-muted)] font-bold uppercase tracking-wider mb-1.5">
                                    Variables used in this template
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {selectedTemplate.input_variables.map(v => (
                                      <code key={v} className="text-[10px] bg-teal-50 text-teal-700 border border-teal-100 px-2 py-0.5 rounded font-mono font-medium">
                                        {`{{${v}}}`}
                                      </code>
                                    ))}
                                  </div>
                                  <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
                                    Make sure these fields are listed in Input Fields.
                                  </p>
                                </div>
                              )}
                              <details className="text-[11px] group">
                                <summary className="text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text-main)] font-semibold list-none flex items-center gap-1">
                                  <span className="transition-transform group-open:rotate-90">▶</span> Preview template
                                </summary>
                                <pre className="mt-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg p-3 text-[var(--color-text-main)] overflow-x-auto whitespace-pre-wrap max-h-40 font-mono text-[10px]">
                                  {selectedTemplate.system_prompt}
                                </pre>
                              </details>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div>
                            <label className={labelCls}>System Prompt</label>
                            <textarea
                              rows={4}
                              value={form.system_prompt}
                              onChange={e => setForm(p => ({ ...p, system_prompt: e.target.value }))}
                              placeholder="You are a clinical AI assistant..."
                              className={`${inputCls} resize-y min-h-[100px] font-mono text-xs`}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>User Prompt Template</label>
                            <p className="text-[11px] text-[var(--color-text-muted)] mb-1.5">Use {`{{field}}`} placeholders matching your Input Fields</p>
                            <textarea
                              rows={4}
                              value={form.user_prompt_template}
                              onChange={e => setForm(p => ({ ...p, user_prompt_template: e.target.value }))}
                              placeholder={"Transcript:\n{{transcript}}\n\nAction: {{action}}"}
                              className={`${inputCls} resize-y min-h-[100px] font-mono text-xs`}
                            />
                          </div>
                        </div>
                      )}
                    </div>


                    <div className="bg-[var(--color-bg)] p-5 rounded-xl border border-[var(--color-border)] space-y-4">
                      <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">LLM & Output Validation</p>


                      <div className="space-y-4">
                        <div>
                          <label className={labelCls}>LLM Instance</label>
                          <CustomSelect
                            value={form.llm_instance_name || ''}
                            onChange={val => setForm(p => ({ ...p, llm_instance_name: val }))}
                            options={[
                              { value: '', label: '— use agent registry assignments —' },
                              ...llms.map(l => ({
                                value: l.name,
                                label: `${l.name} (${l.provider})`
                              }))
                            ]}
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className={labelCls}>Max Tokens</label>
                            <input
                              type="number"
                              value={form.max_tokens}
                              onChange={e => setForm(p => ({ ...p, max_tokens: Number(e.target.value) }))}
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <label className={labelCls}>Temperature</label>
                            <input
                              type="number"
                              step="0.05"
                              min="0"
                              max="2"
                              value={form.temperature}
                              onChange={e => setForm(p => ({ ...p, temperature: Number(e.target.value) }))}
                              className={inputCls}
                            />
                          </div>
                        </div>
                      </div>


                      <div className="border-t border-[var(--color-border)] pt-4 space-y-4">
                        <div>
                          <label className={labelCls}>Validation Rule Type</label>
                          <CustomSelect
                            value={form.validation_rules?.type ?? 'not_empty'}
                            onChange={val => setForm(p => ({
                              ...p,
                              validation_rules: { ...p.validation_rules, type: val as ValidationRuleType, fields: [], schema: undefined },
                            }))}
                            options={[
                              { value: 'not_empty', label: 'Not Empty (default)' },
                              { value: 'required_fields', label: 'Required Fields (JSON object)' },
                              { value: 'json_schema', label: 'JSON Schema' },
                              { value: 'none', label: 'None (passthrough)' }
                            ]}
                          />
                        </div>
                        {form.validation_rules?.type === 'required_fields' && (
                          <div>
                            <label className={labelCls}>Required Fields (comma-separated)</label>
                            <input
                              type="text"
                              placeholder="e.g. subjective, objective, assessment, plan"
                              value={(form.validation_rules?.fields ?? []).join(', ')}
                              onChange={e => setForm(p => ({
                                ...p,
                                validation_rules: { ...p.validation_rules!, fields: e.target.value.split(',').map(s => s.trim()).filter(Boolean) },
                              }))}
                              className={inputCls}
                            />
                          </div>
                        )}
                        {form.validation_rules?.type === 'json_schema' && (
                          <div>
                            <label className={labelCls}>JSON Schema</label>
                            <textarea
                              rows={5}
                              placeholder='{"type": "object", "required": ["field1"], "properties": {"field1": {"type": "string"}}}'
                              value={form.validation_rules?.schema ? JSON.stringify(form.validation_rules.schema, null, 2) : ''}
                              onChange={e => {
                                try {
                                  const schema = JSON.parse(e.target.value)
                                  setForm(p => ({ ...p, validation_rules: { ...p.validation_rules!, schema } }))
                                } catch { /* ignore invalid JSON while typing */ }
                              }}
                              className={`${inputCls} resize-y min-h-[100px] font-mono text-xs`}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              </div>


              <div className="px-6 py-4 bg-[var(--color-bg)] border-t border-[var(--color-border)] flex justify-end gap-2 shrink-0">
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
                  className="min-w-[100px]"
                >
                  {editTarget ? 'Save' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {defs.length === 0 ? (
        <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] p-12 text-center text-[var(--color-text-muted)]">
          <p className="font-medium">No generic agents defined yet.</p>
          <p className="text-sm mt-1">Create one above — no code needed.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {defs.map(d => (
            <DefRow
              key={d.name}
              d={d}
              onEdit={openEdit}
              onDelete={handleDelete}
              onToggle={toggleActive}
            />
          ))}
        </div>
      )}

      <div className="mt-12 mb-8">
        <div className="flex items-center gap-4 mb-6 px-2">
          <div className="flex-1 h-px bg-[var(--color-border)]"></div>
          <h2 className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.3em]">Deployment Blueprint</h2>
          <div className="flex-1 h-px bg-[var(--color-border)]"></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
          {/* Left Section */}
          <div className="p-8 border-b md:border-b-0 md:border-r border-[var(--color-border)] flex flex-col pt-10">
            <h3 className="text-lg font-bold text-[var(--color-text-main)] mb-3">Deploy a New Generic Agent</h3>
            <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
              After creating a definition above, add this configuration block to your <code className="bg-[var(--color-bg)] px-1.5 py-0.5 rounded text-[var(--color-text-main)] border border-[var(--color-border)] font-mono text-xs">docker-compose.yml</code> file and bring it up.
            </p>
          </div>


          <div className="bg-[#0f172a] p-6 flex flex-col justify-center overflow-x-auto">
            <pre className="text-[11px] font-mono leading-relaxed text-green-300">{`  generic_agent_<name>:
    build: ./GenericAgent
    container_name: generic_agent_<name>
    restart: on-failure:5
    environment:
      AGENT_NAME: <name>          # must match AgentDefinition.name
      CONFIG_SERVICE_URL: http://config-service:8010
      KAFKA_BOOTSTRAP: kafka:29092
    depends_on:
      kafka:
        condition: service_healthy
      config-service:
        condition: service_healthy
    ports:
      - "81XX:8020"`}</pre>
          </div>
        </div>
      </div>

      <CustomDialog
        isOpen={deleteAgentName !== null}
        onClose={() => setDeleteAgentName(null)}
        onConfirm={confirmDelete}
        title="Delete Agent"
        description="Are you sure you want to permanently delete this agent ? This action is irreversible."
        itemName={deleteAgentName || undefined}
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

// ── Definition row  ────────────────────────────────

function DefRow({ d, onEdit,
  //  onDelete, 
  onToggle }: {
    d: AgentDef
    onEdit: (d: AgentDef) => void
    onDelete: (name: string) => void
    onToggle: (d: AgentDef) => void
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
    <div className="bg-[var(--color-surface)] rounded-xl p-5 border border-[var(--color-border)] border-l-[4px] border-l-teal-600 shadow-sm flex flex-col transition-all duration-300 hover:shadow-md relative z-0">


      <div className="flex justify-between items-start mb-4">


        <div className="flex flex-col min-w-0 flex-1 pr-4">
          <h3 className="text-[var(--color-text-main)] font-bold text-[15px] leading-tight tracking-tight truncate" title={d.display_name || d.name}>
            {d.display_name || d.name}
          </h3>
          <span className="text-[var(--color-text-muted)] font-medium text-[11px] mt-1 font-mono truncate">
            {d.name}
          </span>
        </div>


        <div className="flex items-center gap-3 shrink-0 pt-0.5">


          <button
            onClick={() => onToggle(d)}
            type="button"
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-250 ease-in-out focus:outline-none shadow-2xs ${d.is_active ? 'app-toggle-active' : 'app-toggle-inactive'
              }`}
            title={d.is_active ? 'Deactivate Agent' : 'Activate Agent'}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-250 ease-in-out ${d.is_active ? 'translate-x-4' : 'translate-x-0'
                }`}
            />
          </button>


          <button
            onClick={() => onEdit(d)}
            className="text-[var(--color-text-muted)] hover:text-teal-500 transition-colors cursor-pointer"
            title="Edit"
          >
            <Edit2 size={15} />
          </button>

          <ImportExportControls
            data={d}
            entityName="Generic Agent"
            showExport={true}
            showImport={false}
          />

          <div className="relative flex items-center" ref={infoRef}>
            <button
              onClick={() => setShowInfo(!showInfo)}
              className={`transition-colors cursor-pointer ${showInfo ? 'text-teal-600' : 'text-[var(--color-text-muted)] hover:text-teal-500'
                }`}
              title="Agent Details"
            >
              <Info size={15} />
            </button>


            {showInfo && (
              <div className="absolute right-0 top-full mt-2.5 z-40 w-72 bg-[var(--color-surface)] rounded-xl shadow-xl border border-[var(--color-border)] p-4 text-xs animate-scale-in">


                <div className="absolute right-[6px] -top-1.5 w-3 h-3 bg-[var(--color-surface)] border-t border-l border-[var(--color-border)] rotate-45 z-40"></div>

                <div className="flex justify-between items-center mb-3 pb-2 border-b border-[var(--color-border)] relative z-50">
                  <span className="font-bold text-[var(--color-text-main)]">Agent Metadata</span>
                  <button
                    onClick={() => setShowInfo(false)}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] p-0.5 rounded hover:bg-[var(--color-bg)]"
                  >
                    <X size={12} />
                  </button>
                </div>

                <div className="space-y-3 relative z-50">

                  <div>
                    <span className="text-[9px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider">LLM Model</span>
                    <p className="font-mono text-[10px] text-[var(--color-text-main)] mt-0.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 truncate font-medium">
                      {d.llm_instance_name || 'System Default'}
                    </p>
                  </div>


                  {d.prompt_action && (
                    <div>
                      <span className="text-[9px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider">Prompt Template</span>
                      <p className="font-mono text-[10px] text-[var(--color-text-main)] mt-0.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 truncate font-medium">
                        {d.prompt_action}
                      </p>
                    </div>
                  )}


                  <div>
                    <span className="text-[9px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider">LLM Config</span>
                    <div className="flex justify-between mt-1 text-[10px] text-[var(--color-text-muted)] bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 font-mono">
                      <span>Max Tokens: <strong className="text-[var(--color-text-main)]">{d.max_tokens}</strong></span>
                      <span>Temp: <strong className="text-[var(--color-text-main)]">{d.temperature}</strong></span>
                    </div>
                  </div>


                  <div>
                    <span className="text-[9px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider font-semibold">Input Fields</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {d.input_fields && d.input_fields.length > 0 ? (
                        d.input_fields.map(f => (
                          <code key={f} className="text-[9px] bg-teal-50 text-teal-700 border border-teal-100 px-1.5 py-0.5 rounded font-mono font-medium">
                            {`{{${f}}}`}
                          </code>
                        ))
                      ) : (
                        <span className="text-[var(--color-text-muted)] italic">None specified</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Delete Button */}
          {/* <button 
            onClick={() => onDelete(d.name)} 
            className="text-slate-400 hover:text-red-500 transition-colors cursor-pointer" 
            title="Delete"
          >
            <Trash2 size={15} />
          </button> */}
        </div>

      </div>


      <div className="mb-4 min-h-[36px]">
        <p className="text-[var(--color-text-muted)] text-[12px] line-clamp-2 leading-relaxed">
          {d.description}
        </p>
      </div>


      <div className="mb-2 flex-1 mt-1">
        <h4 className="text-[var(--color-text-muted)] text-[10px] font-bold mb-2 uppercase tracking-wide">Kafka Topics</h4>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="px-2 py-0.5 bg-teal-50 text-teal-700 font-mono text-[10px] font-bold tracking-tight rounded-md border border-teal-100 shadow-sm flex items-center">
            {d.input_topic || 'none'}
          </div>
          <ArrowRight className="text-teal-700/60" size={12} />
          <div className="px-2 py-0.5 bg-teal-50 text-teal-700 font-mono text-[10px] font-bold tracking-tight rounded-md border border-teal-100 shadow-sm flex items-center">
            {d.output_topic || 'none'}
          </div>
        </div>
      </div>

    </div>
  )
}


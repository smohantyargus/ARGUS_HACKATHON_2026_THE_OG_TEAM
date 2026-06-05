import { useEffect, useState } from 'react'
import { configApi } from '@/lib/api'
import PageHeader from '@/components/PageHeader'
import { Plus, Trash2, ArrowRight, GripVertical } from 'lucide-react'
import { Button } from '@/components/custom/Button'
import { CustomDialog } from '@/components/custom/CustomDialog'

interface PipelineStep { name: string; agent: string }
interface Pipeline { id: number; name: string; steps: PipelineStep[]; is_active: boolean }
interface Agent { name: string }

export default function Pipelines() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formSteps, setFormSteps] = useState<PipelineStep[]>([{ name: '', agent: '' }])
  const [deletePipelineName, setDeletePipelineName] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  async function load() {
    const [pipelinesRes, agentsRes] = await Promise.all([
      configApi.get('/pipelines/'),
      configApi.get('/internal/agents/'),
    ])
    setPipelines(pipelinesRes.data)
    setAgents(agentsRes.data)
  }

  useEffect(() => { load() }, [])

  function addStep() {
    setFormSteps([...formSteps, { name: '', agent: '' }])
  }

  function removeStep(i: number) {
    setFormSteps(formSteps.filter((_, idx) => idx !== i))
  }

  function moveStep(i: number, dir: number) {
    if (i + dir < 0 || i + dir >= formSteps.length) return
    const next = [...formSteps]
    const temp = next[i]
    next[i] = next[i + dir]
    next[i + dir] = temp
    setFormSteps(next)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    await configApi.post('/pipelines/', { name: formName, steps: formSteps })
    setShowForm(false)
    setFormName('')
    setFormSteps([{ name: '', agent: '' }])
    load()
  }

  async function confirmDelete() {
    if (!deletePipelineName) return
    setIsDeleting(true)
    try {
      await configApi.delete(`/pipelines/${deletePipelineName}`)
      await load()
      setDeletePipelineName(null)
    } catch (err) {
      console.error(err)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <PageHeader title="Pipeline Templates">
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={16} />}
          onClick={() => setShowForm(!showForm)}
        >
          New Pipeline
        </Button>
      </PageHeader>

      {showForm && (
        <form onSubmit={handleSave} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-6 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Pipeline Name</label>
            <input
              type="text"
              required
              placeholder="e.g. soap_extraction"
              className="w-full border border-[var(--color-border)] rounded-md px-3 py-1.5 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
              value={formName}
              onChange={e => setFormName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-2">Steps</label>
            <div className="space-y-3">
              {formSteps.map((s, i) => (
                <div key={i} className="flex gap-2 items-center bg-[var(--color-bg)] p-2.5 rounded-lg border border-[var(--color-border)]">
                  <button type="button" className="text-[var(--color-text-muted)] cursor-grab"><GripVertical size={16} /></button>
                  <button type="button" onClick={() => moveStep(i, -1)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-xs">↑</button>
                  <button type="button" onClick={() => moveStep(i, 1)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] text-xs">↓</button>
                  <input
                    type="text"
                    required
                    placeholder="Step name (e.g. summarize)"
                    className="flex-1 border border-[var(--color-border)] rounded-md px-2 py-1 text-xs bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                    value={s.name}
                    onChange={e => {
                      const next = [...formSteps]
                      next[i].name = e.target.value
                      setFormSteps(next)
                    }}
                  />

                  <select
                    required
                    className="flex-1 border border-[var(--color-border)] rounded-md px-2 py-1 text-xs bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                    value={s.agent}
                    onChange={e => {
                      const next = [...formSteps]
                      next[i].agent = e.target.value
                      setFormSteps(next)
                    }}
                  >
                    <option value="">Select agent</option>
                    {agents.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
                  </select>
                  {formSteps.length > 1 && (
                    <button type="button" onClick={() => removeStep(i)} className="text-[var(--color-text-muted)] hover:text-red-600">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={addStep} className="mt-2 text-sm font-medium text-teal-600 hover:text-teal-700">
              + Add step
            </button>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm">Save</Button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pipelines.map((p) => (
          <div key={p.id} className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-[var(--color-text-main)]">{p.name}</h3>
              <button onClick={() => setDeletePipelineName(p.name)} className="text-[var(--color-text-muted)] hover:text-red-600">
                <Trash2 size={16} />
              </button>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {p.steps.map((s, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="px-2.5 py-1 bg-teal-50 text-teal-700 rounded text-xs font-semibold border border-teal-100/60 shadow-xs">
                    {s.name} <span className="text-teal-500 font-mono">({s.agent})</span>
                  </span>
                  {i < p.steps.length - 1 && <ArrowRight size={14} className="text-[var(--color-text-muted)]" />}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <CustomDialog
        isOpen={deletePipelineName !== null}
        onClose={() => setDeletePipelineName(null)}
        onConfirm={confirmDelete}
        title="Delete Pipeline"
        description="Are you sure you want to permanently delete this pipeline? This action is irreversible."
        itemName={deletePipelineName || undefined}
        isDeleting={isDeleting}
        type="delete"
      />
    </>
  )
}

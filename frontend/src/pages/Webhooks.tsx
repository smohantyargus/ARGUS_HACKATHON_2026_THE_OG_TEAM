import { useEffect, useState } from 'react'
import { orchestratorApi } from '@/lib/api'
import { Plus, Trash2, X, Link as LinkIcon, Webhook } from 'lucide-react'
import { Button } from '@/components/custom/Button'
import PageHeader from '@/components/PageHeader'
import { CustomDialog } from '@/components/custom/CustomDialog'

interface WebhookEntry { id: number; url: string; events: string[]; active: boolean }

const EVENTS_LIST = [
  { key: 'job.completed', label: 'Job Completed', desc: 'Triggered when a job finishes successfully' },
  { key: 'job.failed', label: 'Job Failed', desc: 'Triggered when a job encounters an error' },

]

export default function Webhooks() {
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ url: '', secret: '', events: ['job.completed'] })
  const [deleteWebhook, setDeleteWebhook] = useState<WebhookEntry | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  async function load() {
    const res = await orchestratorApi.get('/v1/webhooks/')
    setWebhooks(res.data)
  }

  useEffect(() => { load() }, [])

  function toggleEvent(event: string) {
    setForm((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }))
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    await orchestratorApi.post('/v1/webhooks/', form)
    setShowForm(false)
    setForm({ url: '', secret: '', events: ['job.completed'] })
    load()
  }

  async function confirmDelete() {
    if (!deleteWebhook) return
    setIsDeleting(true)
    try {
      await orchestratorApi.delete(`/v1/webhooks/${deleteWebhook.id}`)
      await load()
      setDeleteWebhook(null)
    } catch (err) {
      console.error(err)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>

      <PageHeader title="Webhooks" />
      
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm p-6 mb-6">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--color-border)] mb-6">
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text-main)]">Registered Webhooks</h3>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Manage webhook endpoints and their subscribed events.</p>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => setShowForm(true)}
            className="shrink-0"
          >
            Add Webhook
          </Button>
        </div>

        
        <div className="space-y-4">
          {webhooks.length === 0 ? (
            <div className="text-center py-12 text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-xl bg-[var(--color-bg)]/50">
              No webhooks registered. Click "Add Webhook" above to create one.
            </div>
          ) : (
            webhooks.map((wh) => {
              const formattedId =  `id:${wh.id}`
              return (
                <div
                  key={wh.id}
                  className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5 shadow-sm hover:shadow-md transition-shadow relative group"
                >
                  
                  <div className="flex items-center justify-between mb-3">
                    <span className="bg-teal-50/80 text-teal-800 border border-teal-100 font-mono text-[10px] font-bold px-2 py-0.5 rounded-lg">
                      {formattedId}
                    </span>

                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 active-status-pill border rounded-full text-[10px] font-bold tracking-wide uppercase select-none">
                        <span className="w-1.5 h-1.5 active-status-dot rounded-full" />
                        Active
                      </span>
                      <button
                        onClick={() => setDeleteWebhook(wh)}
                        className="text-red-500 hover:text-red-700 transition-colors p-1.5 hover:bg-red-50 rounded-lg cursor-pointer"
                        title="Delete Webhook"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  
                  <div className="flex items-center gap-2 text-[var(--color-text-muted)] text-xs font-medium mb-4 pr-10 overflow-hidden text-ellipsis whitespace-nowrap">
                    <LinkIcon size={14} className="text-[var(--color-text-muted)] shrink-0" />
                    <span className="font-sans text-[var(--color-text-main)]">{wh.url}</span>
                  </div>

                  
                  <div className="flex flex-wrap gap-2">
                    {wh.events?.map((ev) => (
                      <span
                        key={ev}
                        className="px-2.5 py-0.5 bg-emerald-50/70 text-emerald-800 border border-emerald-100/50 rounded-lg text-[10px] font-bold tracking-wide"
                      >
                        {ev}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in">
            
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
               <div className="flex items-center gap-2">
                  <Webhook size={18} className="text-teal-600" />
                  <h3 className="text-base font-bold text-[var(--color-text-main)]">
                    Add Webhook
                  </h3>
                </div>
              <button
                onClick={() => setShowForm(false)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] transition-colors p-1.5 hover:bg-[var(--color-bg)] rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            
            <form onSubmit={handleAdd}>
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                
                <div>
                  <label className="block text-xs font-bold text-[var(--color-text-main)] mb-1.5">Webhook URL</label>
                  <input
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="https://your-server.com/webhook"
                    required
                    className="w-full border border-[var(--color-border)] rounded-xl px-4 py-2.5 text-xs text-[var(--color-text-muted)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 shadow-xs"
                  />
                </div>

                
                <div>
                  <label className="block text-xs font-bold text-[var(--color-text-main)] mb-1.5">Secret (for HMAC signing)</label>
                  <input
                    type="text"
                    value={form.secret}
                    onChange={(e) => setForm({ ...form, secret: e.target.value })}
                    placeholder="Enter secret (optional)"
                    className="w-full border border-[var(--color-border)] rounded-xl px-4 py-2.5 text-xs text-[var(--color-text-muted)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 shadow-xs"
                  />
                </div>

                
                <div>
                  <label className="block text-xs font-bold text-[var(--color-text-main)] mb-3">Subscribe to Events</label>
                  <div className="space-y-4 border border-[var(--color-border)] rounded-xl p-4 bg-[var(--color-bg)]/30">
                    {EVENTS_LIST.map((opt) => (
                      <div key={opt.key} className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          id={opt.key}
                          checked={form.events.includes(opt.key)}
                          onChange={() => toggleEvent(opt.key)}
                          className="rounded border-[var(--color-border)] text-teal-600 focus:ring-teal-500/30 accent-teal-600 cursor-pointer h-4 w-4 mt-0.5"
                        />
                        <div className="flex flex-col select-none">
                          <label htmlFor={opt.key} className="text-xs font-bold text-[var(--color-text-main)] cursor-pointer">{opt.label}</label>
                          <span className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{opt.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              
              <div className="px-6 py-4 bg-[var(--color-bg)]/50 border-t border-[var(--color-border)] flex items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                >
                  Save
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CustomDialog
        isOpen={deleteWebhook !== null}
        onClose={() => setDeleteWebhook(null)}
        onConfirm={confirmDelete}
        title="Delete Webhook"
        description="Are you sure you want to permanently delete this webhook? This action is irreversible."
        itemName={deleteWebhook ? `Webhook URL: ${deleteWebhook.url}` : undefined}
        isDeleting={isDeleting}
        type="delete"
      />
    </>
  )
}

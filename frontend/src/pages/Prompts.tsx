import { useEffect, useState, useRef } from 'react'
import { Save, Eye } from 'lucide-react'
import { configApi } from '@/lib/api'
import { CustomSelect } from '@/components/custom/CustomSelect'
import { Button } from '@/components/custom/Button'
import PageHeader from '@/components/PageHeader'
interface Prompt {
  id: number; action: string; system_prompt: string; user_prompt: string
  version: number; is_active: boolean
}

export default function Prompts() {
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [selected, setSelected] = useState<Prompt | null>(null)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [userPrompt, setUserPrompt] = useState('')
  const [versions, setVersions] = useState<Prompt[]>([])
  const [previewText, setPreviewText] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)

  const previewRef = useRef<HTMLDivElement>(null)

  async function loadPrompts() {
    const res = await configApi.get('/prompts/')
    setPrompts(res.data)
    if (res.data.length > 0 && !selected) {
      const first = res.data[0]
      setSelected(first)
      setSystemPrompt(first.system_prompt)
      setUserPrompt(first.user_prompt)
    }
  }

  useEffect(() => { loadPrompts() }, [])

  
  useEffect(() => {
    if (selected) {
      configApi.get(`/prompts/${selected.action}/versions`)
        .then(res => setVersions(res.data))
        .catch(() => {})
    }
  }, [selected])

 
  useEffect(() => {
    if (showPreview) {
      setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }, [showPreview])

  function selectPrompt(p: Prompt) {
    setSelected(p)
    setSystemPrompt(p.system_prompt)
    setUserPrompt(p.user_prompt)
    setShowPreview(false)
  }

  async function activateVersion(version: number) {
    if (!selected) return
    await configApi.post(`/prompts/${selected.action}/activate/${version}`)
    loadPrompts()
    const res = await configApi.get(`/prompts/${selected.action}`)
    selectPrompt(res.data)
    const vRes = await configApi.get(`/prompts/${selected.action}/versions`)
    setVersions(vRes.data)
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    try {
      await configApi.put(`/prompts/${selected.action}`, {
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
      })
      loadPrompts()
      const res = await configApi.get(`/prompts/${selected.action}`)
      selectPrompt(res.data)
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = selected && (systemPrompt !== selected.system_prompt || userPrompt !== selected.user_prompt)

  function renderPreview() {
    return userPrompt.replace('{{transcript}}', previewText || '[your transcript here]')
  }

  const versionOptions = versions.map(v => ({
    value: String(v.version),
    label: `v${v.version}`,
    subLabel: v.is_active ? 'Activated' : undefined
  }))

  if (!selected) return null

  return (
    <>
    <PageHeader title="Prompts" />
      <div className="flex gap-6 items-start">
        
        <div className="w-64 flex-shrink-0 space-y-3">
          {prompts.map((p) => {
            const isSelected = selected.action === p.action
            return (
              <button
                key={p.id}
                onClick={() => selectPrompt(p)}
                className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--color-selected-bg)] border-[var(--color-selected-border)] text-[var(--color-selected-text)] shadow-sm animate-fade-in'
                    : 'bg-[var(--color-surface)] border-[var(--color-border)] hover:bg-[var(--color-bg)] text-[var(--color-text-muted)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`font-bold text-sm ${isSelected ? 'text-[var(--color-selected-text)]' : 'text-[var(--color-text-main)]'}`}>
                    {p.action}
                  </span>
                  <span className="text-[10px] font-mono text-[var(--color-text-muted)]">v{p.version}</span>
                </div>
              </button>
            )
          })}
        </div>

        
        <div className="flex-1 space-y-6">
          <div className="space-y-6">
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="text-2xl font-bold text-[var(--color-text-main)]">{selected.action}</h3>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">System + User prompt configuration</p>
              </div>

              <div className="grid grid-cols-3 gap-2.5 w-full sm:w-[320px] md:w-[360px]">
                <CustomSelect
                  value={String(selected.version)}
                  onChange={(val) => activateVersion(Number(val))}
                  options={versionOptions}
                  placeholder="Select version"
                  className="w-full"
                />

                
                <Button
                  variant={showPreview ? 'primary' : 'outline'}
                  size="sm"
                  icon={<Eye size={14} />}
                  onClick={() => setShowPreview(!showPreview)}
                  className="w-full"
                >
                  Preview
                </Button>

                
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Save size={14} />}
                  disabled={!hasChanges || saving}
                  onClick={handleSave}
                  className="w-full"
                >
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>

            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm flex flex-col">
                <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/50">
                  <span className="text-xs font-bold text-[var(--color-text-main)]">System Prompt</span>
                </div>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={18}
                  className="w-full border-0 focus:ring-0 p-4 text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-surface)] leading-relaxed resize-none focus:outline-none flex-1 min-h-[360px]"
                />
                <div className="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg)]/30 text-[10px] text-[var(--color-text-muted)]">
                  {systemPrompt.length} characters
                </div>
              </div>

              
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden shadow-sm flex flex-col">
                <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/50">
                  <span className="text-xs font-bold text-[var(--color-text-main)]">User Prompt</span>
                </div>
                <textarea
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  rows={18}
                  className="w-full border-0 focus:ring-0 p-4 text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-surface)] leading-relaxed resize-none focus:outline-none flex-1 min-h-[360px]"
                />
                <div className="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg)]/30 text-[10px] text-[var(--color-text-muted)]">
                  {userPrompt.length} characters
                </div>
              </div>
            </div>

            
            {showPreview && (
              <div
                ref={previewRef}
                className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 shadow-sm flex flex-col space-y-4 w-full scroll-mt-6"
              >
                <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-3">
                  <Eye size={16} className="text-[var(--color-text-muted)]" />
                  <h4 className="text-sm font-bold text-[var(--color-text-main)]">Preview</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[11px] font-bold text-[var(--color-text-muted)] mb-1.5">Sample Transcript</label>
                    <textarea
                      value={previewText}
                      onChange={(e) => setPreviewText(e.target.value)}
                      rows={12}
                      placeholder="Paste a sample transcript to preview..."
                      className="w-full border border-[var(--color-border)] rounded-xl px-4 py-3 text-xs text-[var(--color-text-muted)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 resize-none font-sans min-h-[300px]"
                    />
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-1 text-right">
                      {previewText.length} / 20,000
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-[var(--color-text-muted)] mb-1.5">Rendered Output</label>
                    <pre className="w-full bg-slate-950 text-emerald-400 text-[10px] font-mono p-4 rounded-xl overflow-auto min-h-[300px] whitespace-pre-wrap leading-relaxed border border-slate-900">
                      {renderPreview()}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

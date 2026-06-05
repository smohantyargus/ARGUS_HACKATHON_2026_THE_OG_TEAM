import { useRef, useState } from 'react'
import { Play, CheckCircle, ExternalLink, X, FileAudio } from 'lucide-react'
import { orchestratorApi } from '@/lib/api'
import { cn } from '@/lib/cn'

interface Props {
  pipelineName: string
  pipelineId: string        // UUID — targets this specific pipeline
  inputType: string         // 'text' | 'audio'
  onClose: () => void
}

export function PipelineTestRunModal({ pipelineName, pipelineId, inputType, onClose }: Props) {
  const [text, setText] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isAudio = inputType === 'audio'

  const canSubmit = isAudio ? !!audioFile : !!text.trim()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setJobId(null)
    setResult(null)
    setError('')
    try {
      let res
      if (isAudio) {
        const fd = new FormData()
        fd.append('file', audioFile!)
        fd.append('pipeline_id', pipelineId)
        res = await orchestratorApi.post('/v1/process/audio', fd, { timeout: 360_000 })
      } else {
        res = await orchestratorApi.post('/v1/process/text', {
          text,
          pipeline_id: pipelineId,
        }, { timeout: 360_000 })
      }
      setJobId(res.data.job_id)
      setResult(res.data.result)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setError(detail ?? 'Processing failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
      <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl w-full max-w-lg mx-4">
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-[var(--color-text-main)] flex items-center gap-2">
              <Play size={16} className="text-emerald-600" /> Test Run
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Pipeline: <span className="font-semibold text-[var(--color-text-muted)]">{pipelineName}</span>
              <span className="ml-2 font-mono bg-[var(--color-bg)] text-[var(--color-text-muted)] px-1.5 py-0.5 rounded text-xs">{inputType}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">
            <X size={18} />
          </button>
        </div>

        {jobId ? (
          <div className="px-6 py-6">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle size={20} className="text-emerald-500 shrink-0" />
              <p className="text-sm font-bold text-[var(--color-text-main)]">Completed</p>
              <span className="ml-auto font-mono text-xs text-[var(--color-text-muted)]">{jobId}</span>
              <a
                href={`/jobs/${jobId}`}
                className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 font-semibold"
              >
                <ExternalLink size={12} /> View Job
              </a>
            </div>
            {result != null && (
              <pre className="bg-slate-900 text-slate-100 text-xs font-mono rounded-lg p-4 overflow-auto max-h-80 whitespace-pre-wrap leading-relaxed">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <p className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2">
              Pipeline behavior is defined by node config in the builder. Just provide the input.
            </p>

            {/* Input area */}
            {isAudio ? (
              <div>
                <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">Audio File</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={e => setAudioFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'w-full border-2 border-dashed rounded-lg px-4 py-8 text-center transition-colors',
                    audioFile
                       ? 'border-emerald-300 bg-emerald-50'
                       : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]',
                  )}
                >
                  <FileAudio size={24} className={cn('mx-auto mb-2', audioFile ? 'text-emerald-500' : 'text-[var(--color-text-muted)]')} />
                  {audioFile ? (
                    <div>
                      <p className="text-sm font-semibold text-emerald-700">{audioFile.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{ (audioFile.size / 1024 / 1024).toFixed(2) } MB</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-[var(--color-text-muted)] font-medium">Click to select audio file</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">WAV, MP3, FLAC, AAC, M4A, OGG</p>
                    </div>
                  )}
                </button>
                {audioFile && (
                  <button
                    type="button"
                    onClick={() => { setAudioFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                    className="mt-1.5 text-xs text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
                  >
                    Remove file
                  </button>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">Scenario Description</label>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Describe the epidemic scenario to analyse (e.g. R0, population size, affected hubs)…"
                  rows={8}
                  className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 resize-none"
                />
              </div>
            )}

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !canSubmit}
                className="flex items-center gap-2 px-5 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 shadow-sm transition-colors disabled:opacity-50"
              >
                <Play size={14} /> {submitting ? (isAudio ? 'Processing audio…' : 'Processing…') : 'Run'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

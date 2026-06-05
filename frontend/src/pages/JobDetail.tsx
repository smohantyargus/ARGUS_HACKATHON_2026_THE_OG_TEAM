import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { orchestratorApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import StatusBadge from '@/components/StatusBadge'
import { cn } from '@/lib/cn'
import {
  ArrowLeft, Wifi, WifiOff, FileText,
  Copy, Check, CheckCircle2, Activity,
  Clock, AlertCircle, Loader2, ChevronDown, ChevronRight
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Job {
  job_id: string; status: string; pipeline: string[]; current_step: string | null
  result?: unknown; error?: string; created_at: string; updated_at: string
  pipeline_definition_id?: string; pipeline_id?: string; pipeline_name?: string
  input_meta?: Record<string, any>
}
interface Step {
  step_name: string; agent_name: string; status: string
  output?: unknown; error?: string; started_at?: string; completed_at?: string
}
interface FeedbackEntry { rating: number; correction: string; submitted: boolean; submitting: boolean }

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-teal-600 transition-all px-3 py-1.5 rounded-lg hover:bg-teal-50"
    >
      {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function ResultSection({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(true)
  const isText = typeof value === 'string'
  const displayText = isText ? value : JSON.stringify(value, null, 2)

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-6 py-4 flex items-center justify-between bg-slate-50/50 hover:bg-slate-50 transition-colors border-b border-slate-100"
      >
        <span className="text-xs font-black text-slate-600 uppercase tracking-widest">{label}</span>
        <div className="flex items-center gap-2">
          <CopyButton text={displayText} />
          {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
        </div>
      </button>
      {open && (
        <div className="p-6">
          {isText ? (
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-medium">{value}</p>
          ) : (
            <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap overflow-x-auto leading-relaxed">{displayText}</pre>
          )}
        </div>
      )}
    </div>
  )
}

function FeedbackWidget({
  jobCompleted,
  entry,
  onChange,
  onSubmit,
}: {
  jobCompleted: boolean
  entry: FeedbackEntry
  onChange: (update: Partial<FeedbackEntry>) => void
  onSubmit: () => void
}) {
  if (!jobCompleted) return null
  if (entry.submitted) {
    return <p className="text-xs text-green-600 mt-2 font-bold">Feedback submitted — thank you.</p>
  }
  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-900 font-bold uppercase tracking-tight">Rate this section:</span>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange({ rating: n })}
            className={cn(
              'text-xl leading-none transition-colors',
              n <= entry.rating ? 'text-amber-400' : 'text-gray-200 hover:text-amber-300',
            )}
            title={`${n} star${n > 1 ? 's' : ''}`}
          >★</button>
        ))}
      </div>
      {entry.rating > 0 && (
        <>
          <input
            type="text"
            placeholder="Optional correction..."
            value={entry.correction}
            onChange={(e) => onChange({ correction: e.target.value })}
            className="flex-1 min-w-[160px] text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-300"
          />
          <button
            disabled={entry.submitting}
            onClick={onSubmit}
            className="text-xs px-3 py-1 bg-teal-600 text-white rounded font-bold hover:bg-teal-700 disabled:opacity-50 transition-colors uppercase tracking-widest"
          >
            {entry.submitting ? 'Sending...' : 'Submit'}
          </button>
        </>
      )}
    </div>
  )
}

function RichResult({
  result,
  jobCompleted,
  feedback,
  onFeedbackChange,
  onFeedbackSubmit,
}: {
  result: unknown
  jobCompleted: boolean
  feedback: Record<string, FeedbackEntry>
  onFeedbackChange: (key: string, update: Partial<FeedbackEntry>) => void
  onFeedbackSubmit: (key: string) => void
}) {
  const emptyEntry: FeedbackEntry = { rating: 0, correction: '', submitted: false, submitting: false }

  if (!result) {
    return (
      <div className="py-24 text-center bg-slate-50/30 rounded-3xl border-2 border-dashed border-slate-200">
        <FileText size={48} className="mx-auto text-slate-200 mb-4" />
        <p className="text-slate-400 font-black uppercase tracking-[0.2em] text-xs">Waiting for pipeline results...</p>
      </div>
    )
  }

  // Build sections from result object keys, or treat plain string as single "output" section
  const sections: Array<{ key: string; value: unknown }> =
    typeof result === 'object' && result !== null
      ? Object.entries(result as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => ({ key: k, value: v }))
      : [{ key: 'output', value: result }]

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {sections.map(({ key, value }) => (
        <ResultSection key={key} label={key.replace(/_/g, ' ')} value={value} />
      ))}

      <div className="bg-teal-50/30 border border-teal-100 rounded-2xl p-5 mt-2">
        <FeedbackWidget
          jobCompleted={jobCompleted}
          entry={feedback['result'] ?? emptyEntry}
          onChange={(u) => onFeedbackChange('result', u)}
          onSubmit={() => onFeedbackSubmit('result')}
        />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

const TOKEN_KEY = 'haidoc_token'

export default function JobDetail() {
  const { jobId } = useParams()
  const { isAdmin } = useAuth()

  const [job, setJob] = useState<Job | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [isLive, setIsLive] = useState(false)
  const [reasoningTokens, setReasoningTokens] = useState('')
  const [reasoningActive, setReasoningActive] = useState(false)
  const [feedback, setFeedback] = useState<Record<string, FeedbackEntry>>({})

  const tokenRef = useRef<HTMLPreElement>(null)

  // Auto-scroll token panel as new tokens arrive
  useEffect(() => {
    if (tokenRef.current) {
      tokenRef.current.scrollTop = tokenRef.current.scrollHeight
    }
  }, [reasoningTokens])

  const loadRest = useCallback(() => {
    if (!jobId) return
    Promise.all([
      orchestratorApi.get(`/v1/jobs/${jobId}`).then((r) => setJob(r.data)),
      orchestratorApi.get(`/v1/jobs/${jobId}/steps`).then((r) => setSteps(r.data)),
    ]).catch(() => { })
  }, [jobId])

  useEffect(() => {
    if (!jobId) return

    // Initial REST load so the page isn't blank while SSE connects
    loadRest()

    const rawToken = sessionStorage.getItem(TOKEN_KEY)
    if (!rawToken) return

    let fallbackIv: ReturnType<typeof setInterval> | null = null

    const es = new EventSource(
      `/api/v1/jobs/${jobId}/stream?token=${encodeURIComponent(rawToken)}`,
    )

    function startFallback() {
      if (fallbackIv) return
      setIsLive(false)
      fallbackIv = setInterval(loadRest, 3000)
    }

    es.addEventListener('job.started', ((e: MessageEvent) => {
      setIsLive(true)
      const d = JSON.parse(e.data)
      if (d.steps) {
        setSteps(d.steps)
      }
    }) as EventListener)

    es.addEventListener('step.started', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setSteps((prev) => prev.map((s) =>
        s.step_name === d.step ? { ...s, status: 'in_progress' } : s,
      ))
      if (d.step === 'reason') setReasoningActive(true)
    }) as EventListener)

    es.addEventListener('step.completed', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setSteps((prev) => prev.map((s) =>
        s.step_name === d.step ? { ...s, status: 'completed' } : s,
      ))
      if (d.step === 'reason') setReasoningActive(false)
    }) as EventListener)

    es.addEventListener('step.failed', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setSteps((prev) => prev.map((s) =>
        s.step_name === d.step ? { ...s, status: 'failed', error: d.error } : s,
      ))
      if (d.step === 'reason') setReasoningActive(false)
    }) as EventListener)

    es.addEventListener('token.stream', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      if (d.token) setReasoningTokens((prev) => prev + d.token)
    }) as EventListener)

    es.addEventListener('job.completed', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setJob((prev) => prev ? { ...prev, status: 'completed', result: d.result } : prev)
      setReasoningActive(false)
      es.close()
      setIsLive(false)
    }) as EventListener)

    es.addEventListener('job.failed', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setJob((prev) => prev ? { ...prev, status: 'failed', error: d.error } : prev)
      setReasoningActive(false)
      es.close()
      setIsLive(false)
    }) as EventListener)

    es.onerror = () => {
      es.close()
      startFallback()
    }

    return () => {
      es.close()
      if (fallbackIv) clearInterval(fallbackIv)
    }
  }, [jobId, loadRest])

  const handleFeedbackChange = useCallback((key: string, update: Partial<FeedbackEntry>) => {
    setFeedback((prev) => ({
      ...prev,
      [key]: { ...{ rating: 0, correction: '', submitted: false, submitting: false }, ...prev[key], ...update },
    }))
  }, [])

  const handleFeedbackSubmit = useCallback(async (key: string) => {
    const entry = feedback[key]
    if (!entry || entry.rating === 0) return
    setFeedback((prev) => ({ ...prev, [key]: { ...entry, submitting: true } }))
    try {
      await orchestratorApi.post(`/v1/jobs/${jobId}/feedback`, {
        output_type: key,
        rating: entry.rating,
        correction: entry.correction || null,
      })
      setFeedback((prev) => ({ ...prev, [key]: { ...entry, submitted: true, submitting: false } }))
    } catch {
      setFeedback((prev) => ({ ...prev, [key]: { ...entry, submitting: false } }))
    }
  }, [feedback, jobId])

  if (!job) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="animate-spin text-teal-600" size={32} />
    </div>
  )

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header  */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-5">
          <Link
            to="/jobs"
            className="w-12 h-12 rounded-2xl border border-slate-200 flex items-center justify-center text-slate-400 hover:text-teal-600 hover:bg-teal-50 hover:border-teal-400 transition-all shadow-sm bg-white group"
          >
            <ArrowLeft size={22} className="group-hover:-translate-x-0.5 transition-transform" />
          </Link>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">Consultation Results</h1>
              <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200 uppercase tracking-widest">
                #{job.job_id.slice(0, 12)}...
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* SSE indicator */}
          <div className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-all bg-white shadow-sm',
            isLive
              ? 'text-teal-600 border-teal-200 ring-4 ring-teal-50'
              : 'text-slate-400 border-slate-200'
          )}>
            {isLive ? <Wifi size={14} className="animate-pulse" /> : <WifiOff size={14} />}
            {isLive ? 'Live' : 'Pooling'}
          </div>

          <Link
            to="/jobs/new"
            className="flex items-center gap-2 bg-teal-600 text-white px-6 py-3 rounded-xl font-black text-sm hover:bg-teal-700 transition-all shadow-xl shadow-teal-600/20 active:scale-95 group"
          >
            <Activity size={18} className="group-hover:rotate-12 transition-transform" /> New Analysis
          </Link>
        </div>
      </div>


      <div className="bg-slate-50/50 px-6 py-4 rounded-2xl border border-slate-200 shadow-sm mb-10 flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Analysis Type:</span>
          <span className="text-sm font-bold text-slate-800 capitalize">
            {job.pipeline_name || (Array.isArray(job.pipeline) ? job.pipeline.join(' → ') : 'Clinical Analysis')}
          </span>
        </div>
        <div className="w-px h-4 bg-slate-300 hidden md:block" />
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Input:</span>
          <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
            {job.pipeline && job.pipeline.includes('transcribe') ? 'Audio' : 'Text'}

          </span>
        </div>
        <div className="w-px h-4 bg-slate-300 hidden md:block" />
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Status:</span>
          <StatusBadge status={job.status} />
        </div>
        <div className="w-px h-4 bg-slate-300 hidden md:block" />
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Duration:</span>
          <span className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Clock size={14} className="text-slate-400" />
            {job.created_at && job.updated_at ? (
              (() => {
                const s = Math.floor((new Date(job.updated_at).getTime() - new Date(job.created_at).getTime()) / 1000)
                return s > 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
              })()
            ) : '--'}
          </span>
        </div>
        <div className="w-px h-4 bg-slate-300 hidden md:block" />
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Timestamp:</span>
          <span className="text-sm font-bold text-slate-800">
            {new Date(job.created_at).toLocaleDateString()} <span className="text-slate-400 mx-1">•</span> {new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Main Content (Left) */}
        <div className="lg:col-span-8 space-y-6">

          {/* Error Message UI */}
          {job.error && (
            <div className="bg-red-50/50 border border-red-100 rounded-2xl p-6 flex items-start gap-4 animate-in slide-in-from-top-4 duration-300">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 shrink-0">
                <AlertCircle size={24} />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-red-900">Process Failure Detected</h4>
                <p className="text-sm text-red-700 leading-relaxed font-medium">{job.error}</p>
              </div>
            </div>
          )}

          {/* Reasoning Stream Container (Live only) */}
          {(reasoningActive || (reasoningTokens && job.status !== 'completed')) && (
            <div className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-ping absolute" />
                    <div className="w-2.5 h-2.5 bg-blue-500 rounded-full relative" />
                  </div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Reasoning in progress...</h3>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-800 rounded text-[10px] text-slate-500 font-mono">
                  LIVE STREAM
                </div>
              </div>
              <pre
                ref={tokenRef}
                className="p-8 text-sm text-slate-300 font-mono whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto scrollbar-hide"
              >
                {reasoningTokens || ''}
              </pre>
            </div>
          )}

          {/* Results Section */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <RichResult
              result={job.result || null}
              jobCompleted={job.status === 'completed'}
              feedback={feedback}
              onFeedbackChange={handleFeedbackChange}
              onFeedbackSubmit={handleFeedbackSubmit}
            />
          </div>
        </div>

        {/* Sidebar (Right) - Job Tracking */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
            <div className="px-6 py-5 border-b border-slate-50 flex items-center justify-between bg-slate-50/20">
              <h3 className="text-lg font-black text-slate-800 tracking-tight">Job Tracking</h3>
              <div className={cn(
                "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                job.status === 'completed' ? 'bg-teal-50 text-teal-600' :
                  job.status === 'failed' ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-400'
              )}>
                {job.status}
              </div>
            </div>

            <div className="p-6 relative">
              {/* Timeline Connector Line */}
              <div className="absolute left-[38px] top-10 bottom-10 w-0.5 bg-slate-100" />

              <div className="space-y-6 relative">
                {steps.map((s, idx) => (
                  <div key={s.step_name} className="flex gap-4 group">
                    {/* Status Icon */}
                    <div className="relative z-10 flex flex-col items-center">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center border-4 border-white shadow-sm transition-all duration-500",
                        s.status === 'completed' ? 'bg-teal-500 text-white' :
                          s.status === 'in_progress' ? 'bg-amber-400 text-white animate-pulse' :
                            s.status === 'failed' ? 'bg-rose-500 text-white' :
                              'bg-white border-slate-100 text-slate-300'
                      )}>
                        {s.status === 'completed' && <CheckCircle2 size={18} />}
                        {s.status === 'in_progress' && <Loader2 size={18} className="animate-spin" />}
                        {s.status === 'failed' && <AlertCircle size={18} />}
                        {s.status === 'pending' && <span className="text-xs font-black">{idx + 1}</span>}
                      </div>
                    </div>

                    {/* Step Card */}
                    <div className="flex-1">
                      <button
                        onClick={() => isAdmin ? setExpandedStep(expandedStep === s.step_name ? null : s.step_name) : undefined}
                        className={cn(
                          "w-full text-left rounded-2xl p-4 shadow-sm transition-all border",
                          s.status === 'in_progress' ? "bg-amber-50 border-amber-100 ring-1 ring-amber-200" : "bg-white border-slate-100",
                          isAdmin ? "hover:border-teal-200 hover:shadow-md cursor-pointer" : "cursor-default"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={cn(
                            "text-xs font-black uppercase tracking-widest",
                            s.status === 'failed' ? 'text-rose-600' : 'text-slate-800'
                          )}>
                            {s.step_name}
                          </span>
                          <span className={cn(
                            "text-[10px] font-black uppercase tracking-tighter opacity-40",
                            s.status === 'completed' ? 'text-teal-600' : s.status === 'in_progress' ? 'text-amber-600' : 'text-slate-400'
                          )}>
                            {s.status}
                          </span>
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight mb-2">
                          Agent: {s.agent_name || 'System'}
                        </div>

                        {s.error && (
                          <div className="mt-2 text-[11px] text-rose-600 bg-rose-50/50 p-3 rounded-xl border border-rose-100/50 font-bold leading-relaxed">
                            {String(s.error)}
                          </div>
                        )}


                        {isAdmin && !!s.output && (
                          <div className="mt-2 flex items-center justify-end">
                            <div className="text-[9px] font-black text-teal-600 uppercase tracking-widest bg-teal-50 px-2 py-0.5 rounded">
                              {expandedStep === s.step_name ? 'Close Trace' : 'View Trace'}
                            </div>
                          </div>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

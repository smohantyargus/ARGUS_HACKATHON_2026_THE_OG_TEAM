import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { orchestratorApi, configApi } from '@/lib/api'
import StatusBadge from '@/components/StatusBadge'
import PageHeader from '@/components/PageHeader'
import {
  Activity,
  ExternalLink,
  ClipboardList,
  Search,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  FileText,
  Copy,
  Check,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  Wifi,
  WifiOff,
  X,
  Network
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { CustomSelect } from '@/components/custom/CustomSelect'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Job {
  job_id: string
  status: string
  pipeline: string[] | string
  current_step: string | null
  created_at: string
  updated_at: string
  error?: string
  pipeline_id?: string
  pipeline_name?: string
  result?: unknown
  input_meta?: Record<string, any>
}

interface Step {
  step_name: string
  agent_name: string
  status: string
  output?: unknown
  error?: string
  started_at?: string
  completed_at?: string
}

const TOKEN_KEY = 'civis_token'

// ─── Detail Panel helpers ─────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-teal-600 transition-all px-2 py-1 rounded-lg hover:bg-teal-50"
    >
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function ResultSection({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(true)
  const isText = typeof value === 'string'
  const displayText = isText ? value : JSON.stringify(value, null, 2)
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center justify-between bg-slate-50/50 hover:bg-slate-50 transition-colors border-b border-slate-100"
      >
        <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{label}</span>
        <div className="flex items-center gap-2">
          <CopyButton text={displayText} />
          {open ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronRightIcon size={13} className="text-slate-400" />}
        </div>
      </button>
      {open && (
        <div className="p-4">
          {isText ? (
            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-medium">{value}</p>
          ) : (
            <pre className="text-[11px] font-mono text-slate-700 whitespace-pre-wrap overflow-x-auto leading-relaxed">{displayText}</pre>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Inline Job Detail Panel ──────────────────────────────────────────────────

function JobDetailPanel({ jobId, pipelineName, onClose }: {
  jobId: string
  pipelineName: string
  onClose: () => void
}) {
  const { isAdmin } = useAuth()
  const [job, setJob] = useState<Job | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [isLive, setIsLive] = useState(false)
  const [reasoningTokens, setReasoningTokens] = useState('')
  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const tokenRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (tokenRef.current) tokenRef.current.scrollTop = tokenRef.current.scrollHeight
  }, [reasoningTokens])

  const loadRest = useCallback(() => {
    Promise.all([
      orchestratorApi.get(`/v1/jobs/${jobId}`).then(r => setJob(r.data)),
      orchestratorApi.get(`/v1/jobs/${jobId}/steps`).then(r => setSteps(r.data)),
    ]).catch(() => {})
  }, [jobId])

  useEffect(() => {
    setJob(null)
    setSteps([])
    setIsLive(false)
    setReasoningTokens('')
    setExpandedStep(null)

    loadRest()

    const rawToken = sessionStorage.getItem(TOKEN_KEY)
    if (!rawToken) return

    let fallbackIv: ReturnType<typeof setInterval> | null = null

    const es = new EventSource(
      `/api/v1/jobs/${jobId}/stream?token=${encodeURIComponent(rawToken)}`
    )

    function startFallback() {
      if (fallbackIv) return
      setIsLive(false)
      fallbackIv = setInterval(loadRest, 3000)
    }

    es.addEventListener('job.started', ((e: MessageEvent) => {
      setIsLive(true)
      const d = JSON.parse(e.data)
      if (d.steps) setSteps(d.steps)
    }) as EventListener)

    es.addEventListener('step.started', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setSteps(prev => prev.map(s => s.step_name === d.step ? { ...s, status: 'in_progress' } : s))
    }) as EventListener)

    es.addEventListener('step.completed', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setSteps(prev => prev.map(s => s.step_name === d.step ? { ...s, status: 'completed' } : s))
    }) as EventListener)

    es.addEventListener('step.failed', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setSteps(prev => prev.map(s => s.step_name === d.step ? { ...s, status: 'failed', error: d.error } : s))
    }) as EventListener)

    es.addEventListener('token.stream', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      if (d.token) setReasoningTokens(prev => prev + d.token)
    }) as EventListener)

    es.addEventListener('job.completed', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setJob(prev => prev ? { ...prev, status: 'completed', result: d.result } : prev)
      es.close()
      setIsLive(false)
      loadRest()
    }) as EventListener)

    es.addEventListener('job.failed', ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setJob(prev => prev ? { ...prev, status: 'failed', error: d.error } : prev)
      es.close()
      setIsLive(false)
    }) as EventListener)

    es.onerror = () => { es.close(); startFallback() }

    return () => {
      es.close()
      if (fallbackIv) clearInterval(fallbackIv)
    }
  }, [jobId, loadRest])

  const formatDuration = () => {
    if (!job?.created_at || !job?.updated_at) return '--'
    const s = Math.floor((new Date(job.updated_at).getTime() - new Date(job.created_at).getTime()) / 1000)
    return s > 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
  }

  const resultSections = useMemo(() => {
    if (!job?.result) return []
    if (typeof job.result === 'object' && job.result !== null) {
      return Object.entries(job.result as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => ({ key: k, value: v }))
    }
    return [{ key: 'output', value: job.result }]
  }, [job?.result])

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] border-l border-[var(--color-border)]">
      {/* Panel header */}
      <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--color-text-muted)] bg-[var(--color-surface)] border border-[var(--color-border)] px-2 py-0.5 rounded-lg">
              #{jobId.slice(0, 12)}
            </span>
            {job && <StatusBadge status={job.status} />}
          </div>
          <div className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-all',
            isLive
              ? 'text-teal-600 border-teal-200 bg-teal-50'
              : 'text-slate-400 border-slate-200 bg-white'
          )}>
            {isLive ? <Wifi size={11} className="animate-pulse" /> : <WifiOff size={11} />}
            {isLive ? 'Live' : 'Polling'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/jobs/${jobId}`}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-teal-600 hover:text-teal-700 px-3 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 transition-all border border-teal-100"
          >
            <ExternalLink size={11} /> Full Page
          </Link>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Meta bar */}
      {job && (
        <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center gap-x-5 gap-y-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Pipeline</span>
            <span className="text-xs font-bold text-slate-700">{pipelineName}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock size={11} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-600">{formatDuration()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Started</span>
            <span className="text-xs font-bold text-slate-600">
              {new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      )}

      {!job && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="animate-spin text-teal-500" size={28} />
        </div>
      )}

      {job && (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-0 h-full">
            {/* Job Tracking Timeline — left column of the panel */}
            <div className="xl:col-span-2 border-r border-[var(--color-border)] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">Job Tracking</h3>
                <div className={cn(
                  "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest",
                  job.status === 'completed' ? 'bg-teal-50 text-teal-600' :
                    job.status === 'failed' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'
                )}>
                  {job.status}
                </div>
              </div>

              <div className="relative">
                <div className="absolute left-[19px] top-5 bottom-5 w-0.5 bg-slate-100" />
                <div className="space-y-4 relative">
                  {/* MCP routing pseudo-step */}
                  {job.status === 'in_progress' && steps.length === 0 && (
                    <div className="flex gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center border-4 border-white shadow-sm bg-violet-400 text-white animate-pulse z-10 shrink-0">
                        <Network size={14} />
                      </div>
                      <div className="flex-1 bg-violet-50 border border-violet-100 ring-1 ring-violet-200 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] font-black uppercase tracking-widest text-violet-800">Routing</span>
                          <span className="text-[9px] font-black uppercase text-violet-400">in_progress</span>
                        </div>
                        <div className="text-[9px] font-bold text-violet-400 uppercase tracking-tight">
                          MCP evaluating agent selection...
                        </div>
                      </div>
                    </div>
                  )}

                  {steps.map((s, idx) => (
                    <div key={s.step_name} className="flex gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center border-4 border-white shadow-sm z-10 shrink-0 transition-all duration-500",
                        s.status === 'completed' ? 'bg-teal-500 text-white' :
                          s.status === 'in_progress' ? 'bg-amber-400 text-white animate-pulse' :
                            s.status === 'failed' ? 'bg-rose-500 text-white' :
                              'bg-white border-slate-100 text-slate-300'
                      )}>
                        {s.status === 'completed' && <CheckCircle2 size={14} />}
                        {s.status === 'in_progress' && <Loader2 size={14} className="animate-spin" />}
                        {s.status === 'failed' && <AlertCircle size={14} />}
                        {(s.status === 'pending' || (!['completed','in_progress','failed'].includes(s.status))) && (
                          <span className="text-[10px] font-black">{idx + 1}</span>
                        )}
                      </div>

                      <button
                        onClick={() => isAdmin && s.output ? setExpandedStep(expandedStep === s.step_name ? null : s.step_name) : undefined}
                        className={cn(
                          "flex-1 text-left rounded-xl p-3 shadow-sm transition-all border",
                          s.status === 'in_progress' ? "bg-amber-50 border-amber-100 ring-1 ring-amber-200" : "bg-white border-slate-100",
                          isAdmin && s.output ? "hover:border-teal-200 hover:shadow-md cursor-pointer" : "cursor-default"
                        )}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className={cn(
                            "text-[10px] font-black uppercase tracking-widest",
                            s.status === 'failed' ? 'text-rose-600' : 'text-slate-800'
                          )}>
                            {s.step_name}
                          </span>
                          <span className={cn(
                            "text-[9px] font-black uppercase",
                            s.status === 'completed' ? 'text-teal-600' :
                              s.status === 'in_progress' ? 'text-amber-600' : 'text-slate-400'
                          )}>
                            {s.status}
                          </span>
                        </div>
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-tight">
                          {s.agent_name || 'System'}
                        </div>
                        {s.error && (
                          <div className="mt-1.5 text-[10px] text-rose-600 bg-rose-50/50 p-2 rounded-lg border border-rose-100/50 font-bold">
                            {String(s.error)}
                          </div>
                        )}
                        {isAdmin && !!s.output && (
                          <div className="mt-1.5 flex justify-end">
                            <span className="text-[8px] font-black text-teal-600 uppercase tracking-widest bg-teal-50 px-1.5 py-0.5 rounded">
                              {expandedStep === s.step_name ? 'Close Trace' : 'View Trace'}
                            </span>
                          </div>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Results — right column of the panel */}
            <div className="xl:col-span-3 p-5 space-y-4 overflow-y-auto">
              <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">Results</h3>

              {/* Error banner */}
              {job.error && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-red-900">Job Failed</p>
                    <p className="text-xs text-red-700 mt-0.5 leading-relaxed">{job.error}</p>
                  </div>
                </div>
              )}

              {/* Reasoning token stream */}
              {reasoningTokens && (
                <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-800">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping absolute" />
                    <div className="w-2 h-2 bg-blue-500 rounded-full relative" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Live Stream</span>
                  </div>
                  <pre
                    ref={tokenRef}
                    className="p-4 text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed max-h-[220px] overflow-y-auto"
                  >
                    {reasoningTokens}
                  </pre>
                </div>
              )}

              {/* Expanded step trace */}
              {expandedStep && (() => {
                const s = steps.find(x => x.step_name === expandedStep)
                if (!s?.output) return null
                return (
                  <div className="animate-in fade-in duration-200">
                    <ResultSection label={`Trace: ${s.step_name}`} value={s.output} />
                  </div>
                )
              })()}

              {/* Final results */}
              {resultSections.length > 0 ? (
                <div className="space-y-3 animate-in fade-in duration-300">
                  {resultSections.map(({ key, value }) => (
                    <ResultSection key={key} label={key.replace(/_/g, ' ')} value={value} />
                  ))}
                </div>
              ) : (
                !job.error && (
                  <div className="py-16 text-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/30">
                    <FileText size={36} className="mx-auto text-slate-200 mb-3" />
                    <p className="text-slate-400 font-black uppercase tracking-[0.15em] text-[10px]">
                      {job.status === 'in_progress' ? 'Waiting for results...' : 'No results available'}
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function JobHistory() {
  const { isAdmin } = useAuth()
  const [jobs, setJobs] = useState<Job[]>([])
  const [totalJobs, setTotalJobs] = useState(0)
  const [pipelines, setPipelines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedJob, setSelectedJob] = useState<{ id: string; pipelineName: string } | null>(null)

  // Filtering states
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [pipelineFilter, setPipelineFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  useEffect(() => {
    async function fetchConstants() {
      try {
        const res = await configApi.get('/pipelines/graph/')
        setPipelines(res.data)
      } catch (e) {
        console.error('Failed to load pipelines', e)
      }
    }
    fetchConstants()
  }, [])

  useEffect(() => {
    async function loadJobs() {
      setLoading(true)
      try {
        const offset = (currentPage - 1) * itemsPerPage
        const res = await orchestratorApi.get(`/v1/jobs/?limit=${itemsPerPage}&offset=${offset}&status=${statusFilter}`)
        const { items, total } = res.data
        setJobs(items)
        setTotalJobs(total)
      } finally {
        setLoading(false)
      }
    }
    loadJobs()
  }, [currentPage, statusFilter])

  useEffect(() => {
    setCurrentPage(1)
  }, [statusFilter])

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      const pipeline = j.pipeline_id ? pipelines.find(p => p.id === j.pipeline_id || p.pipeline_id === j.pipeline_id) : null
      const pipelineName = j.pipeline_name || pipeline?.name || pipeline?.pipeline_name || (Array.isArray(j.pipeline) ? j.pipeline.join(' → ') : j.pipeline) || 'Unknown Pipeline'
      const matchesPipeline = !pipelineFilter || pipelineName === pipelineFilter
      const matchesSearch = !searchQuery || j.job_id.slice(0, 12).toLowerCase().includes(searchQuery.toLowerCase())
      return matchesPipeline && matchesSearch
    })
  }, [jobs, pipelineFilter, searchQuery, pipelines])

  const totalPages = Math.ceil(totalJobs / itemsPerPage)

  const formatTime = (isoString?: string) => {
    if (!isoString) return { date: '--', time: '--' }
    const date = new Date(isoString)
    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  }

  const formatDuration = (j: Job) => {
    const isFinished = ['completed', 'failed', 'error'].includes(j.status?.toLowerCase() || '')
    if (!isFinished) return '--'
    if (j.created_at && j.updated_at) {
      const s = Math.max(0, Math.floor((new Date(j.updated_at).getTime() - new Date(j.created_at).getTime()) / 1000))
      return s > 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
    }
    return '--'
  }

  const getPipelineName = (j: Job) => {
    const pipeline = j.pipeline_id ? pipelines.find(p => p.id === j.pipeline_id || p.pipeline_id === j.pipeline_id) : null
    return j.pipeline_name || pipeline?.name || pipeline?.pipeline_name || (Array.isArray(j.pipeline) ? j.pipeline.join(' → ') : j.pipeline) || 'Unknown Pipeline'
  }

  const allPipelineNames = useMemo(() => {
    const fromPipelines = pipelines
      .filter(p => p.is_active)
      .map(p => p.name || p.pipeline_name)
      .filter(Boolean)
    return Array.from(new Set(fromPipelines))
  }, [pipelines])

  if (loading && jobs.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-teal-500/20 border-t-teal-500 rounded-full animate-spin" />
          <p className="text-[var(--color-text-muted)] font-medium animate-pulse">Loading Job History...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <PageHeader title={isAdmin ? 'Job History' : 'My Jobs'} />

      {/* Filter Row */}
      <div className="bg-[var(--color-surface)] p-4 rounded-2xl border border-[var(--color-border)] shadow-sm flex flex-col md:flex-row items-center gap-4">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
          <input
            type="text"
            placeholder="Search by job ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-main)] placeholder:text-[var(--color-text-muted)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-medium"
          />
        </div>

        <CustomSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: '', label: 'All Status' },
            { value: 'in_progress', label: 'In Progress' },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' }
          ]}
          className="w-full md:w-[150px]"
        />

        <CustomSelect
          value={pipelineFilter}
          onChange={setPipelineFilter}
          options={[
            { value: '', label: 'All Pipelines' },
            ...allPipelineNames.map(name => ({ value: name, label: name }))
          ]}
          className="w-full md:w-[180px]"
        />
      </div>

      {/* Split-pane: list + detail */}
      <div className={cn(
        "bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden flex",
        selectedJob ? "min-h-[600px]" : ""
      )}>
        {/* LEFT: Job list */}
        <div className={cn(
          "flex flex-col relative transition-all duration-300",
          selectedJob ? "w-[380px] shrink-0 border-r border-[var(--color-border)]" : "flex-1"
        )}>
          {loading && (
            <div className="absolute inset-0 bg-[var(--color-surface)]/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
              <div className="w-7 h-7 border-4 border-teal-500/20 border-t-teal-500 rounded-full animate-spin" />
            </div>
          )}

          {/* List header */}
          <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg)] shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center text-teal-500">
                <Activity size={18} className="animate-pulse" />
              </div>
              <div>
                <h3 className="font-bold text-[var(--color-text-main)]">Job History</h3>
                <p className="text-[10px] text-[var(--color-text-muted)] font-medium">
                  {totalJobs} total · click row to inspect
                </p>
              </div>
            </div>
          </div>

          {/* List body */}
          <div className="overflow-x-auto flex-1">
            {filteredJobs.length === 0 && !loading ? (
              <div className="p-12 text-center space-y-3">
                <div className="w-14 h-14 bg-[var(--color-bg)] rounded-full flex items-center justify-center mx-auto text-[var(--color-text-muted)]">
                  <ClipboardList size={28} />
                </div>
                <p className="text-[var(--color-text-muted)] font-medium text-sm">No jobs found matching your filters.</p>
              </div>
            ) : selectedJob ? (
              // Compact list when panel is open
              <div className="divide-y divide-[var(--color-border)]">
                {filteredJobs.map((j) => {
                  const jobTime = formatTime(j.created_at)
                  const pipelineName = getPipelineName(j)
                  const isSelected = selectedJob?.id === j.job_id
                  return (
                    <button
                      key={j.job_id}
                      onClick={() => setSelectedJob({ id: j.job_id, pipelineName })}
                      className={cn(
                        "w-full text-left px-4 py-3 transition-colors flex items-start gap-3 group",
                        isSelected
                          ? "bg-teal-50 border-l-2 border-teal-500"
                          : "hover:bg-[var(--color-bg)] border-l-2 border-transparent"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-mono text-xs text-[var(--color-text-muted)] truncate">{j.job_id.slice(0, 12)}</span>
                          <StatusBadge status={j.status} />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-tight truncate">{pipelineName}</span>
                          <span className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap shrink-0">{jobTime.time}</span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              // Full table when no panel
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-xs uppercase tracking-widest font-black">
                    <th className="px-6 py-4">Job ID</th>
                    <th className="px-6 py-4">Pipeline</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Duration</th>
                    <th className="px-6 py-4 text-center">Time</th>
                    <th className="px-6 py-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filteredJobs.map((j) => {
                    const jobTime = formatTime(j.created_at)
                    const pipelineName = getPipelineName(j)
                    return (
                      <tr
                        key={j.job_id}
                        onClick={() => setSelectedJob({ id: j.job_id, pipelineName })}
                        className="hover:bg-[var(--color-bg)] transition-colors group border-b border-[var(--color-border)] last:border-0 h-[72px] cursor-pointer"
                      >
                        <td className="px-6 align-middle">
                          <div className="flex items-center h-full font-mono text-sm text-[var(--color-text-muted)]">
                            {j.job_id.slice(0, 12)}
                          </div>
                        </td>
                        <td className="px-6 align-middle">
                          <div className="flex items-center h-full">
                            <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-tighter truncate max-w-[200px]" title={pipelineName}>
                              {pipelineName}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 align-middle">
                          <div className="flex items-center h-full">
                            <StatusBadge status={j.status} />
                          </div>
                        </td>
                        <td className="px-6 align-middle">
                          <div className="flex items-center h-full text-sm font-bold text-[var(--color-text-muted)]">
                            {formatDuration(j)}
                          </div>
                        </td>
                        <td className="px-6 align-middle">
                          <div className="flex items-center justify-center h-full text-sm font-bold text-[var(--color-text-muted)] whitespace-nowrap">
                            {jobTime.date} <span className="mx-1">•</span> {jobTime.time}
                          </div>
                        </td>
                        <td className="px-6 align-middle" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-center h-full">
                            <Link
                              to={`/jobs/${j.job_id}`}
                              className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-[var(--color-text-muted)] hover:text-teal-600 hover:bg-teal-50/30 transition-all border border-transparent hover:border-teal-900/50"
                              title="Open full detail page"
                            >
                              <ExternalLink size={18} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 bg-[var(--color-bg)] border-t border-[var(--color-border)] flex items-center justify-between shrink-0">
              <p className="text-[10px] text-[var(--color-text-muted)] font-medium">
                <span className="font-bold text-[var(--color-text-main)]">{(currentPage - 1) * itemsPerPage + 1}</span>
                {' – '}
                <span className="font-bold text-[var(--color-text-main)]">{Math.min(currentPage * itemsPerPage, totalJobs)}</span>
                {' of '}
                <span className="font-bold text-[var(--color-text-main)]">{totalJobs}</span>
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-teal-600 disabled:opacity-50 transition-all"
                >
                  <ChevronLeft size={16} />
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum = currentPage
                    if (currentPage <= 3) pageNum = i + 1
                    else if (currentPage > totalPages - 2) pageNum = totalPages - 4 + i
                    else pageNum = currentPage - 2 + i
                    if (pageNum < 1 || pageNum > totalPages) return null
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={cn(
                          "w-8 h-8 flex-shrink-0 rounded-lg text-xs font-bold transition-all",
                          currentPage === pageNum
                            ? "bg-teal-600 text-white shadow-lg shadow-teal-600/20"
                            : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-main)] hover:border-teal-200 hover:text-teal-600"
                        )}
                      >
                        {pageNum}
                      </button>
                    )
                  })}
                </div>

                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-teal-600 disabled:opacity-50 transition-all"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Detail panel */}
        {selectedJob && (
          <div className="flex-1 min-w-0 min-h-[600px]">
            <JobDetailPanel
              key={selectedJob.id}
              jobId={selectedJob.id}
              pipelineName={selectedJob.pipelineName}
              onClose={() => setSelectedJob(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

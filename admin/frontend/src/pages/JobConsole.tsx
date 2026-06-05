import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { orchestratorApi, configApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import PageHeader from '@/components/PageHeader'
import StatusBadge from '@/components/StatusBadge'
import JsonViewer from '@/components/JsonViewer'
import { cn } from '@/lib/cn'
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  History
} from 'lucide-react'

interface Pipeline { id: string | number; pipeline_id?: string; name: string; steps: Array<{ name: string; agent: string }> }
interface JobStep { step_name: string; status: string; agent_name?: string; output?: unknown; error?: string }

interface EpidemicOutput {
  equilibrium_policy?: string
  npi_measures?: string[]
  economic_mitigations?: string[]
  compliance_enablers?: string[]
  r0_projection?: number
  confidence?: number
  conflicts?: Array<{ field: string; winner: string; rationale: string }>
  overall_confidence?: number
}

const EPIDEMIC_TAB_LABELS: [keyof EpidemicOutput, string][] = [
  ['equilibrium_policy', 'Final Policy'],
  ['npi_measures', 'NPI Measures'],
  ['economic_mitigations', 'Economic Plan'],
  ['compliance_enablers', 'Compliance Plan'],
  ['conflicts', 'Conflict Resolution'],
]

function ConfidencePill({ value }: { value?: number }) {
  if (value == null) return null
  const pct = Math.round(value * 100)
  const color = value >= 0.85 ? 'text-green-700 bg-green-50' : value >= 0.70 ? 'text-yellow-700 bg-yellow-50' : 'text-red-700 bg-red-50'
  return <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', color)}>{pct}%</span>
}

function EpidemicResultPanel({ output, tokenStream }: { output: EpidemicOutput | null; tokenStream: string }) {
  const [activeTab, setActiveTab] = useState<keyof EpidemicOutput>('equilibrium_policy')

  if (!output && !tokenStream) return null

  return (
    <div className="mt-4 border border-teal-100 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-teal-50 border-b border-teal-100">
        <span className="text-xs font-semibold text-teal-700 uppercase tracking-wide">Agent Output</span>
        {(output?.confidence ?? output?.overall_confidence) != null && (
          <ConfidencePill value={output?.confidence ?? output?.overall_confidence} />
        )}
      </div>

      {/* Live token stream */}
      {!output && tokenStream && (
        <div className="p-3 bg-gray-950 font-mono text-xs text-green-400 min-h-24 max-h-64 overflow-auto whitespace-pre-wrap">
          {tokenStream}
          <span className="animate-pulse">▌</span>
        </div>
      )}

      {output && (
        <>
          <div className="flex border-b border-gray-200 bg-white overflow-x-auto">
            {EPIDEMIC_TAB_LABELS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  'px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
                  activeTab === key
                    ? 'border-teal-500 text-teal-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-3 bg-white max-h-72 overflow-auto">
            {activeTab === 'equilibrium_policy' && (
              <p className="text-xs text-gray-700 leading-relaxed font-medium">
                {output.equilibrium_policy || <span className="italic text-gray-400">No policy generated</span>}
              </p>
            )}

            {activeTab === 'npi_measures' && (
              <div className="space-y-1">
                {(output.npi_measures ?? []).length === 0
                  ? <p className="text-xs text-gray-400 italic">No NPI measures</p>
                  : output.npi_measures!.map((m, i) => (
                    <div key={i} className="flex gap-1.5 text-xs text-gray-700">
                      <span className="text-teal-500 mt-0.5 shrink-0">•</span><span>{m}</span>
                    </div>
                  ))}
              </div>
            )}

            {activeTab === 'economic_mitigations' && (
              <div className="space-y-1">
                {(output.economic_mitigations ?? []).length === 0
                  ? <p className="text-xs text-gray-400 italic">No economic mitigations</p>
                  : output.economic_mitigations!.map((m, i) => (
                    <div key={i} className="flex gap-1.5 text-xs text-gray-700">
                      <span className="text-amber-500 mt-0.5 shrink-0">•</span><span>{m}</span>
                    </div>
                  ))}
              </div>
            )}

            {activeTab === 'compliance_enablers' && (
              <div className="space-y-1">
                {(output.compliance_enablers ?? []).length === 0
                  ? <p className="text-xs text-gray-400 italic">No compliance enablers</p>
                  : output.compliance_enablers!.map((m, i) => (
                    <div key={i} className="flex gap-1.5 text-xs text-gray-700">
                      <span className="text-violet-500 mt-0.5 shrink-0">•</span><span>{m}</span>
                    </div>
                  ))}
              </div>
            )}

            {activeTab === 'conflicts' && (
              <div className="space-y-2">
                {(output.conflicts ?? []).length === 0
                  ? <p className="text-xs text-gray-400 italic">No conflicts detected</p>
                  : output.conflicts!.map((c, i) => (
                    <div key={i} className="p-2 rounded border border-gray-100 bg-gray-50">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-wide">{c.field}</span>
                        <span className="text-[10px] font-bold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded">Won: {c.winner}</span>
                      </div>
                      <p className="text-xs text-gray-600">{c.rationale}</p>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function JobConsole() {
  const { token, isAdmin } = useAuth()

  const [text, setText] = useState('')
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedPipeline, setSelectedPipeline] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Job tracking
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<string | null>(null)
  const [steps, setSteps] = useState<JobStep[]>([])
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [liveMode, setLiveMode] = useState<'sse' | 'polling' | null>(null)

  // Epidemic output
  const [tokenStream, setTokenStream] = useState('')
  const [epidemicOutput, setEpidemicOutput] = useState<EpidemicOutput | null>(null)

  const sseRef = useRef<EventSource | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    configApi.get('/pipelines/graph/').then(async (r) => {
      const activePipelines = r.data.filter((p: any) => p.is_active);
      const detailedPipelines = await Promise.all(
        activePipelines.map((p: any) =>
          configApi.get(`/pipelines/graph/${p.id}`).then((res) => {
            const graph = res.data;
            return {
              id: graph.id,
              pipeline_id: graph.id,
              name: graph.name,
              steps: (graph.nodes || []).map((n: any) => ({
                name: n.node_key,
                agent: n.agent?.name || '',
              })),
            };
          })
        )
      );
      setPipelines(detailedPipelines);
      console.log("ACTIVE PIPELINES DETAILED:", detailedPipelines);

    }).catch((e) => {
      console.error('Failed to load pipelines', e);
    });
  }, [])

  useEffect(() => {
    return () => { stopTracking() }
  }, [])

  function stopTracking() {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    demoTimers.current.forEach(clearTimeout)
    demoTimers.current = []
  }

  function startPolling(id: string) {
    setLiveMode('polling')
    pollRef.current = setInterval(async () => {
      try {
        const [jobRes, stepsRes] = await Promise.all([
          orchestratorApi.get(`/v1/jobs/${id}`),
          orchestratorApi.get(`/v1/jobs/${id}/steps`),
        ])
        setJobStatus(jobRes.data.status)
        setSteps(stepsRes.data)
        if (jobRes.data.result) {
          setResult(jobRes.data.result)
          setEpidemicOutput(jobRes.data.result as EpidemicOutput)
        }
        if (jobRes.data.error) setError(jobRes.data.error)
        if (['completed', 'failed'].includes(jobRes.data.status)) {
          stopTracking()
          setLiveMode(null)
        }
      } catch { /* ignore */ }
    }, 2000)
  }

  function startSSE(id: string) {
    if (!token) { startPolling(id); return }

    setLiveMode('sse')
    const url = `/api/v1/jobs/${id}/stream?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    sseRef.current = es

    es.addEventListener('job.started', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      console.log("Job Started - Steps:", data.steps)
      setJobStatus(data.status)
      setSteps(data.steps ?? [])
    })

    es.addEventListener('step.started', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      console.log("Step Started:", data.step)
      setSteps((prev: JobStep[]) => prev.map((s) =>
        s.step_name === data.step ? { ...s, status: 'in_progress' } : s,
      ))
      if (data.step === 'reason') {
        setTokenStream('')
      }
    })

    es.addEventListener('step.completed', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      console.log("Step Completed:", data.step)
      setSteps((prev: JobStep[]) => prev.map((s) =>
        s.step_name === data.step ? { ...s, status: 'completed' } : s,
      ))
    })

    es.addEventListener('step.failed', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      setSteps((prev: JobStep[]) => prev.map((s) =>
        s.step_name === data.step ? { ...s, status: 'failed', error: data.error } : s,
      ))
    })

    es.addEventListener('token.stream', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      if (data.token) {
        setTokenStream((prev) => prev + data.token)
      }
    })

    es.addEventListener('job.completed', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      setJobStatus('completed')
      if (data.result) {
        setResult(data.result)
        setEpidemicOutput(data.result as EpidemicOutput)
        setTokenStream('')
      }
      stopTracking()
      setLiveMode(null)
    })

    es.addEventListener('job.failed', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      setJobStatus('failed')
      setError(data.error ?? 'Job failed')
      stopTracking()
      setLiveMode(null)
    })

    es.onerror = () => {
      es.close()
      sseRef.current = null
      startPolling(id)
    }
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setSubmitting(true)

    
    setJobId(null);
    setJobStatus(null);
    setSteps([]);
    setResult(null)
    setError(null);
    setTokenStream('');
    setEpidemicOutput(null)
    stopTracking()

    try {
      const fd = new FormData()

      
      let jobValue = "";
      if (selectedPipeline) {
        const pipe = pipelines.find(p => p.name === selectedPipeline);
        jobValue = pipe?.steps.map(s => s.name).join(",") || "";
        if (pipe?.pipeline_id) {
          fd.append('pipeline_id', pipe.pipeline_id);
        }
      } else {
        jobValue = 'epidemic_response';
      }

      fd.append('text', text)
      fd.append('job', jobValue)

      
      const res = await orchestratorApi.post('/v1/jobs/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      

      const id = res.data.job_id
      setJobId(id)
      setJobStatus('in_progress')


      startSSE(id)

    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Submission failed'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  function runDemo() {
    stopTracking()
    setJobId(null); setJobStatus(null); setSteps([]); setResult(null)
    setError(null); setTokenStream(''); setEpidemicOutput(null)

    const fakeId = 'demo-' + Math.random().toString(36).slice(2, 10)
    const t = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms)
      demoTimers.current.push(id)
    }

    const initialSteps: JobStep[] = [
      { step_name: 'epidemiologist', status: 'pending', agent_name: 'EpidemiologistAgent' },
      { step_name: 'economist', status: 'pending', agent_name: 'EconomicImpactAgent' },
      { step_name: 'compliance', status: 'pending', agent_name: 'PublicComplianceAgent' },
      { step_name: 'merge', status: 'pending', agent_name: 'ResponseMerger' },
      { step_name: 'aggregate', status: 'pending', agent_name: 'decision_aggregator' },
    ]

    setJobId(fakeId)
    setJobStatus('in_progress')
    setSteps(initialSteps)
    setLiveMode('sse')

    // Step 1-3: parallel fanout — all three agents start together
    t(400, () => setSteps(prev => prev.map(s =>
      ['epidemiologist', 'economist', 'compliance'].includes(s.step_name) ? { ...s, status: 'in_progress' } : s
    )))
    t(2200, () => setSteps(prev => prev.map(s =>
      s.step_name === 'epidemiologist' ? { ...s, status: 'completed' } : s
    )))
    t(2800, () => setSteps(prev => prev.map(s =>
      s.step_name === 'economist' ? { ...s, status: 'completed' } : s
    )))
    t(3200, () => setSteps(prev => prev.map(s =>
      s.step_name === 'compliance' ? { ...s, status: 'completed' } : s
    )))

    // Step 4: merger quorum
    t(3400, () => setSteps(prev => prev.map(s => s.step_name === 'merge' ? { ...s, status: 'in_progress' } : s)))
    t(4000, () => setSteps(prev => prev.map(s => s.step_name === 'merge' ? { ...s, status: 'completed' } : s)))

    // Step 5: aggregator conflict resolution (stream tokens)
    t(4200, () => {
      setTokenStream('')
      setSteps(prev => prev.map(s => s.step_name === 'aggregate' ? { ...s, status: 'in_progress' } : s))
    })

    const tokenChunks = [
      '{\n  "equilibrium_policy": "Reduce transit to 30%...',
      '\n  ...with free mask distribution at entry gates.',
      '\n  School closures 14 days. Essential supply chains',
      '\n  maintained.\n  ',
      '\n  "conflicts": [\n    { "field": "transit_policy",',
      '\n      "winner": "EconomicImpactAgent",',
      '\n      "rationale": "Full closure triggers food desert collapse" }',
      '\n  ],\n  "r0_projection": 0.87\n}',
    ]
    tokenChunks.forEach((chunk, i) => {
      t(4600 + i * 500, () => setTokenStream(prev => prev + chunk))
    })

    const mockResult: EpidemicOutput = {
      equilibrium_policy: 'Reduce transit capacity to 30% with mandatory free masking at all entry gates. Close schools for 14 days. Keep essential supply chains open. Re-evaluate at day 10.',
      npi_measures: [
        'Transit capacity reduced to 30% (full closure vetoed by EconomicImpactAgent)',
        'Mandatory mask use at all transit entry points with free mask distribution',
        'School closures for 14 days',
        'Non-essential business restricted to 50% capacity',
      ],
      economic_mitigations: [
        'Essential goods supply chains maintained at full capacity',
        'Small business support fund activated for affected retail',
        'Food desert delivery programme extended to cover transit gap',
      ],
      compliance_enablers: [
        'Free masks at transit gates — PublicComplianceAgent: required, else compliance < 40%',
        'Daily public briefings from health authority',
        'Economic support hotline for affected workers',
      ],
      r0_projection: 0.87,
      confidence: 0.81,
      conflicts: [
        { field: 'transit_policy', winner: 'EconomicImpactAgent', rationale: 'Full 21-day transit closure triggers food desert supply collapse, outweighing marginal R0 gain from 0.87 to 0.74' },
        { field: 'mask_mandate', winner: 'PublicComplianceAgent', rationale: 'Free mask provision is non-negotiable — without it compliance drops below 40% by day 5' },
      ],
    }

    t(9000, () => {
      setSteps(prev => prev.map(s => s.step_name === 'aggregate' ? { ...s, status: 'completed' } : s))
      setTokenStream('')
      setEpidemicOutput(mockResult)
      setResult(mockResult)
      setJobStatus('completed')
      setLiveMode(null)
    })
  }

  return (
    <>
      <PageHeader title={isAdmin ? 'Job Testing Console' : 'New Job'} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Left: Submit Form */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest mb-6">Scenario Input</h3>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <textarea
                  rows={8}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Describe the epidemic scenario (e.g. R0, population, affected transit hubs, current ICU capacity)..."
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 placeholder:text-gray-300 transition-all"
                />
              </div>

              {isAdmin && (
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Pipeline</label>
                  <select
                    value={selectedPipeline}
                    onChange={(e) => setSelectedPipeline(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
                  >
                    <option value="">Auto-select</option>
                    {pipelines.map((p) => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-4 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-3.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 font-bold text-sm tracking-wide shadow-lg shadow-teal-600/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" size={18} />
                      Processing...
                    </>
                  ) : 'Start Processing'}
                </button>
                <button
                  type="button"
                  onClick={runDemo}
                  className="px-6 py-3.5 bg-gray-50 text-gray-600 rounded-xl hover:bg-gray-100 font-bold text-sm transition-all active:scale-[0.98] border border-gray-100"
                >
                  Demo
                </button>
              </div>
            </form>
          </div>

        </div>

        {/* Right: Job Tracker (img3/4 style) */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden h-full flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-3">
                <h3 className="font-bold text-gray-900 tracking-tight">Job Tracking</h3>
                {jobId && <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">#{jobId}</span>}
                {liveMode && (
                  <span className={cn(
                    "flex items-center gap-1.5 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                    liveMode === 'sse' ? "bg-teal-50 text-teal-600" : "bg-amber-50 text-amber-600"
                  )}>
                    <span className={cn(
                      "w-1 h-1 rounded-full",
                      liveMode === 'sse' ? "bg-teal-500 animate-pulse" : "bg-amber-500"
                    )} />
                    {liveMode}
                  </span>
                )}
              </div>
              {jobStatus && <StatusBadge status={jobStatus} />}
            </div>

            <div className="flex-1 p-6 relative flex flex-col gap-8 overflow-y-auto">
              {!jobId && !error && (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-gray-300 mb-4">
                    <History size={24} />
                  </div>
                  <p className="text-sm font-medium text-gray-400">No active job</p>
                  <p className="text-xs text-gray-300 mt-1">Submit a job to see progress</p>
                </div>
              )}

              {error && !jobId && (
                <div className="bg-red-50 text-red-700 rounded-xl p-4 text-xs font-medium border border-red-100">
                  {error}
                </div>
              )}

              {jobId && (
                <>
                  {/* Vertical Timeline (img3 style) */}
                  <div className="relative">
                    <div className="absolute left-[15px] top-6 bottom-6 w-px bg-gray-100" />
                    <div className="space-y-6">
                      {steps.map((s, i) => (
                        <div key={s.step_name} className="flex gap-4 relative">
                          <div className={cn(
                            "w-8 h-8 rounded-full border-4 border-white z-10 shadow-sm flex items-center justify-center shrink-0 transition-all",
                            s.status === 'completed' ? "bg-teal-500 text-white" :
                              s.status === 'in_progress' ? "bg-amber-400 text-white animate-pulse" :
                                s.status === 'failed' ? "bg-red-500 text-white" : "bg-gray-100 text-gray-300"
                          )}>
                            {s.status === 'completed' ? <CheckCircle2 size={14} /> :
                              s.status === 'in_progress' ? <Loader2 size={14} className="animate-spin" /> :
                                s.status === 'failed' ? <AlertCircle size={14} /> : <span className="text-[10px] font-bold">{i + 1}</span>}
                          </div>
                          <div className={cn(
                            "flex-1 p-3 rounded-xl border transition-all",
                            s.status === 'in_progress' ? "bg-amber-50 border-amber-100 ring-1 ring-amber-200" :
                              s.status === 'completed' ? "bg-white border-gray-100" : "bg-gray-50/50 border-gray-100"
                          )}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-bold text-gray-900 uppercase tracking-tighter">{s.step_name}</span>
                              <span className={cn(
                                "text-[10px] font-bold uppercase",
                                s.status === 'completed' ? "text-teal-600" :
                                  s.status === 'in_progress' ? "text-amber-600" : "text-gray-400"
                              )}>{s.status}</span>
                            </div>
                            {s.agent_name && <p className="text-[10px] text-gray-400 font-medium">Agent: {s.agent_name}</p>}
                            {s.error && <p className="text-[10px] text-red-600 mt-2 font-medium">{String(s.error)}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Real-time Monitor (img4 style) */}
                  {(tokenStream || jobStatus === 'in_progress') && (
                    <div className="space-y-3 animate-in fade-in duration-500">
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Real-time Monitoring</h4>
                      <div className="bg-slate-900 rounded-xl p-4 font-mono text-[11px] leading-relaxed text-teal-400 shadow-inner max-h-48 overflow-auto scrollbar-hide">
                        {tokenStream}
                        {jobStatus === 'in_progress' && <span className="animate-pulse inline-block w-1.5 h-3 bg-teal-400 ml-1" />}
                      </div>
                    </div>
                  )}

                  {/* Navigation Button */}
                  {jobStatus === 'completed' && (
                    <div className="mt-4 animate-in slide-in-from-bottom-2 duration-300">
                      <Link
                        to={`/jobs/${jobId}`}
                        className="flex items-center justify-center gap-2 w-full py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-all font-bold text-sm tracking-wide shadow-lg"
                      >
                        View Full Report
                        <History size={16} />
                      </Link>
                    </div>
                  )}

                  {epidemicOutput && (
                    <div className="mt-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <EpidemicResultPanel output={epidemicOutput} tokenStream="" />
                    </div>
                  )}

                  {result != null && !epidemicOutput && (
                    <div className="animate-in fade-in duration-500">
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Raw Result</h4>
                      <div className="bg-white border border-gray-100 rounded-xl p-4">
                        <JsonViewer data={result} />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

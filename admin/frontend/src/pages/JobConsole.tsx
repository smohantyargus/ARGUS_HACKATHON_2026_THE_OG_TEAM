import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { orchestratorApi, configApi } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import PageHeader from '@/components/PageHeader'
import StatusBadge from '@/components/StatusBadge'
import JsonViewer from '@/components/JsonViewer'
import { cn } from '@/lib/cn'
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  History,
  CloudUpload
} from 'lucide-react'

interface Pipeline { id: string | number; pipeline_id?: string; name: string; steps: Array<{ name: string; agent: string }> }
interface JobStep { step_name: string; status: string; agent_name?: string; output?: unknown; error?: string }

interface ReasoningOutput {
  soap?: { subjective?: string[]; objective?: string[]; assessment?: string[]; plan?: string[]; confidence?: number }
  differential?: Array<{ diagnosis: string; confidence?: number; rationale?: string }>
  lab_suggestions?: Array<{ test: string; rationale?: string; urgency?: string }>
  medication_suggestions?: Array<{ name: string; dose?: string; route?: string; duration?: string; rationale?: string }>
  next_questions?: string[]
  flag_for_review?: boolean
  overall_confidence?: number
}

const REASONING_TAB_LABELS: [keyof ReasoningOutput, string][] = [
  ['soap', 'SOAP'],
  ['differential', 'Differential'],
  ['lab_suggestions', 'Labs'],
  ['medication_suggestions', 'Medications'],
  ['next_questions', 'Next Questions'],
]

function ConfidencePill({ value }: { value?: number }) {
  if (value == null) return null
  const pct = Math.round(value * 100)
  const color = value >= 0.85 ? 'text-green-700 bg-green-50' : value >= 0.70 ? 'text-yellow-700 bg-yellow-50' : 'text-red-700 bg-red-50'
  return <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', color)}>{pct}%</span>
}

function ReasoningResultPanel({ output, tokenStream }: { output: ReasoningOutput | null; tokenStream: string }) {
  const [activeTab, setActiveTab] = useState<keyof ReasoningOutput>('soap')

  if (!output && !tokenStream) return null

  return (
    <div className="mt-4 border border-teal-100 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-teal-50 border-b border-teal-100">
        <span className="text-xs font-semibold text-teal-700 uppercase tracking-wide">Agent Output</span>
        {output?.overall_confidence != null && (
          <div className="flex items-center gap-1.5">
            {output.flag_for_review && (
              <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full font-medium">Review needed</span>
            )}
            <ConfidencePill value={output.overall_confidence} />
          </div>
        )}
      </div>

      {/* Live token stream (while generating) */}
      {!output && tokenStream && (
        <div className="p-3 bg-gray-950 font-mono text-xs text-green-400 min-h-24 max-h-64 overflow-auto whitespace-pre-wrap">
          {tokenStream}
          <span className="animate-pulse">▌</span>
        </div>
      )}

      {/* Structured tabs (once complete) */}
      {output && (
        <>
          <div className="flex border-b border-gray-200 bg-white overflow-x-auto">
            {REASONING_TAB_LABELS.map(([key, label]) => (
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
            {activeTab === 'soap' && output.soap && (
              <div className="space-y-3">
                {(['subjective', 'objective', 'assessment', 'plan'] as const).map((section) => (
                  <div key={section}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-xs font-semibold text-teal-700 uppercase">{section}</span>
                      {output.soap?.confidence != null && section === 'assessment' && (
                        <ConfidencePill value={output.soap.confidence} />
                      )}
                    </div>
                    {(output.soap?.[section] ?? []).length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No data</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {(output.soap?.[section] ?? []).map((item, i) => (
                          <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                            <span className="text-gray-400 mt-0.5">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'differential' && (
              <div className="space-y-2">
                {(output.differential ?? []).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No differential diagnoses</p>
                ) : (
                  output.differential!.map((item, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 p-2 rounded border border-gray-100 bg-gray-50">
                      <div>
                        <p className="text-xs font-medium text-gray-800">{item.diagnosis}</p>
                        {item.rationale && <p className="text-xs text-gray-500 mt-0.5">{item.rationale}</p>}
                      </div>
                      <ConfidencePill value={item.confidence} />
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'lab_suggestions' && (
              <div className="space-y-2">
                {(output.lab_suggestions ?? []).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No lab suggestions</p>
                ) : (
                  output.lab_suggestions!.map((item, i) => (
                    <div key={i} className="p-2 rounded border border-gray-100 bg-gray-50">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium text-gray-800">{item.test}</p>
                        {item.urgency && (
                          <span className={cn(
                            'text-xs px-1.5 py-0.5 rounded font-medium',
                            item.urgency === 'stat' ? 'bg-red-50 text-red-700' :
                              item.urgency === 'urgent' ? 'bg-yellow-50 text-yellow-700' :
                                'bg-gray-100 text-gray-600',
                          )}>{item.urgency}</span>
                        )}
                      </div>
                      {item.rationale && <p className="text-xs text-gray-500 mt-0.5">{item.rationale}</p>}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'medication_suggestions' && (
              <div className="space-y-2">
                {(output.medication_suggestions ?? []).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No medication suggestions</p>
                ) : (
                  output.medication_suggestions!.map((item, i) => (
                    <div key={i} className="p-2 rounded border border-gray-100 bg-gray-50">
                      <p className="text-xs font-semibold text-gray-800">{item.name}</p>
                      <div className="flex gap-3 mt-0.5 flex-wrap">
                        {item.dose && <span className="text-xs text-gray-500">Dose: {item.dose}</span>}
                        {item.route && <span className="text-xs text-gray-500">Route: {item.route}</span>}
                        {item.duration && <span className="text-xs text-gray-500">Duration: {item.duration}</span>}
                      </div>
                      {item.rationale && <p className="text-xs text-gray-400 mt-0.5">{item.rationale}</p>}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'next_questions' && (
              <div className="space-y-1">
                {(output.next_questions ?? []).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No follow-up questions</p>
                ) : (
                  output.next_questions!.map((q, i) => (
                    <div key={i} className="flex gap-1.5 text-xs text-gray-700">
                      <span className="text-gray-400 mt-0.5">{i + 1}.</span>
                      <span>{q}</span>
                    </div>
                  ))
                )}
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
  const { hasFeature } = useFeatureFlags()

  const canAudio = hasFeature('audio_job')
  const canText = hasFeature('text_job')

  const [mode, setMode] = useState<'audio' | 'text'>(() =>
    // Default to first available mode
    canAudio ? 'audio' : 'text',
  )
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [action, setAction] = useState('soap')
  const [modelName] = useState('whisperx')
  const [targetLang] = useState('en')
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

  // Reasoning-specific
  const [tokenStream, setTokenStream] = useState('')
  const [reasoningOutput, setReasoningOutput] = useState<ReasoningOutput | null>(null)

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

  const selectedPipeObj = pipelines.find(p => p.name === selectedPipeline)
  
  const showAction = selectedPipeObj?.steps.some(s => s.agent?.toLowerCase().includes('nlp')) ?? true

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
          // Try to extract reasoning output from result
          if (jobRes.data.result?.overall_confidence != null) {
            setReasoningOutput(jobRes.data.result as ReasoningOutput)
          }
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
        if (data.result?.overall_confidence != null) {
          setReasoningOutput(data.result as ReasoningOutput)
          setTokenStream('')
        }
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
    setReasoningOutput(null)
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
        
        jobValue = mode === 'audio' ? 'transcribe,summarise' : 'summarise';
      }

      
      if (mode === 'audio') {
        if (!file) {
          setError('Please select an audio file');
          setSubmitting(false);
          return;
        }
        fd.append('file', file)
      } else {
        fd.append('text', text)
      }

      fd.append('job', jobValue)
      fd.append('action', action)
      fd.append('model_name', modelName)
      fd.append('target_lang', targetLang)

      
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
    setError(null); setTokenStream(''); setReasoningOutput(null)

    const fakeId = 'demo-' + Math.random().toString(36).slice(2, 10)
    const t = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms)
      demoTimers.current.push(id)
    }

    const initialSteps: JobStep[] = [
      { step_name: 'summarise', status: 'pending', agent_name: 'nlp-agent' },
      { step_name: 'validate_nlp', status: 'pending', agent_name: 'nlp-validator' },
      { step_name: 'reason', status: 'pending', agent_name: 'reasoning-agent' },
    ]

    setJobId(fakeId)
    setJobStatus('in_progress')
    setSteps(initialSteps)
    setLiveMode('sse')

    // Step 1 — summarise
    t(600, () => setSteps(prev => prev.map(s => s.step_name === 'summarise' ? { ...s, status: 'in_progress' } : s)))
    t(2400, () => setSteps(prev => prev.map(s => s.step_name === 'summarise' ? { ...s, status: 'completed' } : s)))

    // Step 2 — validate_nlp
    t(2600, () => setSteps(prev => prev.map(s => s.step_name === 'validate_nlp' ? { ...s, status: 'in_progress' } : s)))
    t(3600, () => setSteps(prev => prev.map(s => s.step_name === 'validate_nlp' ? { ...s, status: 'completed' } : s)))

    // Step 3 — reason (stream tokens)
    t(3800, () => {
      setTokenStream('')
      setSteps(prev => prev.map(s => s.step_name === 'reason' ? { ...s, status: 'in_progress' } : s))
    })

    const tokenChunks = [
      '{\n  "soap": {\n    "subjective": [\n',
      '      "52-year-old male, acute central chest pain 8/10,\n',
      '       radiating to left arm and jaw, onset 90 min ago",\n',
      '      "Associated diaphoresis and nausea"\n',
      '    ],\n    "assessment": [\n',
      '      "Likely ACS — STEMI/NSTEMI pending ECG + troponin"\n',
      '    ]\n  },\n  "differential": [ ... ],\n',
      '  "overall_confidence": 0.84\n}',
    ]
    tokenChunks.forEach((chunk, i) => {
      t(4200 + i * 600, () => setTokenStream(prev => prev + chunk))
    })

    // Complete
    const mockResult: ReasoningOutput = {
      soap: {
        subjective: [
          'Patient is a 52-year-old male with acute central chest pain, 8/10 severity',
          'Radiation to left arm and jaw, onset ~90 minutes ago',
          'Associated diaphoresis and nausea; no prior cardiac history; 20 pack-year smoker',
        ],
        objective: [
          'HR 102 bpm, BP 148/94 mmHg, SpO2 96% on air',
          'Diaphoresis on examination; mild bilateral basal crepitations',
        ],
        assessment: [
          'Likely acute coronary syndrome — STEMI vs NSTEMI pending ECG and troponin',
          'Hypertensive response consistent with pain and sympathetic activation',
        ],
        plan: [
          '12-lead ECG immediately — escalate if ST elevation present',
          'IV access and continuous cardiac monitoring',
          'Aspirin 300 mg chewed stat; Ticagrelor 180 mg loading if STEMI confirmed',
          'Serial high-sensitivity troponin at 0 h and 3 h',
          'Urgent cardiology review',
        ],
        confidence: 0.89,
      },
      differential: [
        { diagnosis: 'ST-Elevation MI (STEMI)', confidence: 0.79, rationale: 'Classic radiation, diaphoresis, risk factors' },
        { diagnosis: 'NSTEMI / Unstable Angina', confidence: 0.72, rationale: 'Cannot differentiate before ECG + troponin' },
        { diagnosis: 'Aortic Dissection', confidence: 0.18, rationale: 'No tearing quality; atypical presentation' },
        { diagnosis: 'Pulmonary Embolism', confidence: 0.12, rationale: 'Pleuritic pain absent; radiation pattern atypical' },
      ],
      lab_suggestions: [
        { test: 'High-sensitivity Troponin I/T', rationale: 'ACS rule-in/out', urgency: 'stat' },
        { test: '12-Lead ECG', rationale: 'ST elevation or LBBB assessment', urgency: 'stat' },
        { test: 'FBC, U&E, LFTs, Coagulation screen', rationale: 'Pre-intervention baseline', urgency: 'urgent' },
        { test: 'Lipid panel + HbA1c', rationale: 'Cardiovascular risk profile', urgency: 'routine' },
      ],
      medication_suggestions: [
        { name: 'Aspirin', dose: '300 mg', route: 'Oral (chewed)', duration: 'Stat loading', rationale: 'First-line antiplatelet for ACS' },
        { name: 'Ticagrelor', dose: '180 mg', route: 'Oral', duration: 'Stat if STEMI confirmed', rationale: 'Dual antiplatelet therapy' },
        { name: 'GTN Spray', dose: '400 mcg', route: 'Sublingual', duration: 'PRN, max 3 doses', rationale: 'Chest pain relief — withhold if SBP < 90' },
        { name: 'Morphine', dose: '2–4 mg', route: 'IV titrated', duration: 'PRN', rationale: 'Analgesia if pain uncontrolled' },
      ],
      next_questions: [
        'Any prior cardiac history — stents, CABG, or previous MI?',
        'Current medications, especially anticoagulants or antiplatelets?',
        'Family history of premature ischaemic heart disease?',
        'Time of last meal (relevant if catheterisation planned)?',
        'Any contraindications to thrombolytics or antiplatelet agents?',
      ],
      flag_for_review: false,
      overall_confidence: 0.84,
    }

    t(9000, () => {
      setSteps(prev => prev.map(s => s.step_name === 'reason' ? { ...s, status: 'completed' } : s))
      setTokenStream('')
      setReasoningOutput(mockResult)
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
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest mb-6">Input Method</h3>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Pill Toggle for Mode */}
              {(canAudio || canText) && (
                <div className="bg-gray-100 p-1 rounded-xl flex gap-1 items-center inline-flex">
                  {canAudio && (
                    <button
                      type="button"
                      onClick={() => setMode('audio')}
                      className={cn(
                        'px-6 py-2 rounded-lg text-xs font-bold transition-all',
                        mode === 'audio' ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      )}
                    >
                      Audio Upload
                    </button>
                  )}
                  {canText && (
                    <button
                      type="button"
                      onClick={() => setMode('text')}
                      className={cn(
                        'px-6 py-2 rounded-lg text-xs font-bold transition-all',
                        mode === 'text' ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      )}
                    >
                      Text Input
                    </button>
                  )}
                </div>
              )}

              {mode === 'audio' ? (
                <div
                  className={cn(
                    "relative group border-2 border-dashed rounded-2xl p-10 transition-all flex flex-col items-center justify-center gap-4 cursor-pointer",
                    file ? "border-teal-200 bg-teal-50/20" : "border-gray-200 bg-gray-50/50 hover:border-teal-300 hover:bg-teal-50/10"
                  )}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onDrop={(e) => {
                    e.preventDefault(); e.stopPropagation()
                    const f = e.dataTransfer.files?.[0]
                    if (f) setFile(f)
                  }}
                  onClick={() => document.getElementById('audio-input')?.click()}
                >
                  <input
                    id="audio-input"
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                  <div className="w-16 h-16 rounded-full bg-white shadow-sm border border-gray-100 flex items-center justify-center text-teal-600 group-hover:scale-110 transition-transform">
                    <CloudUpload size={32} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-gray-900">
                      {file ? file.name : "Drag and drop your audio file here"}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">or click to browse (MP3, WAV, M4A)</p>
                  </div>
                </div>
              ) : (
                <div>
                  <textarea
                    rows={8}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste input text here..."
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 placeholder:text-gray-300 transition-all"
                  />
                </div>
              )}

              {isAdmin && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Pipeline</label>
                    <select
                      value={selectedPipeline}
                      onChange={(e) => setSelectedPipeline(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
                    >
                      <option value="">Auto-detect</option>
                      {pipelines.map((p) => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  {showAction && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Action</label>
                      <select
                        value={action}
                        onChange={(e) => setAction(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
                      >
                        <option value="soap">SOAP Note</option>
                        <option value="prescription">Prescription</option>
                      </select>
                    </div>
                  )}
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

                  {/* Raw result fallback (for non-reasoning steps or when reasoning output isn't present) */}
                  {result != null && !reasoningOutput && (
                    <div className="animate-in fade-in duration-500">
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Raw Result</h4>
                      <div className="bg-white border border-gray-100 rounded-xl p-4">
                        <JsonViewer data={result} />
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

                  
                  {reasoningOutput && (
                    <div className="mt-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <ReasoningResultPanel output={reasoningOutput} tokenStream="" />
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

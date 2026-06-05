import { useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/cn'

interface Props {
  pipelineName: string
  pipelineId?: string
  inputType: string  // 'text' | 'audio'
}

const BASE_URL = 'http://localhost:8000'

function buildCurlSnippet(inputType: string, pipelineId: string): string {
  if (inputType === 'audio') {
    return [
      `curl -X POST ${BASE_URL}/api/v1/process/audio \\`,
      `  -H "Authorization: Bearer <your_token>" \\`,
      `  -F "file=@/path/to/audio.wav" \\`,
      `  -F "pipeline_id=${pipelineId}"`,
    ].join('\n')
  }

  return [
    `curl -X POST ${BASE_URL}/api/v1/process/text \\`,
    `  -H "Authorization: Bearer <your_token>" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "text": "A new influenza variant with R0 2.5 detected in transit hubs of a city of 5 million...",`,
    `    "pipeline_id": "${pipelineId}"`,
    `  }'`,
  ].join('\n')
}

function buildRequestBody(inputType: string, pipelineId: string): string {
  if (inputType === 'audio') {
    return [
      '# Multipart form — no JSON body',
      'file        = <binary audio file>   # WAV, MP3, FLAC, AAC, M4A, OGG',
      `pipeline_id = ${pipelineId}`,
    ].join('\n')
  }

  return JSON.stringify(
    {
      text: 'A new influenza variant with R0 2.5 detected in transit hubs of a city of 5 million...',
      pipeline_id: pipelineId,
    },
    null,
    2,
  )
}

const _EPIDEMIC_RESULT = {
  equilibrium_policy: 'Reduce transit capacity to 30% with mandatory free masking at all entry gates. Close schools for 14 days. Keep essential supply chains open. Re-evaluate at day 10.',
  npi_measures: [
    'Transit capacity reduced to 30% (not full closure — economic agent veto)',
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
    'Free masks at transit gates (compliance agent requirement — else <40% adherence)',
    'Daily public briefings from health authority',
    'Economic support hotline for affected workers',
  ],
  r0_projection: 0.87,
  confidence: 0.81,
  conflicts: [
    { field: 'transit_policy', winner: 'EconomicImpactAgent', rationale: 'Full 21-day closure triggers food desert supply collapse outweighing marginal R0 gain' },
    { field: 'mask_mandate', winner: 'PublicComplianceAgent', rationale: 'Free mask provision is non-negotiable for >70% compliance threshold' },
  ],
}

function buildResponseExample(pipelineName: string, pipelineId: string): string {
  const jobId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  const result = _EPIDEMIC_RESULT

  const initial = {
    job_id: jobId,
    status: 'in_progress',
    pipeline: pipelineName,
    stream_url: `/api/v1/jobs/${jobId}/stream`,
    poll_url: `/api/v1/jobs/${jobId}`,
  }
  const completed = {
    job_id: jobId,
    status: 'completed',
    pipeline: [pipelineName],
    pipeline_id: pipelineId || null,
    pipeline_name: pipelineName,
    current_step: null,
    result,
    error: null,
    created_at: '2025-01-01T10:00:00Z',
    updated_at: '2025-01-01T10:01:30Z',
  }
  return (
    '// 202 Accepted (immediate)\n' +
    JSON.stringify(initial, null, 2) +
    '\n\n// GET ' + initial.poll_url + ' — when completed\n' +
    JSON.stringify(completed, null, 2)
  )
}

export function PipelineApiPreview({ pipelineName, pipelineId, inputType }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'curl' | 'body' | 'response'>('curl')
  const [copied, setCopied] = useState(false)

  const pid = pipelineId || '<pipeline_uuid>'
  const curlSnippet = buildCurlSnippet(inputType, pid)
  const requestBody = buildRequestBody(inputType, pid)
  const responseExample = buildResponseExample(pipelineName || 'my_pipeline', pid)

  const activeContent = tab === 'curl' ? curlSnippet : tab === 'body' ? requestBody : responseExample

  function handleCopy() {
    navigator.clipboard.writeText(activeContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const endpoint = inputType === 'audio' ? 'POST /api/v1/process/audio' : 'POST /api/v1/process/text'
  const contentType = inputType === 'audio' ? 'multipart/form-data' : 'application/json'

  return (
    <div className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-100/30 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 px-2 py-0.5 rounded">
            {endpoint}
          </span>
          <span className="text-slate-400 font-normal text-xs">{contentType}</span>
          <span className="text-slate-400 font-normal text-xs">→ 202 Accepted</span>
        </span>
        {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>

      {open && (
        <div className="px-5 pb-5">
          {/* Tabs */}
          <div className="flex gap-1 mb-3 border-b border-slate-200 dark:border-slate-800">
            {(['curl', 'body', 'response'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold capitalize border-b-2 -mb-px transition-colors cursor-pointer',
                  tab === t
                    ? 'border-teal-600 text-teal-700 dark:border-teal-500 dark:text-teal-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                {t === 'curl' ? 'cURL' : t === 'body' ? 'Request Body' : 'Response'}
              </button>
            ))}

            <button
              type="button"
              onClick={handleCopy}
              className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-100 rounded transition-colors cursor-pointer"
            >
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {/* Code block */}
          <pre className="text-xs font-mono bg-slate-900 text-slate-100 dark:text-white rounded-lg p-4 overflow-x-auto whitespace-pre leading-relaxed dark:bg-slate-950/80 dark:border dark:border-slate-800">
            {activeContent}
          </pre>

          {/* Auth note */}
          <p className="mt-2.5 text-xs text-slate-400 dark:text-slate-500">
            Use a <span className="font-mono text-slate-600 dark:text-slate-300">Bearer</span> JWT (dashboard login) or{' '}
            <span className="font-mono text-slate-600 dark:text-slate-300">mk_</span> access key.
            Pipeline behavior is fully defined by node config — no <span className="font-mono text-slate-600 dark:text-slate-300">actions</span> needed.
          </p>
        </div>
      )}
    </div>
  )
}

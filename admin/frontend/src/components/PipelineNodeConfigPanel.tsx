import { X, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { AgentNodeData } from '@/components/AgentNode'

interface Props {
  data: AgentNodeData
  configOverrideText: string
  configJsonError: string
  onClose: () => void
  onUpdate: (updates: Partial<AgentNodeData>) => void
  onConfigChange: (text: string) => void
  onDelete: () => void
}

// Agents whose behavior is selected via config_override.action
const AGENTS_WITH_ACTION = new Set(['epidemiologist', 'economist', 'compliance', 'reasoning-agent', 'reasoning_agent'])

const ACTION_OPTIONS = [
  { value: '', label: '— inherit / none —' },
  { value: 'epidemic_response', label: 'Epidemic Response' },
  { value: 'economic_impact', label: 'Economic Impact' },
  { value: 'compliance_analysis', label: 'Compliance Analysis' },
  { value: 'policy_synthesis', label: 'Policy Synthesis' },
]

export function PipelineNodeConfigPanel({
  data,
  configOverrideText,
  configJsonError,
  onClose,
  onUpdate,
  onConfigChange,
  onDelete,
}: Props) {
  // Parse current config to drive structured fields
  let parsedConfig: Record<string, unknown> = {}
  try { parsedConfig = JSON.parse(configOverrideText || '{}') } catch { /* ignore */ }
  const currentAction = typeof parsedConfig.action === 'string' ? parsedConfig.action : ''
  const showActionField = AGENTS_WITH_ACTION.has(data.agentName)

  function setAction(action: string) {
    const next = { ...parsedConfig }
    if (action) next.action = action
    else delete next.action
    onConfigChange(JSON.stringify(next, null, 2))
  }

  return (
    <div className="w-72 shrink-0 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-start justify-between">
        <div className="flex-1 min-w-0 mr-2">
          <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Node Config</p>
          <p className="text-sm font-bold text-[var(--color-text-main)] truncate mt-0.5">{data.agentName}</p>
        </div>
        <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] mt-0.5">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">Node Key</label>
          <input
            value={data.nodeKey}
            onChange={e => onUpdate({ nodeKey: e.target.value })}
            className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Unique ID within pipeline</p>
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">Max Retries</label>
          <input
            type="number" min={0} max={10}
            value={data.maxRetries}
            onChange={e => onUpdate({ maxRetries: Number(e.target.value) })}
            className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">On Failure</label>
          <select
            value={data.onFailure}
            onChange={e => onUpdate({ onFailure: e.target.value })}
            className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          >
            <option value="fail_job">Fail Job</option>
            <option value="skip">Skip Step</option>
            <option value="retry">Retry Only</option>
          </select>
        </div>

        {showActionField && (
          <div>
            <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">Action</label>
            <select
              value={currentAction}
              onChange={e => setAction(e.target.value)}
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
            >
              {ACTION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Drives prompt template selection for this agent</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">
            Config Override <span className="font-normal text-[var(--color-text-muted)]">(JSON)</span>
          </label>
          <textarea
            value={configOverrideText}
            onChange={e => onConfigChange(e.target.value)}
            rows={7}
            spellCheck={false}
            className={cn(
              'w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 resize-none',
              configJsonError ? 'border-red-300 focus:ring-red-400' : 'border-[var(--color-border)] focus:ring-teal-500/30 focus:border-teal-500 bg-[var(--color-bg)] text-[var(--color-text-main)]',
            )}
          />
          {configJsonError && <p className="text-[10px] text-red-500 mt-1">{configJsonError}</p>}
        </div>

        <div className="bg-[var(--color-bg)] rounded-lg p-3 space-y-2">
          <p className="text-[9px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Topics (read-only)</p>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-[var(--color-text-muted)] w-6 font-bold">IN</span>
            <span className="text-[10px] font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full truncate flex-1 min-w-0">
              {data.inputTopic}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-[var(--color-text-muted)] w-6 font-bold">OUT</span>
            <span className="text-[10px] font-mono text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full truncate flex-1 min-w-0">
              {data.outputTopic}
            </span>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-[var(--color-border)]">
        <button
          onClick={onDelete}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <Trash2 size={14} /> Remove Node
        </button>
      </div>
    </div>
  )
}

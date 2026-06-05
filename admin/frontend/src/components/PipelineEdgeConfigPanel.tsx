import { X, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export type EdgeData = {
  edgeType: 'sequential' | 'parallel_fanout' | 'merger_input' | 'cyclic_feedback' | 'agent_routed'
  waitForGroup: string
  isOptional: boolean
  // cyclic_feedback
  maxIterations: number
  breakField: string
  breakValue: string
  // agent_routed
  candidateAgents: string[]
}

interface Props {
  data: EdgeData
  onClose: () => void
  onUpdate: (updates: Partial<EdgeData>) => void
  onDelete: () => void
}

const DESCRIPTIONS: Record<EdgeData['edgeType'], string> = {
  sequential: 'Fire target after source completes.',
  parallel_fanout: 'Fire all downstream targets simultaneously.',
  merger_input: 'Target fires only when all edges in the group arrive.',
  cyclic_feedback: 'Loop back to source node until break condition or max iterations.',
  agent_routed: 'LLM DecisionAgent picks the next agent at runtime.',
}

export function PipelineEdgeConfigPanel({ data, onClose, onUpdate, onDelete }: Props) {
  return (
    <div className="w-72 shrink-0 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Edge Config</p>
          <p className="text-sm font-bold text-[var(--color-text-main)] mt-0.5">Connection</p>
        </div>
        <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] mt-0.5">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">Edge Type</label>
          <select
            value={data.edgeType}
            onChange={e => onUpdate({ edgeType: e.target.value as EdgeData['edgeType'] })}
            className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
          >
            <option value="sequential">Sequential</option>
            <option value="parallel_fanout">Parallel Fan-out</option>
            <option value="merger_input">Merger Input (Fan-in)</option>
            <option value="cyclic_feedback">Cyclic Feedback (Loop)</option>
            <option value="agent_routed">Agent-Routed (Dynamic)</option>
          </select>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{DESCRIPTIONS[data.edgeType]}</p>
        </div>

        {data.edgeType === 'merger_input' && (
          <div>
            <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">
              Wait-for Group <span className="text-red-400">*</span>
            </label>
            <input
              value={data.waitForGroup}
              onChange={e => onUpdate({ waitForGroup: e.target.value })}
              placeholder="e.g. phase_g_fanin"
              className={cn(
                'w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500',
                !data.waitForGroup ? 'border-red-300' : 'border-[var(--color-border)]',
              )}
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              All <code>merger_input</code> edges with same key must arrive before merger fires.
            </p>
          </div>
        )}

        {data.edgeType === 'cyclic_feedback' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">Max Iterations</label>
              <input
                type="number"
                min={1}
                max={10}
                value={data.maxIterations ?? 3}
                onChange={e => onUpdate({ maxIterations: Number(e.target.value) })}
                className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">Break Field <span className="text-slate-400 font-normal">(optional)</span></label>
              <input
                type="text"
                placeholder="e.g. done"
                value={data.breakField ?? ''}
                onChange={e => onUpdate({ breakField: e.target.value })}
                className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm font-mono bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
              />
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Agent output field checked for early exit.</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">Break Value</label>
              <input
                type="text"
                placeholder="e.g. true"
                value={data.breakValue ?? ''}
                onChange={e => onUpdate({ breakValue: e.target.value })}
                className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm font-mono bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
              />
            </div>
          </div>
        )}

        {data.edgeType === 'agent_routed' && (
          <div>
            <label className="block text-xs font-bold text-[var(--color-text-muted)] mb-1.5">Candidate Agents <span className="text-slate-400 font-normal">(comma-separated)</span></label>
            <input
              type="text"
              placeholder="AgentA, AgentB, AgentC"
              value={(data.candidateAgents ?? []).join(', ')}
              onChange={e => onUpdate({
                candidateAgents: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              })}
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm font-mono bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Router may only pick from this list. Leave empty for no guardrail.</p>
          </div>
        )}

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-xs font-bold text-[var(--color-text-muted)]">Optional</p>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">Merger proceeds if this edge times out.</p>
          </div>
          <button
            type="button"
            onClick={() => onUpdate({ isOptional: !data.isOptional })}
            className={cn(
              'relative w-10 h-6 rounded-full transition-colors shrink-0',
              data.isOptional ? 'app-toggle-active' : 'app-toggle-inactive',
            )}
          >
            <span className={cn(
              'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform',
              data.isOptional ? 'left-5' : 'left-1',
            )} />
          </button>
        </div>

        <div className={cn(
          'rounded-lg px-3 py-2 text-[10px] font-mono space-y-0.5',
          data.edgeType === 'sequential' ? 'bg-green-50 text-green-800' :
          data.edgeType === 'parallel_fanout' ? 'bg-amber-50 text-amber-800' :
          data.edgeType === 'cyclic_feedback' ? 'bg-sky-50 text-sky-800' :
          data.edgeType === 'agent_routed' ? 'bg-violet-50 text-violet-800' :
          'bg-purple-50 text-purple-800',
        )}>
          <p className="font-bold">edge_type: {data.edgeType}</p>
          {data.edgeType === 'merger_input' && (
            <p>wait_for_group: {data.waitForGroup || '<unset>'}</p>
          )}
          {data.edgeType === 'cyclic_feedback' && (
            <>
              <p>max_iterations: {data.maxIterations ?? 3}</p>
              {data.breakField && <p>break: {data.breakField} == "{data.breakValue}"</p>}
            </>
          )}
          {data.edgeType === 'agent_routed' && (
            <p>candidates: [{(data.candidateAgents ?? []).join(', ') || 'any'}]</p>
          )}
          <p>is_optional: {String(data.isOptional)}</p>
        </div>
      </div>

      <div className="p-4 border-t border-[var(--color-border)]">
        <button
          onClick={onDelete}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <Trash2 size={14} /> Remove Edge
        </button>
      </div>
    </div>
  )
}

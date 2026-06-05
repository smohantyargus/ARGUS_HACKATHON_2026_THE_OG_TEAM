import { Cpu, Sparkles, Merge } from 'lucide-react'
import type { AgentInfo } from '@/types/pipeline'

interface Props {
  agents: AgentInfo[]
  paletteSearch: string
  onSearchChange: (v: string) => void
  onDragStart: (e: React.DragEvent, agent: AgentInfo) => void
}

export function PipelinePalette({ agents, paletteSearch, onSearchChange, onDragStart }: Props) {
  const filtered = paletteSearch.trim()
    ? agents.filter(a => a.name.toLowerCase().includes(paletteSearch.toLowerCase()))
    : agents

  return (
    <div className="w-52 shrink-0 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-[var(--color-border)] space-y-2">
        <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Agents</p>
        <input
          type="text"
          value={paletteSearch}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search agents…"
          className="w-full text-xs border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 bg-[var(--color-bg)] text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filtered.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] p-2 text-center">
            {agents.length === 0 ? 'No agents registered' : 'No matches'}
          </p>
        ) : (
          filtered.map(agent => {
            const typeLabel =
              agent.agent_type === 'generic_llm' ? 'LLM' :
              agent.agent_type === 'output_merger' ? 'MERGER' : null
            const typeCls =
              agent.agent_type === 'generic_llm' ? 'bg-purple-100 text-purple-700' :
              agent.agent_type === 'output_merger' ? 'bg-amber-100 text-amber-700' : ''
            const iconCls =
              agent.agent_type === 'generic_llm' ? 'text-purple-500' :
              agent.agent_type === 'output_merger' ? 'text-amber-500' : 'text-teal-600'
            const Icon =
              agent.agent_type === 'generic_llm' ? Sparkles :
              agent.agent_type === 'output_merger' ? Merge : Cpu
            return (
              <div
                key={agent.id}
                draggable
                onDragStart={e => onDragStart(e, agent)}
                className="bg-[var(--color-bg)] hover:bg-teal-50 border border-[var(--color-border)] hover:border-teal-200 rounded-lg p-2.5 cursor-grab active:cursor-grabbing transition-colors shadow-xs"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon size={13} className={`${iconCls} shrink-0`} />
                  <span className="text-xs font-bold text-[var(--color-text-main)] truncate flex-1">{agent.name}</span>
                  {typeLabel && (
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${typeCls}`}>
                      {typeLabel}
                    </span>
                  )}
                </div>
                <div className="space-y-0.5 pl-[22px]">
                  {agent.agent_type === 'output_merger' ? (
                    <>
                      <p className="text-[9px] font-mono text-blue-600 truncate">↓ {Object.keys(agent.input_topic_map).length} input topics</p>
                      <p className="text-[9px] font-mono text-teal-600 truncate">↑ {agent.output_topic}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[9px] font-mono text-blue-600 truncate">↓ {agent.input_topic}</p>
                      <p className="text-[9px] font-mono text-teal-600 truncate">↑ {agent.output_topic}</p>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

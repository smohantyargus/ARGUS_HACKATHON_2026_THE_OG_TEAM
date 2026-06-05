import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Cpu, Merge, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'

export type AgentNodeData = {
  agentId: number | string
  agentName: string
  agentType?: 'registry' | 'generic_llm' | 'output_merger'
  nodeKey: string
  inputTopic: string
  outputTopic: string
  maxRetries: number
  onFailure: string
  configOverride: Record<string, unknown>
}

const TYPE_STYLES = {
  registry:       { icon: Cpu,      border: 'border-teal-200', iconBg: 'bg-teal-50',  iconColor: 'text-teal-600',  label: null },
  generic_llm:    { icon: Sparkles, border: 'border-purple-200', iconBg: 'bg-purple-50',  iconColor: 'text-purple-600',  label: 'LLM' },
  output_merger:  { icon: Merge,    border: 'border-amber-200',  iconBg: 'bg-amber-50',   iconColor: 'text-amber-600',   label: 'MERGER' },
} as const

export function AgentNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const typeKey = data.agentType ?? 'registry'
  const { icon: Icon, border, iconBg, iconColor, label } = TYPE_STYLES[typeKey] ?? TYPE_STYLES.registry

  return (
    <div
      className={cn(
        'bg-white rounded-xl border-2 shadow-sm w-60 transition-all cursor-default select-none',
        selected
          ? 'border-teal-500 shadow-lg shadow-teal-100'
          : cn(border, 'hover:border-slate-300'),
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#64748b', width: 12, height: 12, border: '2px solid white' }}
      />

      <div className="px-3 pt-3 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', iconBg)}>
            <Icon size={15} className={iconColor} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-bold text-slate-800 truncate">{data.agentName}</span>
              {label && (
                <span className={cn(
                  'text-[8px] font-bold px-1.5 py-0.5 rounded-full shrink-0',
                  typeKey === 'generic_llm' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700',
                )}>{label}</span>
              )}
            </div>
            <div className="text-[11px] text-slate-400 font-mono truncate">{data.nodeKey}</div>
          </div>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-400 uppercase font-bold w-5 shrink-0">IN</span>
          <span className="text-[10px] font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full truncate flex-1 min-w-0">
            {data.inputTopic}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-400 uppercase font-bold w-5 shrink-0">OUT</span>
          <span className="text-[10px] font-mono text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full truncate flex-1 min-w-0">
            {data.outputTopic}
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#64748b', width: 12, height: 12, border: '2px solid white' }}
      />
    </div>
  )
}

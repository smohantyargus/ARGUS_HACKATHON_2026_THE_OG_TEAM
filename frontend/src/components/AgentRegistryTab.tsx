import { ArrowRight } from 'lucide-react'

interface Agent {
  id: number; name: string; input_topic: string; output_topic: string
  health_url?: string; version?: string; is_active: boolean; registered_at: string
}

interface Props {
  agents: Agent[]
}

export function AgentRegistryTab({ agents }: Props) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {agents.map(a => (
                <div key={a.id} className="bg-[var(--color-surface)] rounded-xl p-5 border border-[var(--color-border)] border-l-[4px] border-l-teal-600 shadow-sm flex flex-col transition-all duration-300 hover:shadow-md relative z-0">

                    
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                            
                            <div className="flex flex-col">
                                <h3 className="text-[var(--color-text-main)] font-bold text-[15px] leading-tight tracking-tight">{a.name}</h3>
                                <span className="text-[var(--color-text-muted)] font-medium text-[11px] mt-0.5">{a.version ? (a.version.startsWith('v') ? a.version : `v${a.version}`) : 'v1.0.0'}</span>
                            </div>
                        </div>

                        
                        <div className="flex items-center pt-1 shrink-0">
                            {a.is_active ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 active-status-pill border rounded-full text-[10px] font-bold tracking-wide uppercase select-none">
                                    <span className="w-1.5 h-1.5 rounded-full active-status-dot" />
                                    Active
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 inactive-status-pill border rounded-full text-[10px] font-bold tracking-wide uppercase select-none">
                                    <span className="w-1.5 h-1.5 rounded-full inactive-status-dot" />
                                    Inactive
                                </span>
                            )}
                        </div>
                    </div>

                    
                    <div className="mb-4 flex-1 mt-1">
                        <h4 className="text-[var(--color-text-muted)] text-[10px] font-bold mb-2 uppercase tracking-wide">Kafka Topic</h4>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <div className="px-2 py-0.5 bg-teal-50 text-teal-700 font-mono text-[10px] font-bold tracking-tight rounded-md border border-teal-100 shadow-sm flex items-center">
                                {a.input_topic || 'none'}
                            </div>
                            <ArrowRight className="text-teal-700/60" size={12} />
                            <div className="px-2 py-0.5 bg-teal-50 text-teal-700 font-mono text-[10px] font-bold tracking-tight rounded-md border border-teal-100 shadow-sm flex items-center">
                                {a.output_topic || 'none'}
                            </div>
                        </div>
                    </div>

                    <div className="w-full h-px bg-[var(--color-border)] mb-3 mt-auto"></div>

                    
                    <div className="flex justify-between items-center text-[var(--color-text-muted)]">
                        <p className="text-[11px] font-medium">
                            Registered: {new Date(a.registered_at).toLocaleDateString()}
                        </p>
                    </div>
                </div>
            ))}
        </div>
    )
}

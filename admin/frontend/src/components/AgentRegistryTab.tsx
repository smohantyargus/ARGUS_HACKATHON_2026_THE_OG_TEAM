import { ArrowRight, Server } from 'lucide-react'

interface Agent {
  id: number; name: string; input_topic: string; output_topic: string
  health_url?: string; version?: string; is_active: boolean; registered_at: string
}

interface Props {
  agents: Agent[]
}

export function AgentRegistryTab({ agents }: Props) {
  if (agents.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-12 text-center">
        <Server size={32} className="mx-auto mb-3 text-white/15" />
        <p className="text-[var(--color-text-muted)] font-medium text-sm">No agents registered yet.</p>
        <p className="text-[var(--color-text-muted)] text-xs mt-1 opacity-60">Agents appear here once they connect to the platform.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {agents.map(a => (
        <div
          key={a.id}
          className="group bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] flex flex-col transition-all duration-200 hover:border-cyan-500/20 hover:shadow-[0_0_24px_rgba(34,211,238,0.06)] overflow-hidden"
        >
          {/* Card header */}
          <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-cyan-950/60 border border-cyan-500/15 flex items-center justify-center shrink-0 group-hover:border-cyan-500/30 transition-colors">
                <Server size={16} className="text-cyan-400/70 group-hover:text-cyan-400 transition-colors" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[var(--color-text-main)] font-bold text-[13px] leading-tight truncate">{a.name}</h3>
                <span className="text-[var(--color-text-muted)] font-mono text-[10px] opacity-60">
                  {a.version ? (a.version.startsWith('v') ? a.version : `v${a.version}`) : 'v1.0.0'}
                </span>
              </div>
            </div>
            {a.is_active ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-emerald-950/50 border border-emerald-900/50 rounded-full text-[9px] font-bold tracking-widest uppercase text-emerald-400 shrink-0 font-mono">
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-900/60 border border-slate-800/60 rounded-full text-[9px] font-bold tracking-widest uppercase text-slate-500 shrink-0 font-mono">
                <span className="w-1 h-1 rounded-full bg-slate-600" />
                Offline
              </span>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-[var(--color-border)] mx-5" />

          {/* Topic flow */}
          <div className="px-5 py-4 flex-1">
            <p className="text-[9px] font-bold text-white/20 uppercase tracking-widest mb-2.5 font-mono">Kafka Pipeline</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-2 py-1 bg-cyan-950/30 text-cyan-400/80 font-mono text-[10px] font-medium rounded-md border border-cyan-500/15 truncate max-w-[120px]" title={a.input_topic}>
                {a.input_topic || 'none'}
              </span>
              <ArrowRight className="text-white/15 shrink-0" size={11} />
              <span className="px-2 py-1 bg-violet-950/30 text-violet-400/80 font-mono text-[10px] font-medium rounded-md border border-violet-500/15 truncate max-w-[120px]" title={a.output_topic}>
                {a.output_topic || 'none'}
              </span>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 pb-4 flex items-center justify-between">
            <span className="text-[10px] text-white/20 font-mono">
              Joined {new Date(a.registered_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

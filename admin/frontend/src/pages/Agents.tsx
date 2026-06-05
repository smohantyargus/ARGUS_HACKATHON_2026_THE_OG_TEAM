import { useEffect, useState } from 'react'
import { configApi } from '@/lib/api'
import PageHeader from '@/components/PageHeader'
import { AgentRegistryTab } from '@/components/AgentRegistryTab'
import { AgentGenericTab, type AgentDef, type LLMInstance } from '@/components/AgentGenericTab'
import { AgentMergerTab, type ResponseMergerDef } from '@/components/AgentMergerTab'
import { Server, Bot, GitMerge } from 'lucide-react'

interface Agent {
  id: number; name: string; input_topic: string; output_topic: string
  health_url?: string; version?: string; is_active: boolean; registered_at: string
}

export default function Agents() {
  const [tab, setTab] = useState<'registry' | 'definitions' | 'mergers'>('registry')
  const [agents, setAgents] = useState<Agent[]>([])
  const [defs, setDefs] = useState<AgentDef[]>([])
  const [llms, setLLMs] = useState<LLMInstance[]>([])
  const [mergers, setMergers] = useState<ResponseMergerDef[]>([])

  async function loadRegistry() {
    const res = await configApi.get('/internal/agents/')
    setAgents(res.data)
  }

  async function loadDefs() {
    const [defsRes, llmsRes] = await Promise.all([
      configApi.get('/internal/agent-definitions/'),
      configApi.get('/internal/llm/instances'),
    ])
    setDefs(defsRes.data)
    setLLMs(llmsRes.data.filter((l: LLMInstance) => l.is_active))
  }

  async function loadMergers() {
    const res = await configApi.get('/internal/response-mergers/')
    setMergers(res.data)
  }

  useEffect(() => {
    loadRegistry()
    loadDefs()
    loadMergers()
  }, [])

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out">
      <PageHeader title="Agent Management" />
      
      <div className="flex gap-1 mb-8">
        {(['registry', 'definitions', 'mergers'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-200 ${tab === t
                ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-500/20 shadow-[0_0_12px_rgba(34,211,238,0.08)]'
                : 'text-white/40 hover:text-white/75 hover:bg-white/[0.04] border border-transparent'
              }`}
          >
            {t === 'registry' && <Server size={14} className={tab === t ? 'text-cyan-400' : 'opacity-50'} />}
            {t === 'definitions' && <Bot size={14} className={tab === t ? 'text-cyan-400' : 'opacity-50'} />}
            {t === 'mergers' && <GitMerge size={14} className={tab === t ? 'text-cyan-400' : 'opacity-50'} />}
            {t === 'registry' ? 'Registry' : t === 'definitions' ? 'Generic LLM Agents' : 'Output Mergers'}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {tab === 'registry' && <AgentRegistryTab agents={agents} />}
        {tab === 'definitions' && <AgentGenericTab defs={defs} llms={llms} onRefresh={loadDefs} />}
        {tab === 'mergers' && <AgentMergerTab mergers={mergers} onRefresh={loadMergers} />}
      </div>
    </div>
  )
}

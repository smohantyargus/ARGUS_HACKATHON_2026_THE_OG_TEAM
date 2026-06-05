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
      
      <div className="flex gap-10 mb-8 border-b border-[var(--color-border)]">
        {(['registry', 'definitions', 'mergers'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-3.5 px-2 flex items-center gap-2.5 text-[15px] font-semibold transition-all duration-300 relative ${tab === t
                ? 'text-teal-700'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]'
              }`}
          >
            {t === 'registry' && <Server size={18} className={tab === t ? 'text-teal-600' : 'text-[var(--color-text-muted)]'} />}
            {t === 'definitions' && <Bot size={18} className={tab === t ? 'text-teal-600' : 'text-[var(--color-text-muted)]'} />}
            {t === 'mergers' && <GitMerge size={18} className={tab === t ? 'text-teal-600' : 'text-[var(--color-text-muted)]'} />}

            {t === 'registry' ? 'Registry' : t === 'definitions' ? 'Generic LLM Agents' : 'Output Mergers'}

            
            {tab === t && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-teal-600 rounded-t-full shadow-[0_-2px_8px_rgba(13,148,136,0.3)]"></div>
            )}
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

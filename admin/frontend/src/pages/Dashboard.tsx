import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { orchestratorApi, configApi } from '@/lib/api'
import StatusBadge from '@/components/StatusBadge'
import PageHeader from '@/components/PageHeader'
import {
  Cpu,
  Activity,
  ExternalLink,
  ClipboardList,
  GitBranch,
  Plus,
  RadioTower,
  RefreshCw
} from 'lucide-react'

interface Job {
  job_id: string
  status: string
  pipeline: string[]
  pipeline_id?: string
  pipeline_name?: string
  current_step: string | null
  created_at: string
  updated_at: string
  started_at?: string
  failed_jobs_count?: number
}

interface Stats {
  totalJobsCount: number
  agentCount: number
  pipelineCount: number
  failedJobsCount: number
  pipelines: any[]
}

interface AgentLagItem {
  agent_name: string
  topic: string
  group_id: string
  lag: number | null
  end_offset: number | null
  committed_offset: number | null
  partitions: number
  status: string
}

interface AgentLagSnapshot {
  items: AgentLagItem[]
  updated_at: string | null
  error: string | null
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    totalJobsCount: 0,
    agentCount: 0,
    pipelineCount: 0,
    failedJobsCount: 0,
    pipelines: []
  })
  const [recentJobs, setRecentJobs] = useState<any[]>([])
  const [agentLag, setAgentLag] = useState<AgentLagSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        const [jobsRes, agentsRes, pipelinesRes, lagRes] = await Promise.allSettled([
          orchestratorApi.get('/v1/jobs/?limit=5&offset=0'),
          configApi.get('/internal/agents/'),
          configApi.get('/pipelines/graph/'),
          orchestratorApi.get('/v1/agent-lag/'),
        ])

        if (jobsRes.status === 'fulfilled') {
          const { items, total, failed_count } = jobsRes.value.data
          setRecentJobs(items)
          setStats({
            totalJobsCount: total,
            failedJobsCount: failed_count,
            agentCount: agentsRes.status === 'fulfilled' ? agentsRes.value.data.length : 0,
            pipelineCount: pipelinesRes.status === 'fulfilled' ? pipelinesRes.value.data.length : 0,
            pipelines: pipelinesRes.status === 'fulfilled' ? pipelinesRes.value.data : []
          })
        }

        if (lagRes.status === 'fulfilled') {
          setAgentLag(lagRes.value.data)
        }
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
          <p className="text-[var(--color-text-muted)] font-mono text-sm animate-pulse">Initializing Dashboard...</p>
        </div>
      </div>
    )
  }

  const formatDuration = (seconds?: number | string) => {
    if (!seconds) return '--'
    const s = typeof seconds === 'string' ? parseFloat(seconds) : seconds
    const mins = Math.floor(s / 60)
    const secs = Math.floor(s % 60)
    return `${mins}m ${secs}s`
  }

  const formatTime = (isoString?: string) => {
    if (!isoString) return { date: '--', time: '--' }
    const date = new Date(isoString)
    return {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  }

  const totalLag = agentLag?.items.reduce((sum, item) => sum + (item.lag ?? 0), 0) ?? 0
  const lagStatus = totalLag > 50 ? 'Backlogged' : totalLag > 10 ? 'Building' : 'Healthy'
  const lagTone = totalLag > 50
    ? 'text-red-400 bg-red-950/40 border-red-900/50'
    : totalLag > 10
      ? 'text-amber-400 bg-amber-950/40 border-amber-900/50'
      : 'text-emerald-400 bg-emerald-950/40 border-emerald-900/50'
  const lagUpdated = agentLag?.updated_at ? formatTime(agentLag.updated_at) : null

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Dashboard" />

      {/* System status bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
        <span className="text-[10px] font-bold text-cyan-400/70 uppercase tracking-widest font-mono">Civis Mission Control</span>
        <span className="text-[var(--color-border)] mx-1">|</span>
        <span className="text-[10px] text-[var(--color-text-muted)] font-mono">Multi-Agent Epidemic Policy Simulator</span>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-[10px] font-mono text-emerald-400/70">{stats.agentCount} agents active</span>
          <span className="text-[10px] font-mono text-violet-400/70">{stats.pipelineCount} pipelines loaded</span>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Jobs */}
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] border-l-2 border-l-cyan-500 p-5 flex flex-col gap-3 group hover:border-l-cyan-400 hover:shadow-[0_0_20px_rgba(34,211,238,0.06)] transition-all">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest font-mono">Total Jobs</span>
              <h3 className="text-4xl font-black text-cyan-400 font-mono">{stats.totalJobsCount}</h3>
            </div>
            <div className="p-2.5 bg-cyan-950/50 rounded-xl text-cyan-400">
              <ClipboardList size={22} />
            </div>
          </div>
          <Link to="/jobs" className="text-[10px] font-bold text-cyan-400/50 hover:text-cyan-400 flex items-center gap-1 transition-colors">
            Track all jobs <ExternalLink size={10} />
          </Link>
        </div>

        {/* Active Agents */}
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] border-l-2 border-l-emerald-500 p-5 flex flex-col gap-3 group hover:border-l-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.06)] transition-all">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest font-mono">Active Agents</span>
              <h3 className="text-4xl font-black text-emerald-400 font-mono">{stats.agentCount}</h3>
            </div>
            <div className="p-2.5 bg-emerald-950/50 rounded-xl text-emerald-400">
              <Cpu size={22} />
            </div>
          </div>
          <Link to="/agents" className="text-[10px] font-bold text-emerald-400/50 hover:text-emerald-400 flex items-center gap-1 transition-colors">
            Agents available <ExternalLink size={10} />
          </Link>
        </div>

        {/* Pipelines */}
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] border-l-2 border-l-violet-500 p-5 flex flex-col gap-3 group hover:border-l-violet-400 hover:shadow-[0_0_20px_rgba(139,92,246,0.06)] transition-all">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest font-mono">Pipelines</span>
              <h3 className="text-4xl font-black text-violet-400 font-mono">{stats.pipelineCount}</h3>
            </div>
            <div className="p-2.5 bg-violet-950/50 rounded-xl text-violet-400">
              <GitBranch size={22} />
            </div>
          </div>
          <Link to="/pipelines" className="text-[10px] font-bold text-violet-400/50 hover:text-violet-400 flex items-center gap-1 transition-colors">
            Manage Pipelines <ExternalLink size={10} />
          </Link>
        </div>

        {/* Failed Jobs */}
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] border-l-2 border-l-red-500 p-5 flex flex-col gap-3 group hover:border-l-red-400 hover:shadow-[0_0_20px_rgba(239,68,68,0.06)] transition-all">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest font-mono">Failed Jobs</span>
              <h3 className="text-4xl font-black text-red-400 font-mono">{stats.failedJobsCount}</h3>
            </div>
            <div className="p-2.5 bg-red-950/50 rounded-xl text-red-400">
              <Activity size={22} />
            </div>
          </div>
          <Link to="/failed-jobs" className="text-[10px] font-bold text-red-400/50 hover:text-red-400 flex items-center gap-1 transition-colors">
            Review job issues <ExternalLink size={10} />
          </Link>
        </div>
      </div>

      {/* Kafka Lag Section */}
      {agentLag && (
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
          <div className="p-5 border-b border-[var(--color-border)] flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-sky-950/50 rounded-xl flex items-center justify-center text-sky-400">
                <RadioTower size={18} />
              </div>
              <div>
                <h3 className="font-bold text-[var(--color-text-main)] font-mono">Kafka Consumer Lag</h3>
                <p className="text-xs text-[var(--color-text-muted)]">Agent backlog by consumer group and input topic</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className={`px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-widest font-mono ${lagTone}`}>
                {lagStatus}
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)]">
                <span className="text-[10px] font-black text-[var(--color-text-muted)] uppercase tracking-widest mr-2 font-mono">Total Lag</span>
                <span className="font-mono text-lg font-black text-[var(--color-text-main)]">{totalLag}</span>
              </div>
              {lagUpdated && (
                <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-text-muted)]">
                  <RefreshCw size={13} />
                  <span className="font-mono">{lagUpdated.time}</span>
                </div>
              )}
            </div>
          </div>

          {agentLag.error ? (
            <div className="p-5 text-sm font-semibold text-red-400 bg-red-950/20">
              {agentLag.error}
            </div>
          ) : agentLag.items.length === 0 ? (
            <div className="p-10 text-center text-sm font-semibold text-[var(--color-text-muted)]">
              No consumer groups discovered yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-[10px] uppercase tracking-widest font-black font-mono">
                    <th className="px-6 py-3">Agent</th>
                    <th className="px-6 py-3">Topic</th>
                    <th className="px-6 py-3">Group</th>
                    <th className="px-6 py-3 text-right">Lag</th>
                    <th className="px-6 py-3 text-right">Partitions</th>
                    <th className="px-6 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)] text-[var(--color-text-main)]">
                  {agentLag.items.map((item) => {
                    const lag = item.lag ?? 0
                    const rowTone = item.status !== 'ok'
                      ? 'text-[var(--color-text-muted)]'
                      : lag > 50
                        ? 'text-red-400'
                        : lag > 10
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                    const rowBg = item.status !== 'ok'
                      ? ''
                      : lag > 50
                        ? 'bg-red-950/10'
                        : lag > 10
                          ? 'bg-amber-950/10'
                          : ''
                    const label = item.status === 'ok'
                      ? 'Tracking'
                      : item.status === 'topic_missing'
                        ? 'Topic Missing'
                        : 'No Offset'
                    const pillTone = item.status !== 'ok'
                      ? 'text-slate-400 bg-slate-900/60 border-slate-800/60'
                      : lag > 50
                        ? 'text-red-400 bg-red-950/50 border-red-900/50'
                        : lag > 10
                          ? 'text-amber-400 bg-amber-950/50 border-amber-900/50'
                          : 'text-emerald-400 bg-emerald-950/50 border-emerald-900/50'
                    return (
                      <tr key={`${item.agent_name}:${item.topic}:${item.group_id}`} className={`hover:bg-white/[0.02] transition-colors h-[58px] ${rowBg}`}>
                        <td className="px-6 align-middle">
                          <div className="font-bold text-sm text-[var(--color-text-main)] font-mono">{item.agent_name}</div>
                        </td>
                        <td className="px-6 align-middle">
                          <div className="font-mono text-xs text-[var(--color-text-muted)]">{item.topic}</div>
                        </td>
                        <td className="px-6 align-middle">
                          <div className="font-mono text-xs text-[var(--color-text-muted)]">{item.group_id}</div>
                        </td>
                        <td className="px-6 align-middle text-right">
                          <span className={`font-mono text-lg font-black ${rowTone}`}>
                            {item.lag ?? '--'}
                          </span>
                        </td>
                        <td className="px-6 align-middle text-right">
                          <span className="font-mono text-sm font-bold text-[var(--color-text-muted)]">
                            {item.partitions}
                          </span>
                        </td>
                        <td className="px-6 align-middle text-center">
                          <span className={`inline-flex items-center justify-center min-w-[108px] px-3 py-1 rounded-md border text-[10px] font-black uppercase tracking-widest font-mono ${pillTone}`}>
                            {label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Recent Jobs */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden flex flex-col">
        <div className="p-5 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-950/50 rounded-xl flex items-center justify-center text-emerald-400">
              <Activity size={18} className="animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--color-text-main)] font-mono">Recent Jobs</h3>
              <p className="text-xs text-[var(--color-text-muted)]">Latest job executions across all pipelines</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/jobs/new"
              className="px-3 py-1.5 bg-emerald-950/50 text-emerald-400 rounded-lg text-xs font-bold hover:bg-emerald-950/80 transition-all flex items-center gap-1.5 border border-emerald-900/40"
            >
              <Plus size={14} /> New Analysis
            </Link>
            <Link
              to="/jobs"
              className="px-3 py-1.5 bg-[var(--color-primary)] text-[var(--color-bg)] rounded-lg text-xs font-bold hover:bg-[var(--color-primary-hover)] transition-all flex items-center gap-1.5"
            >
              View All
            </Link>
          </div>
        </div>

        <div className="overflow-x-auto">
          {recentJobs.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-14 h-14 bg-[var(--color-bg)] rounded-xl flex items-center justify-center mx-auto text-[var(--color-text-muted)] border border-[var(--color-border)]">
                <ClipboardList size={28} />
              </div>
              <p className="text-[var(--color-text-muted)] font-medium font-mono text-sm">No jobs recorded yet.</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-[10px] uppercase tracking-widest font-black font-mono">
                  <th className="px-6 py-3">Job ID</th>
                  <th className="px-6 py-3">Pipeline</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Duration</th>
                  <th className="px-6 py-3 text-center">Created At</th>
                  <th className="px-6 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)] text-[var(--color-text-main)]">
                {recentJobs.map((j: Job) => {
                  const jobTime = formatTime(j.created_at || j.started_at)
                  const pipeline = j.pipeline_id ? stats.pipelines.find(p => p.id === j.pipeline_id || p.pipeline_id === j.pipeline_id) : null
                  const pipelineName = j.pipeline_name || pipeline?.name || pipeline?.pipeline_name || (Array.isArray(j.pipeline) ? j.pipeline.join(' → ') : j.pipeline)
                  return (
                    <tr key={j.job_id as string} className="hover:bg-white/[0.02] transition-colors h-[64px]">
                      <td className="px-6 align-middle">
                        <div className="font-mono text-xs text-[var(--color-text-muted)]">
                          {(j.job_id as string).slice(0, 12)}...
                        </div>
                      </td>
                      <td className="px-6 align-middle">
                        <span className="text-xs font-bold text-[var(--color-text-muted)] font-mono uppercase tracking-tighter truncate max-w-[180px] block" title={pipelineName}>
                          {pipelineName}
                        </span>
                      </td>
                      <td className="px-6 align-middle">
                        <StatusBadge status={j.status as string} />
                      </td>
                      <td className="px-6 align-middle">
                        <span className="text-sm font-mono font-bold text-[var(--color-text-muted)]">
                          {(() => {
                            const isFinished = ['completed', 'failed', 'error'].includes(j.status?.toLowerCase() || '')
                            if (!isFinished) return '--'
                            if (j.created_at && j.updated_at) {
                              const start = new Date(j.created_at).getTime()
                              const end = new Date(j.updated_at).getTime()
                              return formatDuration(Math.max(0, Math.floor((end - start) / 1000)))
                            }
                            return '--'
                          })()}
                        </span>
                      </td>
                      <td className="px-6 align-middle">
                        <div className="flex items-center justify-center font-mono text-xs font-bold text-[var(--color-text-muted)] whitespace-nowrap">
                          {jobTime.date} <span className="text-[var(--color-border)] mx-1.5">·</span> {jobTime.time}
                        </div>
                      </td>
                      <td className="px-6 align-middle">
                        <div className="flex items-center justify-center">
                          <Link
                            to={`/jobs/${j.job_id}`}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-text-muted)] hover:text-cyan-400 hover:bg-cyan-950/40 transition-all border border-transparent hover:border-cyan-900/50"
                            title="View Details"
                          >
                            <ExternalLink size={16} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

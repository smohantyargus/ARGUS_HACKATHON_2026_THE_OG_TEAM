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
          <div className="w-12 h-12 border-4 border-teal-500/20 border-t-teal-500 rounded-full animate-spin" />
          <p className="text-[var(--color-text-muted)] font-medium animate-pulse">Initializing Dashboard...</p>
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
    ? 'text-red-600 bg-red-50 border-red-100'
    : totalLag > 10
      ? 'text-amber-600 bg-amber-50 border-amber-100'
      : 'text-emerald-600 bg-emerald-50 border-emerald-100'
  const lagUpdated = agentLag?.updated_at ? formatTime(agentLag.updated_at) : null

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader title="Dashboard" />
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Jobs */}
        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-6 shadow-sm flex flex-col gap-3 group relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--color-bg)] rounded-full -mr-16 -mt-16 opacity-50 transition-transform group-hover:scale-110 duration-500" />
          <div className="relative flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">Total Jobs</span>
              <h3 className="text-4xl font-bold text-[var(--color-text-main)] font-serif">{stats.totalJobsCount}</h3>
            </div>
            <div className="p-3 bg-[var(--color-bg)] rounded-xl text-[var(--color-text-muted)]">
              <ClipboardList size={24} />
            </div>
          </div>
          <div className="relative flex items-center gap-2 text-[10px] font-bold text-[var(--color-text-muted)] hover:underline">
            <Link to="/jobs" className="flex items-center gap-1">
              Track all jobs <ExternalLink size={10} />
            </Link>
          </div>
        </div>

        {/* Active Agents */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col gap-3 group relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full -mr-16 -mt-16 opacity-50 transition-transform group-hover:scale-110 duration-500" />
          <div className="relative flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">Active Agents</span>
              <h3 className="text-4xl font-bold text-[var(--color-text-main)] font-serif">{stats.agentCount}</h3>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
              <Cpu size={24} />
            </div>
          </div>
          <div className="relative flex items-center gap-2 text-[10px] font-bold text-emerald-600 hover:underline">
            <Link to="/agents" className="flex items-center gap-1">
             Agents available<ExternalLink size={10} />
            </Link>
          </div>
        </div>

        {/* Pipelines */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col gap-3 group relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-teal-50 rounded-full -mr-16 -mt-16 opacity-50 transition-transform group-hover:scale-110 duration-500" />
          <div className="relative flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">Pipelines</span>
              <h3 className="text-4xl font-bold text-[var(--color-text-main)] font-serif">{stats.pipelineCount}</h3>
            </div>
            <div className="p-3 bg-teal-50 rounded-xl text-teal-600">
              <GitBranch size={24} />
            </div>
          </div>
          <div className="relative flex items-center gap-2 text-[10px] font-bold text-teal-600 hover:underline">
            <Link to="/pipelines" className="flex items-center gap-1">
              Manage Pipelines <ExternalLink size={10} />
            </Link>
          </div>
        </div>

        {/* Failed Jobs */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col gap-3 group relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-full -mr-16 -mt-16 opacity-50 transition-transform group-hover:scale-110 duration-500" />
          <div className="relative flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">Failed Jobs</span>
              <h3 className="text-4xl font-bold text-[var(--color-text-main)] font-serif">{stats.failedJobsCount}</h3>
            </div>
            <div className="p-3 bg-red-50 rounded-xl text-red-600">
              <Activity size={24} />
            </div>
          </div>
          <div className="relative flex items-center gap-2 text-[10px] font-bold text-red-500 hover:underline">
            <Link to="/failed-jobs" className="flex items-center gap-1">
              Review job issues<ExternalLink size={10} />
            </Link>
          </div>
        </div>
      </div>

      {/* Kafka Lag Section */}
      {agentLag && (
        <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
          <div className="p-6 border-b border-[var(--color-border)] flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center text-sky-600">
                <RadioTower size={20} />
              </div>
              <div>
                <h3 className="font-bold text-[var(--color-text-main)] text-lg">Kafka Consumer Lag</h3>
                <p className="text-xs text-[var(--color-text-muted)] font-medium">
                  Agent backlog by consumer group and input topic
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className={`px-3 py-2 rounded-xl border text-xs font-black uppercase tracking-widest ${lagTone}`}>
                {lagStatus}
              </div>
              <div className="px-4 py-2 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)]">
                <span className="text-[10px] font-black text-[var(--color-text-muted)] uppercase tracking-widest mr-2">Total Lag</span>
                <span className="font-mono text-lg font-black text-[var(--color-text-main)]">{totalLag}</span>
              </div>
              {lagUpdated && (
                <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-text-muted)]">
                  <RefreshCw size={14} />
                  <span>{lagUpdated.time}</span>
                </div>
              )}
            </div>
          </div>

          {agentLag.error ? (
            <div className="p-6 text-sm font-semibold text-red-600 bg-red-50/60">
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
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-xs uppercase tracking-widest font-black">
                    <th className="px-6 py-4">Agent</th>
                    <th className="px-6 py-4">Topic</th>
                    <th className="px-6 py-4">Group</th>
                    <th className="px-6 py-4 text-right">Lag</th>
                    <th className="px-6 py-4 text-right">Partitions</th>
                    <th className="px-6 py-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)] text-[var(--color-text-main)]">
                  {agentLag.items.map((item) => {
                    const lag = item.lag ?? 0
                    const rowTone = item.status !== 'ok'
                      ? 'bg-[var(--color-bg)] text-[var(--color-text-muted)]'
                      : lag > 50
                        ? 'bg-red-50 text-red-700'
                        : lag > 10
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                    const label = item.status === 'ok'
                      ? 'Tracking'
                      : item.status === 'topic_missing'
                        ? 'Topic Missing'
                        : 'No Offset'
                    return (
                      <tr key={`${item.agent_name}:${item.topic}:${item.group_id}`} className="hover:bg-[var(--color-bg)] transition-colors h-[64px]">
                        <td className="px-6 align-middle">
                          <div className="font-bold text-sm text-[var(--color-text-main)]">{item.agent_name}</div>
                        </td>
                        <td className="px-6 align-middle">
                          <div className="font-mono text-xs text-[var(--color-text-muted)]">{item.topic}</div>
                        </td>
                        <td className="px-6 align-middle">
                          <div className="font-mono text-xs text-[var(--color-text-muted)]">{item.group_id}</div>
                        </td>
                        <td className="px-6 align-middle text-right">
                          <span className="font-mono text-lg font-black text-[var(--color-text-main)]">
                            {item.lag ?? '--'}
                          </span>
                        </td>
                        <td className="px-6 align-middle text-right">
                          <span className="font-mono text-sm font-bold text-[var(--color-text-muted)]">
                            {item.partitions}
                          </span>
                        </td>
                        <td className="px-6 align-middle text-center">
                          <span className={`inline-flex items-center justify-center min-w-[112px] px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${rowTone}`}>
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

      {/* Recent Jobs Table Section */}
      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden flex flex-col">
        {/* Table Header */}
        <div className="p-6 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-500">
              <Activity size={20} className="animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--color-text-main)] text-lg">Recent Jobs</h3>
              <p className="text-xs text-[var(--color-text-muted)] font-medium">Latest job executions across all pipelines</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/jobs/new"
              className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-lg text-sm font-bold hover:bg-emerald-100 transition-all flex items-center gap-2"
            >
              <Plus size={16} /> New Analysis
            </Link>
            <Link
              to="/jobs"
              className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-bold hover:bg-[var(--color-primary-hover)] transition-all shadow-sm flex items-center gap-2"
            >
              View All
            </Link>
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-x-auto">
          {recentJobs.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-16 h-16 bg-[var(--color-bg)] rounded-full flex items-center justify-center mx-auto text-[var(--color-text-muted)]">
                <ClipboardList size={32} />
              </div>
              <p className="text-[var(--color-text-muted)] font-medium">No jobs recorded yet.</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-xs uppercase tracking-widest font-black">
                  <th className="px-6 py-4">Job ID</th>
                  <th className="px-6 py-4">Pipeline</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Duration</th>
                  <th className="px-6 py-4 text-center">Created At</th>
                  <th className="px-6 py-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)] text-[var(--color-text-main)]">
                {recentJobs.map((j: Job) => {
                  const jobTime = formatTime(j.created_at || j.started_at)
                  const pipeline = j.pipeline_id ? stats.pipelines.find(p => p.id === j.pipeline_id || p.pipeline_id === j.pipeline_id) : null
                  const pipelineName = j.pipeline_name || pipeline?.name || pipeline?.pipeline_name || (Array.isArray(j.pipeline) ? j.pipeline.join(' → ') : j.pipeline)
                  return (
                    <tr key={j.job_id as string} className="hover:bg-[var(--color-bg)] transition-colors group border-b border-[var(--color-border)] last:border-0 h-[72px]">
                      <td className="px-6 align-middle">
                        <div className="flex items-center h-full font-mono text-sm text-[var(--color-text-muted)]">
                          {(j.job_id as string).slice(0, 12)}
                        </div>
                      </td>
                      <td className="px-6 align-middle">
                        <div className="flex items-center h-full">
                          <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-tighter truncate max-w-[180px]" title={pipelineName}>
                            {pipelineName}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 align-middle">
                        <div className="flex items-center h-full">
                          <StatusBadge status={j.status as string} />
                        </div>
                      </td>
                      <td className="px-6 align-middle">
                        <div className="flex items-center h-full text-sm font-bold text-[var(--color-text-muted)]">
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
                        </div>
                      </td>
                      <td className="px-6 align-middle">
                        <div className="flex items-center justify-center h-full text-sm font-bold text-[var(--color-text-muted)] whitespace-nowrap">
                          {jobTime.date} <span className="text-[var(--color-text-muted)] mx-1">•</span> {jobTime.time}
                        </div>
                      </td>
                      <td className="px-6 align-middle">
                        <div className="flex items-center justify-center h-full">
                          <Link
                            to={`/jobs/${j.job_id}`}
                            className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-[var(--color-text-muted)] hover:text-teal-600 hover:bg-teal-50 transition-all border border-transparent hover:border-teal-100"
                            title="View Details"
                          >
                            <ExternalLink size={18} />
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

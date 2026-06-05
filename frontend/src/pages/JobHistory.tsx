import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { orchestratorApi, configApi } from '@/lib/api'
import StatusBadge from '@/components/StatusBadge'
import PageHeader from '@/components/PageHeader'
import {
  Activity,
  ExternalLink,
  ClipboardList,
  Search,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { CustomSelect } from '@/components/custom/CustomSelect'

interface Job {
  job_id: string
  status: string
  pipeline: string[] | string
  current_step: string | null
  created_at: string
  updated_at: string
  error?: string
  pipeline_id?: string
  pipeline_name?: string
}

export default function JobHistory() {
  const {isAdmin}=useAuth()
  const [jobs, setJobs] = useState<Job[]>([])
  const [totalJobs, setTotalJobs] = useState(0)
  const [pipelines, setPipelines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Filtering states
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [pipelineFilter, setPipelineFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10 // Increased for history view

  useEffect(() => {
    async function fetchConstants() {
      try {
        const res = await configApi.get('/pipelines/graph/')
        setPipelines(res.data)
      } catch (e) {
        console.error('Failed to load pipelines', e)
      }
    }
    fetchConstants()
  }, [])

  useEffect(() => {
    async function loadJobs() {
      setLoading(true)
      try {
        const offset = (currentPage - 1) * itemsPerPage
        const res = await orchestratorApi.get(`/v1/jobs/?limit=${itemsPerPage}&offset=${offset}&status=${statusFilter}`)
        const { items, total } = res.data
        setJobs(items)
        setTotalJobs(total)
      } finally {
        setLoading(false)
      }
    }
    loadJobs()
  }, [currentPage, statusFilter])

  
  useEffect(() => {
    setCurrentPage(1)
  }, [statusFilter])

  
  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      const pipeline = j.pipeline_id ? pipelines.find(p => p.id === j.pipeline_id || p.pipeline_id === j.pipeline_id) : null
      const pipelineName = j.pipeline_name || pipeline?.name || pipeline?.pipeline_name || (Array.isArray(j.pipeline) ? j.pipeline.join(' → ') : j.pipeline) || 'Unknown Pipeline'
      const matchesPipeline = !pipelineFilter || pipelineName === pipelineFilter
      const matchesSearch = !searchQuery || j.job_id.slice(0, 12).toLowerCase().includes(searchQuery.toLowerCase())
      return matchesPipeline && matchesSearch
    })
  }, [jobs, pipelineFilter, searchQuery, pipelines])

  const totalPages = Math.ceil(totalJobs / itemsPerPage)

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

  const allPipelineNames = useMemo(() => {
    const fromPipelines = pipelines
      .filter(p => p.is_active)
      .map(p => p.name || p.pipeline_name)
      .filter(Boolean)
    return Array.from(new Set(fromPipelines))
  }, [pipelines])

  if (loading && jobs.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-teal-500/20 border-t-teal-500 rounded-full animate-spin" />
          <p className="text-[var(--color-text-muted)] font-medium animate-pulse">Loading Job History...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader title={isAdmin ? 'Job History' : 'My Jobs'}/>
      {/* Filter Row */}
      <div className="bg-[var(--color-surface)] p-4 rounded-2xl border border-[var(--color-border)] shadow-sm flex flex-col md:flex-row items-center gap-4">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={18} />
          <input
            type="text"
            placeholder="Search with job id ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-main)] placeholder:text-[var(--color-text-muted)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-medium"
          />
        </div>

        <CustomSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: '', label: 'All Status' },
            { value: 'in_progress', label: 'In Progress' },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' }
          ]}
          className="w-full md:w-[150px]"
        />

        <CustomSelect
          value={pipelineFilter}
          onChange={setPipelineFilter}
          options={[
            { value: '', label: 'All Pipelines' },
            ...allPipelineNames.map(name => ({ value: name, label: name }))
          ]}
          className="w-full md:w-[180px]"
        />
      </div>

      <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden flex flex-col relative">
        {loading && (
          <div className="absolute inset-0 bg-[var(--color-surface)]/50 backdrop-blur-[1px] z-10 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-teal-500/20 border-t-teal-500 rounded-full animate-spin" />
          </div>
        )}

        <div className="p-6 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center text-teal-500">
              <Activity size={20} className="animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--color-text-main)] text-lg">Consultation History</h3>
              <p className="text-xs text-[var(--color-text-muted)] font-medium">Detailed record of all clinical job executions</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {filteredJobs.length === 0 && !loading ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-16 h-16 bg-[var(--color-bg)] rounded-full flex items-center justify-center mx-auto text-[var(--color-text-muted)]">
                <ClipboardList size={32} />
              </div>
              <p className="text-[var(--color-text-muted)] font-medium">No clinical jobs found matching your filters.</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-xs uppercase tracking-widest font-black">
                  <th className="px-6 py-4">Job ID</th>
                  <th className="px-6 py-4">Pipeline</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Duration</th>
                  <th className="px-6 py-4 text-center">Time</th>
                  <th className="px-6 py-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filteredJobs.map((j) => {
                  const jobTime = formatTime(j.created_at)
                  const pipeline = j.pipeline_id ? pipelines.find(p => p.id === j.pipeline_id || p.pipeline_id === j.pipeline_id) : null
                  const pipelineName = j.pipeline_name || pipeline?.name || pipeline?.pipeline_name || (Array.isArray(j.pipeline) ? j.pipeline.join(' → ') : j.pipeline) || 'Unknown Pipeline'

                  return (
                    <tr key={j.job_id} className="hover:bg-[var(--color-bg)] transition-colors group border-b border-[var(--color-border)] last:border-0 h-[72px]">
                      <td className="px-6 align-middle">
                        <div className="flex items-center h-full font-mono text-sm text-[var(--color-text-muted)]">
                          {j.job_id.slice(0, 12)}
                        </div>
                      </td>
                      <td className="px-6 align-middle">
                        <div className="flex items-center h-full">
                          <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-tighter truncate max-w-[200px]" title={pipelineName}>
                            {pipelineName}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 align-middle">
                        <div className="flex items-center h-full">
                          <StatusBadge status={j.status} />
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
                            className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-[var(--color-text-muted)] hover:text-teal-600 hover:bg-teal-50/30 transition-all border border-transparent hover:border-teal-900/50"
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

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="px-6 py-4 bg-[var(--color-bg)] border-t border-[var(--color-border)] flex items-center justify-between">
            <p className="text-xs text-[var(--color-text-muted)] font-medium">
              Showing <span className="font-bold text-[var(--color-text-main)]">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-bold text-[var(--color-text-main)]">{Math.min(currentPage * itemsPerPage, totalJobs)}</span> of <span className="font-bold text-[var(--color-text-main)]">{totalJobs}</span> results
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-teal-600 disabled:opacity-50 disabled:hover:text-[var(--color-text-muted)] transition-all"
              >
                <ChevronLeft size={18} />
              </button>

              <div className="flex items-center gap-1 overflow-x-auto max-w-[200px] no-scrollbar">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum = currentPage;
                  if (currentPage <= 3) pageNum = i + 1;
                  else if (currentPage > totalPages - 2) pageNum = totalPages - 4 + i;
                  else pageNum = currentPage - 2 + i;

                  if (pageNum < 1 || pageNum > totalPages) return null;

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={cn(
                        "w-9 h-9 flex-shrink-0 rounded-lg text-sm font-bold transition-all",
                        currentPage === pageNum
                          ? "bg-teal-600 text-white shadow-lg shadow-teal-600/20"
                          : "bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-main)] hover:border-teal-200 hover:text-teal-600"
                      )}
                    >
                      {pageNum}
                    </button>
                  )
                })}
              </div>

              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-teal-600 disabled:opacity-50 disabled:hover:text-[var(--color-text-muted)] transition-all"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

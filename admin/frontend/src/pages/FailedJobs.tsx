import { useEffect, useState } from 'react'
import { orchestratorApi } from '@/lib/api'
import {
  AlertTriangle, RefreshCw, ChevronDown, ChevronUp,
  X, AlertCircle, Terminal
} from 'lucide-react'
import { Button } from '@/components/custom/Button'
import PageHeader from '@/components/PageHeader'

interface DLQEntry {
  id: number
  job_id: string
  step_name: string | null
  topic: string | null
  error: string | null
  original_message: Record<string, unknown> | null
  created_at: string
}

export default function FailedJobs() {
  const [entries, setEntries] = useState<DLQEntry[]>([])
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [listRes, countRes] = await Promise.all([
        orchestratorApi.get('/v1/dlq/?limit=100'),
        orchestratorApi.get('/v1/dlq/count'),
      ])
      setEntries(listRes.data)
      setCount(countRes.data.count)
    } catch {
      setError('Failed to load dead-letter queue entries.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }



  const fmtDate = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      }).replace(',', ' ·')
    } catch {
      return iso
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Failed Jobs" />
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-800 dark:text-[var(--color-text-main)]">Dead-letter queue</h2>
            {count !== null && (
              <span className="bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border border-red-100/50 dark:border-red-900/30 px-2 py-0.5 rounded-full text-xs font-semibold">
                {count} {count === 1 ? 'entry' : 'entries'}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-[var(--color-text-muted)] mt-1">Jobs that exhausted all validation retries</p>
        </div>

        
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="primary"
            size="sm"
            icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />}
            onClick={load}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 font-medium">
          {error}
        </div>
      )}

      
      {loading && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-slate-400 dark:text-[var(--color-text-muted)]">Loading dead-letter items...</span>
        </div>
      )}

      
      {!loading && entries.length === 0 && !error && (
        <div className="text-center py-20 text-slate-400 dark:text-[var(--color-text-muted)] bg-white dark:bg-[var(--color-surface)] border border-slate-200 dark:border-[var(--color-border)] rounded-2xl shadow-sm">
          <AlertTriangle size={36} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
          <p className="text-sm font-semibold text-slate-700 dark:text-[var(--color-text-main)]">No dead-letter entries</p>
          <p className="text-xs mt-1 text-slate-400 dark:text-[var(--color-text-muted)]">Jobs that exhaust validation retries will appear here.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-4 animate-fade-in">
          {entries.map(entry => {
            const isOpen = expanded.has(entry.id)
            return (
              <div
                key={entry.id}
                className={`bg-white dark:bg-[var(--color-surface)] border rounded-2xl shadow-sm overflow-hidden transition-all duration-200 ${
                  isOpen ? 'border-teal-500/20 dark:border-teal-900/30 ring-1 ring-teal-500/5' : 'border-slate-200 dark:border-[var(--color-border)] hover:border-slate-350 dark:hover:border-slate-500'
                }`}
              >
                <div
                  onClick={() => toggleExpand(entry.id)}
                  className="w-full flex items-center justify-between p-5 text-left cursor-pointer hover:bg-slate-50/40 dark:hover:bg-slate-100/40 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                   
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0 mt-1.5"></span>
                    
                    <div className="space-y-1.5 min-w-0">
                      
                      <span className="text-sm font-mono font-bold text-slate-800 dark:text-[var(--color-text-main)] truncate block">
                        {entry.job_id}
                      </span>
                      
                      
                      <div className="flex flex-wrap gap-2">
                        {entry.step_name && (
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-orange-50 text-orange-800 border border-orange-200/50 rounded-md shrink-0">
                            {entry.step_name}
                          </span>
                        )}
                        {entry.topic && (
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200/60 rounded-md shrink-0">
                            {entry.topic}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="text-xs text-slate-400 dark:text-[var(--color-text-muted)] font-medium hidden sm:inline-block">
                      {fmtDate(entry.created_at)}
                    </span>
                    <button className="text-slate-400 dark:text-[var(--color-text-muted)] hover:text-slate-600 dark:hover:text-[var(--color-text-main)] transition-colors shrink-0">
                      {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                
                {isOpen && (
                  <div className="border-t border-slate-100 dark:border-[var(--color-border)] bg-slate-50/30 dark:bg-slate-900/30 p-5 grid grid-cols-1 md:grid-cols-2 gap-6 animate-scale-in">
                    
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <AlertCircle size={13} className="text-slate-400 dark:text-[var(--color-text-muted)]" />
                        <span className="text-[10px] font-bold text-slate-400 dark:text-[var(--color-text-muted)] uppercase tracking-wider">Error Message</span>
                      </div>
                      
                      <div className="bg-red-100/70 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl p-4 flex items-start gap-2.5 text-red-900 dark:text-red-400 text-xs font-mono font-medium leading-relaxed flex-1">
                        <X size={14} className="text-red-600 shrink-0 mt-0.5" />
                        <span className="break-words w-full">{entry.error || 'No error message specified.'}</span>
                      </div>
                    </div>

                    
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <Terminal size={13} className="text-slate-400 dark:text-[var(--color-text-muted)]" />
                        <span className="text-[10px] font-bold text-slate-400 dark:text-[var(--color-text-muted)] uppercase tracking-wider">Original Message</span>
                      </div>

                      <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 text-emerald-400 text-xs font-mono font-medium leading-relaxed overflow-x-auto flex-1 min-h-[70px] shadow-inner">
                        <pre className="whitespace-pre-wrap break-all select-all text-emerald-400">
                          {entry.original_message ? JSON.stringify(entry.original_message, null, 2) : '{}'}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

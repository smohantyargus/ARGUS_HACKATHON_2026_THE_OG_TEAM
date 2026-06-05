import { useState, useRef, useEffect } from 'react'
import { Plus, CheckCircle, X, GitBranch, Copy, History, RotateCcw, Search, ChevronDown, Download, Upload } from 'lucide-react'
import { cn } from '@/lib/cn'
import { configApi } from '@/lib/api'
import type { PipelineSummary, PipelineVersion, AgentInfo } from '@/types/pipeline'
import { Button } from './custom/Button'
import { CustomDialog } from './custom/CustomDialog'

interface Props {
  pipelines: PipelineSummary[]
  agents: AgentInfo[]
  saveSuccess: boolean
  listError: string
  onListErrorClear: () => void
  onNew: () => void
  onEdit: (id: string) => void
  onRefresh: () => void
}

export function PipelineListView({
  pipelines, agents, saveSuccess, listError, onListErrorClear, onNew, onEdit, onRefresh,
}: Props) {
  const [versionTarget, setVersionTarget] = useState<PipelineSummary | null>(null)
  const [versions, setVersions] = useState<PipelineVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [restoring, setRestoring] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [dialog, setDialog] = useState<{
    isOpen: boolean
    title: string
    description: string
    type: 'alert' | 'confirm' | 'delete' | 'prompt'
    variant?: 'info' | 'success' | 'warning' | 'error'
    confirmText?: string
    onConfirm?: () => void | Promise<void>
    promptValue?: string
    onPromptConfirm?: (val: string) => void | Promise<void>
  }>({
    isOpen: false,
    title: '',
    description: '',
    type: 'alert'
  })

  const showAlert = (title: string, desc: string, variant: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setDialog({
      isOpen: true,
      title,
      description: desc,
      type: 'alert',
      variant
    })
  }
  
  const filterRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleToggleActive(p: PipelineSummary) {
    try {
      if (p.is_active) {
        await configApi.delete(`/pipelines/graph/${p.id}`)
      } else {
        await configApi.post(`/pipelines/graph/${p.id}/activate`)
      }
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      onListErrorClear()
      console.error(detail ?? 'Action failed.')
    }
  }

  async function handleDuplicate(p: PipelineSummary) {
    try {
      const res = await configApi.get(`/pipelines/graph/${p.id}`)
      const data = res.data as {
        name: string; description?: string
        nodes: Array<{ node_key: string; agent_id: number | string; node_agent_type?: string; position_x?: number; position_y?: number; config_override?: Record<string, unknown>; max_retries: number; on_failure: string }>
        edges: Array<{ source_node_key: string; target_node_key: string; edge_type?: string; wait_for_group?: string | null; is_optional?: boolean }>
      }
      const nodeList = data.nodes.map(n => ({
        node_key: n.node_key,
        agent_id: n.agent_id,
        agent_type: n.node_agent_type ?? 'registry',
        position_x: n.position_x,
        position_y: n.position_y,
        config_override: n.config_override ?? {},
        max_retries: n.max_retries,
        on_failure: n.on_failure,
      }))
      const edgeList = data.edges.map(e => ({
        source_node_key: e.source_node_key,
        target_node_key: e.target_node_key,
        edge_type: e.edge_type ?? 'sequential',
        wait_for_group: e.wait_for_group ?? null,
        is_optional: e.is_optional ?? false,
      }))
      await configApi.post('/pipelines/graph/', {
        name: `Copy of ${data.name}`,
        description: data.description,
        nodes: nodeList,
        edges: edgeList,
      })
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      console.error(detail ?? 'Duplicate failed.')
    }
  }

  function triggerRestoreConfirm(v: PipelineVersion) {
    if (!versionTarget || !v.snapshot) return
    setDialog({
      isOpen: true,
      title: 'Restore Version',
      description: `Restore pipeline to v${v.version}? This will create a new version.`,
      type: 'confirm',
      confirmText: 'Restore',
      onConfirm: () => doRestore(v)
    })
  }

  async function doRestore(v: PipelineVersion) {
    setDialog(prev => ({ ...prev, isOpen: false }))
    if (!versionTarget || !v.snapshot) return
    setRestoring(v.version)
    try {
      await configApi.put(`/pipelines/graph/${versionTarget.id}`, v.snapshot)
      setVersionTarget(null)
      onRefresh()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      console.error(detail ?? 'Restore failed.')
    } finally {
      setRestoring(null)
    }
  }

  async function openVersionHistory(p: PipelineSummary) {
    setVersionTarget(p)
    setVersionsLoading(true)
    setVersions([])
    try {
      const res = await configApi.get(`/pipelines/graph/${p.id}/versions`)
      setVersions(res.data)
    } catch {
      setVersions([])
    } finally {
      setVersionsLoading(false)
    }
  }

  async function handleExport(p: PipelineSummary) {
    try {
      const res = await configApi.get(`/pipelines/graph/${p.id}`)
      const data = res.data
      console.log("data before export",data)
      const exportPayload = {
        id: data.id,
        name: data.name,
        description: data.description || '',
        input_type: data.input_type || 'text',
        version: data.version,
        is_active: data.is_active,
        nodes: data.nodes.map((n: any) => ({
          id: n.id,
          node_key: n.node_key,
          agent_id: n.agent_id,
          node_agent_type: n.node_agent_type || 'registry',
          agent: n.agent, 
          position_x: n.position_x,
          position_y: n.position_y,
          config_override: n.config_override || {},
          max_retries: n.max_retries || 2,
          on_failure: n.on_failure || 'fail_job'
        })),
        edges: data.edges.map((e: any) => ({
          id: e.id,
          source_node_key: e.source_node_key,
          target_node_key: e.target_node_key,
          source_node_id: e.source_node_id,
          target_node_id: e.target_node_id,
          edge_type: e.edge_type || 'sequential',
          is_parallel: e.is_parallel || false,
          wait_for_group: e.wait_for_group || null,
          is_optional: e.is_optional || false
        }))
      }
     
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `pipeline-${data.name}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      
      showAlert('Export Failed', 'Failed to export pipeline.', 'error')
    }
  }

  async function handleImport(file: File) {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const importData = JSON.parse(e.target?.result as string)
        if (!importData.name || !Array.isArray(importData.nodes) || !Array.isArray(importData.edges)) {
          showAlert('Invalid File', 'Pipeline name, nodes, and edges are required.', 'error')
          return
        }

       
        const { created_at, updated_at, created_by, ...cleanedData } = importData

        
        const missingAgents: string[] = []

        for (const n of cleanedData.nodes) {
          const type = n.node_agent_type || n.agent_type || 'registry'
          const rawId = n.agent_id
          const agentObjName = n.agent?.name
          const fallbackName = n.node_key

          
          const matchedAgent = agents.find((a: any) => {
            const aType = a.agent_type || 'registry'
            if (aType !== type) return false

            return (
              String(a.id) === String(rawId) ||
              a.name === agentObjName ||
              a.name === fallbackName
            )
          })

          if (!matchedAgent) {
            const agentIdentifier = agentObjName || rawId || fallbackName
            missingAgents.push(`${agentIdentifier} (${type})`)
          } else {
            
            n.agent_id = matchedAgent.id
          }
        }

        if (missingAgents.length > 0) {
          showAlert('Import Failed', `The following required agents do not exist in the system:\n- ${missingAgents.join('\n- ')}`, 'error')
          return
        }

       
        let existsById = false
        if (cleanedData.id) {
          existsById = pipelines.some(p => p.id === cleanedData.id)
        }

        if (existsById) {
          
          const payload = {
            name: cleanedData.name,
            description: cleanedData.description || '',
            input_type: cleanedData.input_type || 'text',
            nodes: cleanedData.nodes.map((n: any) => ({
                node_key: n.node_key,
                agent_id: n.agent_id,
                agent_type: n.node_agent_type || 'registry',
                position_x: n.position_x,
                position_y: n.position_y,
                config_override: n.config_override || {},
                max_retries: n.max_retries || 2,
                on_failure: n.on_failure || 'fail_job'
              })),
            edges: cleanedData.edges.map((e: any) => ({
              source_node_key: e.source_node_key,
              target_node_key: e.target_node_key,
              edge_type: e.edge_type || 'sequential',
              wait_for_group: e.wait_for_group || null,
              is_optional: e.is_optional || false
            }))
          }
          await configApi.put(`/pipelines/graph/${cleanedData.id}`, payload)
          onRefresh()
          showAlert('Pipeline Updated', 'Pipeline successfully updated (version bumped)!', 'success')
          return
        }

        
        let targetName = cleanedData.name
        let existsByName = pipelines.some(p => p.name.toLowerCase() === targetName.toLowerCase())

        if (existsByName) {
          showRenameDialog(cleanedData, targetName)
        } else {
          await executePipelineImport(cleanedData, targetName)
        }
      } catch (err: unknown) {
        console.error('Import failed:', err)
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        showAlert('Import Failed', detail || 'Failed to import pipeline.', 'error')
      }
    }
    reader.readAsText(file)
  }

  function showRenameDialog(cleanedData: any, currentName: string, errorMsg?: string) {
    setDialog({
      isOpen: true,
      title: 'Pipeline Name Conflict',
      description: errorMsg || `A pipeline with the name "${currentName}" already exists with a different ID. Please enter a new unique name to import it:`,
      type: 'prompt',
      confirmText: 'Import',
      promptValue: currentName + "_copy",
      onPromptConfirm: async (newName: string) => {
        const trimmed = newName.trim()
        if (!trimmed) {
          showRenameDialog(cleanedData, currentName, 'Pipeline name cannot be empty. Please enter a name:')
          return
        }
        const stillExists = pipelines.some(p => p.name.toLowerCase() === trimmed.toLowerCase())
        if (stillExists) {
          showRenameDialog(cleanedData, trimmed, `The name "${trimmed}" is also taken. Please enter a different unique name:`)
          return
        }
        setDialog(prev => ({ ...prev, isOpen: false }))
        await executePipelineImport(cleanedData, trimmed)
      }
    })
  }

  async function executePipelineImport(cleanedData: any, targetName: string) {
    try {
      const payload = {
        id: cleanedData.id || undefined, 
        name: targetName,
        description: cleanedData.description || '',
        input_type: cleanedData.input_type || 'text',
        nodes: cleanedData.nodes.map((n: any) => ({
          node_key: n.node_key,
          agent_id: n.agent_id,
          agent_type: n.node_agent_type || 'registry',
          position_x: n.position_x,
          position_y: n.position_y,
          config_override: n.config_override || {},
          max_retries: n.max_retries || 2,
          on_failure: n.on_failure || 'fail_job'
        })),
        edges: cleanedData.edges.map((e: any) => ({
          source_node_key: e.source_node_key,
          target_node_key: e.target_node_key,
          edge_type: e.edge_type || 'sequential',
          wait_for_group: e.wait_for_group || null,
          is_optional: e.is_optional || false
        }))
      }

      await configApi.post('/pipelines/graph/', payload)
      onRefresh()
      showAlert('Import Successful', 'Pipeline imported successfully as a new configuration!', 'success')
    } catch (err: unknown) {
      console.error('Import failed:', err)
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showAlert('Import Failed', detail || 'Failed to import pipeline.', 'error')
    }
  }

  return (
    <div>
      {saveSuccess && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm font-semibold">
          <CheckCircle size={16} className="shrink-0" />
          Pipeline saved successfully.
        </div>
      )}
      {listError && (
        <div className="mb-4 flex items-center justify-between px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {listError}
          <button onClick={onListErrorClear}><X size={14} /></button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-base font-semibold text-[var(--color-text-muted)] whitespace-nowrap">Visual agent pipeline builder</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 lg:ml-auto w-full lg:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" size={15} />
            <input
              type="text"
              placeholder="Search pipeline names..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 h-9 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-xs text-[var(--color-text-main)] focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all placeholder:text-[var(--color-text-muted)] font-medium"
            />
          </div>

          
          <div className="relative w-full sm:w-auto animate-in" ref={filterRef}>
            <button
              type="button"
              onClick={() => setFilterOpen(!filterOpen)}
              className="flex items-center justify-between gap-2 w-full sm:w-28 px-3 h-9 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-xs font-semibold text-[var(--color-text-muted)] hover:border-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all cursor-pointer"
            >
              <span className="capitalize">{statusFilter}</span>
              <ChevronDown size={14} className={cn("text-[var(--color-text-muted)] transition-transform duration-200", filterOpen && "rotate-180")} />
            </button>
            {filterOpen && (
              <div className="absolute right-0 mt-1.5 w-full sm:w-28 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 z-30 animate-in fade-in slide-in-from-top-1 duration-100">
                {(['all', 'active', 'inactive'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      setStatusFilter(opt)
                      setFilterOpen(false)
                    }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors capitalize",
                      statusFilter === opt
                        ? "bg-teal-50 text-teal-600"
                        : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]"
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                handleImport(file)
                e.target.value = ''
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<Upload size={14} />}
            onClick={() => fileInputRef.current?.click()}
            className="h-9 self-start sm:self-auto shrink-0 w-full sm:w-auto"
            title="Import Pipeline"
          >
            Import
          </Button>

          <button
            onClick={onNew}
            className="flex items-center justify-center gap-2 px-4 h-9 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 shadow-sm transition-colors self-start sm:self-auto shrink-0 w-full sm:w-auto"
          >
            <Plus size={16} /> New Pipeline
          </button>
        </div>
      </div>

      {(() => {
        const filteredPipelines = pipelines.filter(p => {
          const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase())
          const matchesStatus =
            statusFilter === 'all'
              ? true
              : statusFilter === 'active'
              ? p.is_active
              : !p.is_active
          return matchesSearch && matchesStatus
        })

        if (filteredPipelines.length === 0) {
          return (
            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-16 text-center shadow-sm">
              <GitBranch size={44} className="text-[var(--color-text-muted)] mx-auto mb-3" />
              <p className="text-[var(--color-text-muted)] font-semibold">No pipelines found</p>
              {pipelines.length === 0 ? (
                <>
                  <p className="text-[var(--color-text-muted)] text-sm mt-1">Build your first pipeline by dragging agents onto the canvas</p>
                  <button onClick={onNew} className="mt-4 px-5 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 shadow-sm transition-colors">
                    Create Pipeline
                  </button>
                </>
              ) : (
                <p className="text-[var(--color-text-muted)] text-sm mt-1">Try adjusting your search or filters</p>
              )}
            </div>
          )
        }

        return (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredPipelines.map(p => (
              <div key={p.id} className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex-1 min-w-0 mr-2">
                    <h3 className="font-bold text-[var(--color-text-main)] truncate">{p.name}</h3>
                    {p.description && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{p.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(p)}
                    title={p.is_active ? 'Deactivate pipeline' : 'Activate pipeline'}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      p.is_active ? "app-toggle-active" : "app-toggle-inactive"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                        p.is_active ? "translate-x-4" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mb-4">
                  v{p.version}{p.created_at && ` · ${new Date(p.created_at).toLocaleDateString()}`}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onEdit(p.id)}
                    className="flex-1 py-1.5 text-sm font-semibold text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDuplicate(p)}
                    title="Duplicate"
                    className="p-1.5 text-[var(--color-text-muted)] hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    onClick={() => openVersionHistory(p)}
                    title="Version history"
                    className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[var(--color-bg)] rounded-lg transition-colors"
                  >
                    <History size={15} />
                  </button>
                  <button
                    onClick={() => handleExport(p)}
                    title="Export configuration"
                    className="p-1.5 text-[var(--color-text-muted)] hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  >
                    <Download size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Version history modal */}
      {versionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200">
          <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--color-border)] w-full max-w-md overflow-hidden transform transition-all animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-[var(--color-text-main)] tracking-tight">Version History</h3>
                <button
                  onClick={() => setVersionTarget(null)}
                  className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[var(--color-bg)] transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {versionsLoading ? (
                <p className="text-sm text-[var(--color-text-muted)] text-center py-6">Loading version history…</p>
              ) : versions.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)] text-center py-6">No version history available.</p>
              ) : (
                <div className="space-y-2">
                  {versions.map((v, i) => (
                    <div key={v.version} className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
                      <div className="flex items-center gap-3">
                        <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full',
                          i === 0 ? 'bg-teal-100 text-teal-700' : 'bg-[var(--color-bg)] text-[var(--color-text-muted)]')}>
                          v{v.version}
                        </span>
                        {i === 0
                          ? <span className="text-[10px] font-bold text-green-600 uppercase">current</span>
                          : v.snapshot && (
                            <button
                              onClick={() => triggerRestoreConfirm(v)}
                              disabled={restoring === v.version}
                              className="flex items-center gap-1 text-[10px] font-semibold text-[var(--color-text-muted)] hover:text-teal-600 disabled:opacity-50 transition-colors"
                            >
                              <RotateCcw size={11} />
                              {restoring === v.version ? 'Restoring…' : 'Restore'}
                            </button>
                          )
                        }
                      </div>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {new Date(v.created_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <CustomDialog
        isOpen={dialog.isOpen}
        title={dialog.title}
        description={dialog.description}
        type={dialog.type}
        variant={dialog.variant}
        onClose={() => setDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={dialog.onConfirm}
        confirmText={dialog.confirmText}
        promptValue={dialog.promptValue}
        onPromptConfirm={dialog.onPromptConfirm}
      />
    </div>
  )
}

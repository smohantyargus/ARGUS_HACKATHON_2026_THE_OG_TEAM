import { useCallback, useRef, useState, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  type Connection,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { configApi, orchestratorApi } from '@/lib/api'
import { AgentNode, type AgentNodeData } from '@/components/AgentNode'
import { PipelinePalette } from '@/components/PipelinePalette'
import { PipelineTestRunModal } from '@/components/PipelineTestRunModal'
import { PipelineApiPreview } from '@/components/PipelineApiPreview'
import { PipelineListView } from '@/components/PipelineListView'
import { PipelineNodeConfigPanel } from '@/components/PipelineNodeConfigPanel'
import { PipelineEdgeConfigPanel, type EdgeData } from '@/components/PipelineEdgeConfigPanel'
import type {
  AgentInfo, RegistryAgentRaw, GenericAgentRaw, MergerRaw, PipelineSummary,
} from '@/types/pipeline'
import {
  Save, ChevronLeft, CheckCircle, AlertTriangle, GitBranch, Play, ClipboardList, X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import PageHeader from '@/components/PageHeader'
import { CustomDialog } from '@/components/custom/CustomDialog'
import { Button } from '@/components/custom/Button'
import { CustomSelect } from '@/components/custom/CustomSelect'
import { useTheme } from '@/hooks/useTheme'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawPipelineNode {
  id: string
  agent_id: number | string
  node_agent_type?: string
  agent?: { name: string; input_topic: string; output_topic: string }
  node_key: string
  position_x?: number
  position_y?: number
  max_retries: number
  on_failure: string
  config_override?: Record<string, unknown>
}

interface RawPipelineEdge {
  id: string
  source_node_key: string
  target_node_key: string
  edge_type?: string
  wait_for_group?: string | null
  is_optional?: boolean
}

// ── Node types registry ────────────────────────────────────────────────────────

const nodeTypes = { agent: AgentNode }

// ── Helpers ───────────────────────────────────────────────────────────────────

let _nodeCounter = 0

function nextNodeId(): string {
  return `n_${++_nodeCounter}_${Date.now()}`
}

function computeEdgeStyle(srcTopic: string, tgtTopic: string, edgeType: string = 'sequential') {
  if (edgeType === 'parallel_fanout') {
    return {
      style: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '8 4' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
    }
  }
  if (edgeType === 'merger_input') {
    return {
      style: { stroke: '#8b5cf6', strokeWidth: 2, strokeDasharray: '8 4' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' },
    }
  }
  const color = srcTopic === tgtTopic ? '#22c55e' : '#ef4444'
  return {
    style: { stroke: color, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  }
}

function buildFlowNode(agent: AgentInfo, position: { x: number; y: number }): Node {
  const id = nextNodeId()
  const nodeKey = `${agent.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${_nodeCounter}`
  return {
    id,
    type: 'agent',
    position,
    data: {
      agentId: agent.id,
      agentName: agent.name,
      agentType: agent.agent_type,
      nodeKey,
      inputTopic: agent.input_topic,
      outputTopic: agent.output_topic,
      maxRetries: 2,
      onFailure: 'fail_job',
      configOverride: {},
    } satisfies AgentNodeData,
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PipelineBuilder() {
  const { resolvedTheme } = useTheme()
  const [mode, setMode] = useState<'list' | 'builder'>('list')
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pipelineName, setPipelineName] = useState('')
  const [pipelineDesc, setPipelineDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [isDirty, setIsDirty] = useState(false)
  const [listError, setListError] = useState('')

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[])
  const rfWrapperRef = useRef<HTMLDivElement>(null)
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [configOverrideText, setConfigOverrideText] = useState('{}')
  const [configJsonError, setConfigJsonError] = useState('')

  const [inputType, setInputType] = useState<'text' | 'audio'>('text')
  const [showValidate, setShowValidate] = useState(false)
  const [showTestRun, setShowTestRun] = useState(false)
  const [paletteSearch, setPaletteSearch] = useState('')
  const [showBackDialog, setShowBackDialog] = useState(false)

  // ── Data loading ──────────────────────────────────────────────────────────

  async function loadPipelines() {
    try {
      const res = await configApi.get('/pipelines/graph/')
      setPipelines(res.data)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadPipelines()
    Promise.allSettled([
      configApi.get('/internal/agents/'),
      configApi.get('/internal/agent-definitions/'),
      configApi.get('/internal/response-mergers/'),
    ]).then(([registryRes, genericRes, mergerRes]) => {
      const registry: AgentInfo[] = registryRes.status === 'fulfilled'
        ? (registryRes.value.data as RegistryAgentRaw[])
            .filter(a => a.is_active)
            .map(a => ({ ...a, agent_type: 'registry' as const }))
        : []

      const generic: AgentInfo[] = genericRes.status === 'fulfilled'
        ? (genericRes.value.data as GenericAgentRaw[])
            .filter(a => a.is_active)
            .map(a => ({
              id: a.id,
              name: a.name,
              input_topic: a.input_topic,
              output_topic: a.output_topic,
              is_active: a.is_active,
              agent_type: 'generic_llm' as const,
            }))
        : []

      const mergers: AgentInfo[] = mergerRes.status === 'fulfilled'
        ? (mergerRes.value.data as MergerRaw[])
            .filter(m => m.is_active)
            .map(m => ({
              id: m.id,
              name: m.name,
              input_topic: Object.keys(m.input_topic_map).join(', '),
              output_topic: m.output_topic,
              is_active: m.is_active,
              agent_type: 'output_merger' as const,
              input_topic_map: m.input_topic_map,
            }))
        : []

      setAgents([...registry, ...generic, ...mergers])
    })
  }, [])

  const isLoadingRef = useRef(false)
  useEffect(() => {
    if (!isLoadingRef.current) setIsDirty(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  // ── Canvas handlers ───────────────────────────────────────────────────────

  const onConnect = useCallback(
    (connection: Connection) => {
      const srcNode = nodes.find(n => n.id === connection.source)
      const tgtNode = nodes.find(n => n.id === connection.target)
      if (!srcNode || !tgtNode) return
      const srcData = srcNode.data as AgentNodeData
      const tgtData = tgtNode.data as AgentNodeData
      const defaultEdgeData: EdgeData = { edgeType: 'sequential', waitForGroup: '', isOptional: false }
      const { style, markerEnd } = computeEdgeStyle(srcData.outputTopic, tgtData.inputTopic, 'sequential')
      setEdges(eds => addEdge({ ...connection, style, markerEnd, data: defaultEdgeData }, eds))
    },
    [nodes, setEdges],
  )

  function onDragStart(e: React.DragEvent, agent: AgentInfo) {
    e.dataTransfer.setData('application/medplat-agent', JSON.stringify(agent))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (!rfInstanceRef.current) return
      const raw = e.dataTransfer.getData('application/medplat-agent')
      if (!raw) return
      const agent: AgentInfo = JSON.parse(raw)
      const position = rfInstanceRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setNodes(nds => [...nds, buildFlowNode(agent, position)])
    },
    [setNodes],
  )

  function onNodeClick(_: React.MouseEvent, node: Node) {
    setSelectedNodeId(node.id)
    setSelectedEdgeId(null)
    const d = node.data as AgentNodeData
    setConfigOverrideText(JSON.stringify(d.configOverride ?? {}, null, 2))
    setConfigJsonError('')
  }

  function onEdgeClick(_: React.MouseEvent, edge: Edge) {
    setSelectedEdgeId(edge.id)
    setSelectedNodeId(null)
  }

  function onPaneClick() {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }

  function updateSelectedNode(updates: Partial<AgentNodeData>) {
    setNodes(nds =>
      nds.map(n =>
        n.id === selectedNodeId
          ? { ...n, data: { ...(n.data as AgentNodeData), ...updates } }
          : n,
      ),
    )
  }

  function updateSelectedEdge(updates: Partial<EdgeData>) {
    setEdges(eds =>
      eds.map(e => {
        if (e.id !== selectedEdgeId) return e
        const newData: EdgeData = { ...(e.data as EdgeData), ...updates }
        const srcNode = nodes.find(n => n.id === e.source)
        const tgtNode = nodes.find(n => n.id === e.target)
        const { style, markerEnd } = computeEdgeStyle(
          (srcNode?.data as AgentNodeData | undefined)?.outputTopic ?? '',
          (tgtNode?.data as AgentNodeData | undefined)?.inputTopic ?? '',
          newData.edgeType,
        )
        return { ...e, data: newData, style, markerEnd }
      }),
    )
  }

  function handleConfigOverrideChange(text: string) {
    setConfigOverrideText(text)
    try {
      const parsed = JSON.parse(text)
      setConfigJsonError('')
      updateSelectedNode({ configOverride: parsed })
    } catch {
      setConfigJsonError('Invalid JSON')
    }
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return
    setNodes(nds => nds.filter(n => n.id !== selectedNodeId))
    setEdges(eds => eds.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId))
    setSelectedNodeId(null)
  }

  function deleteSelectedEdge() {
    if (!selectedEdgeId) return
    setEdges(eds => eds.filter(e => e.id !== selectedEdgeId))
    setSelectedEdgeId(null)
  }

  function handleAutoLayout() {
    if (nodes.length === 0) return
    const inDegree: Record<string, number> = {}
    const adj: Record<string, string[]> = {}
    nodes.forEach(n => { inDegree[n.id] = 0; adj[n.id] = [] })
    edges.forEach(e => {
      adj[e.source]?.push(e.target)
      if (e.target in inDegree) inDegree[e.target]++
    })
    const queue = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id)
    const order: string[] = []
    const visited = new Set<string>()
    while (queue.length) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      order.push(id)
      adj[id]?.forEach(next => {
        inDegree[next]--
        if (inDegree[next] === 0) queue.push(next)
      })
    }
    nodes.forEach(n => { if (!visited.has(n.id)) order.push(n.id) })

    const GAP_X = 240
    const GAP_Y = 130
    const COLS = Math.ceil(Math.sqrt(nodes.length))
    setNodes(nds =>
      nds.map(n => {
        const idx = order.indexOf(n.id)
        const col = idx % COLS
        const row = Math.floor(idx / COLS)
        return { ...n, position: { x: col * GAP_X + 50, y: row * GAP_Y + 50 } }
      }),
    )
    setTimeout(() => rfInstanceRef.current?.fitView({ padding: 0.15 }), 50)
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function getInvalidEdges(): string[] {
    return edges.flatMap(edge => {
      const src = nodes.find(n => n.id === edge.source)?.data as AgentNodeData | undefined
      const tgt = nodes.find(n => n.id === edge.target)?.data as AgentNodeData | undefined
      if (!src || !tgt) return []
      if (src.outputTopic !== tgt.inputTopic) {
        return [`${src.agentName} → ${tgt.agentName}: "${src.outputTopic}" ≠ "${tgt.inputTopic}"`]
      }
      return []
    })
  }

  type Check = { label: string; ok: boolean; detail?: string }

  function validatePipeline(): { valid: boolean; checks: Check[] } {
    const checks: Check[] = []
    checks.push({ label: 'Pipeline name set', ok: !!pipelineName.trim() })
    checks.push({ label: 'At least one node', ok: nodes.length > 0 })
    if (nodes.length > 1) {
      const connected = new Set([...edges.map(e => e.source), ...edges.map(e => e.target)])
      const orphans = nodes.filter(n => !connected.has(n.id)).map(n => (n.data as AgentNodeData).nodeKey)
      checks.push({ label: 'No orphan nodes', ok: orphans.length === 0, detail: orphans.length ? `Unconnected: ${orphans.join(', ')}` : undefined })
    }
    const keys = nodes.map(n => (n.data as AgentNodeData).nodeKey)
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    checks.push({ label: 'Unique node keys', ok: dupes.length === 0, detail: dupes.length ? `Duplicates: ${[...new Set(dupes)].join(', ')}` : undefined })
    checks.push({ label: 'No self-loops', ok: edges.filter(e => e.source === e.target).length === 0 })
    const mergerMissingGroup = edges.filter(e => {
      const d = e.data as EdgeData | undefined
      return d?.edgeType === 'merger_input' && !d?.waitForGroup
    })
    checks.push({
      label: 'Merger edges have group key',
      ok: mergerMissingGroup.length === 0,
      detail: mergerMissingGroup.length ? `${mergerMissingGroup.length} merger_input edge(s) missing wait_for_group` : undefined,
    })
    const invalid = getInvalidEdges()
    checks.push({ label: 'Edge schemas compatible (warning)', ok: invalid.length === 0, detail: invalid.length ? `Topic mismatch:\n${invalid.join('\n')}` : undefined })
    return { valid: checks.every(c => c.ok), checks }
  }

  // ── Save / Load ───────────────────────────────────────────────────────────

  async function handleSave() {
    setSaveError('')
    if (!pipelineName.trim()) { setSaveError('Pipeline name is required.'); return }
    setSaving(true)
    try {
      const nodeList = nodes.map(n => {
        const d = n.data as AgentNodeData
        return {
          node_key: d.nodeKey,
          agent_id: d.agentId,
          agent_type: d.agentType === 'generic_llm' ? 'generic_llm' : d.agentType === 'output_merger' ? 'output_merger' : 'registry',
          position_x: n.position.x,
          position_y: n.position.y,
          config_override: d.configOverride,
          max_retries: d.maxRetries,
          on_failure: d.onFailure,
        }
      })
      const edgeList = edges.map(e => {
        const srcData = nodes.find(n => n.id === e.source)?.data as AgentNodeData | undefined
        const tgtData = nodes.find(n => n.id === e.target)?.data as AgentNodeData | undefined
        const edgeData = e.data as EdgeData | undefined
        return {
          source_node_key: srcData?.nodeKey ?? '',
          target_node_key: tgtData?.nodeKey ?? '',
          edge_type: edgeData?.edgeType ?? 'sequential',
          wait_for_group: edgeData?.waitForGroup || null,
          is_optional: edgeData?.isOptional ?? false,
        }
      })
      const payload = { name: pipelineName, description: pipelineDesc, input_type: inputType, nodes: nodeList, edges: edgeList }
      if (editingId) {
        await configApi.put(`/pipelines/graph/${editingId}`, payload)
      } else {
        const res = await configApi.post('/pipelines/graph/', payload)
        const newId = (res.data as { id?: string })?.id
        if (newId) setEditingId(newId)  // switch to edit mode → enables Test, future saves PUT not POST
      }
      setIsDirty(false)
      await loadPipelines()
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
      orchestratorApi.post('/v1/jobs/refresh-cache').catch(() => {/* non-fatal */})
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setSaveError(detail ?? 'Save failed. Check console for details.')
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(id: string) {
    isLoadingRef.current = true
    try {
      const res = await configApi.get(`/pipelines/graph/${id}`)
      const data = res.data as {
        name: string; description?: string; input_type?: string
        nodes: RawPipelineNode[]; edges: RawPipelineEdge[]
      }
      setPipelineName(data.name)
      setPipelineDesc(data.description ?? '')
      setInputType((data.input_type as 'text' | 'audio') ?? 'text')
      setEditingId(id)
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      setSaveError('')
      setIsDirty(false)

      const hasPositions = data.nodes.some(n => n.position_x != null && n.position_y != null)
      const flowNodes: Node[] = data.nodes.map((n, i) => ({
        id: String(n.id),
        type: 'agent',
        position: hasPositions
          ? { x: n.position_x ?? i * 220 + 50, y: n.position_y ?? 100 }
          : { x: i * 220 + 50, y: 100 },
        data: {
          agentId: n.agent_id,
          agentName: n.agent?.name ?? 'Unknown',
          agentType: (n.node_agent_type as AgentNodeData['agentType']) ?? agents.find(a => a.id === n.agent_id)?.agent_type,
          nodeKey: n.node_key,
          inputTopic: n.agent?.input_topic ?? '',
          outputTopic: n.agent?.output_topic ?? '',
          maxRetries: n.max_retries,
          onFailure: n.on_failure,
          configOverride: n.config_override ?? {},
        } satisfies AgentNodeData,
      }))

      const keyToId: Record<string, string> = {}
      data.nodes.forEach(n => { keyToId[n.node_key] = String(n.id) })

      const flowEdges: Edge[] = data.edges.map(e => {
        const srcId = keyToId[e.source_node_key] ?? ''
        const tgtId = keyToId[e.target_node_key] ?? ''
        const srcNode = flowNodes.find(n => n.id === srcId)
        const tgtNode = flowNodes.find(n => n.id === tgtId)
        const srcOut = (srcNode?.data as AgentNodeData | undefined)?.outputTopic ?? ''
        const tgtIn = (tgtNode?.data as AgentNodeData | undefined)?.inputTopic ?? ''
        const edgeType = (e.edge_type ?? 'sequential') as EdgeData['edgeType']
        const { style, markerEnd } = computeEdgeStyle(srcOut, tgtIn, edgeType)
        const edgeData: EdgeData = {
          edgeType,
          waitForGroup: e.wait_for_group ?? '',
          isOptional: e.is_optional ?? false,
        }
        return { id: String(e.id), source: srcId, target: tgtId, style, markerEnd, data: edgeData }
      })

      setNodes(flowNodes)
      setEdges(flowEdges)
      setMode('builder')
    } catch {
      setListError('Failed to load pipeline.')
    } finally {
      setTimeout(() => { isLoadingRef.current = false }, 100)
    }
  }

  function handleNew() {
    isLoadingRef.current = true
    setEditingId(null)
    setPipelineName('')
    setPipelineDesc('')
    setNodes([])
    setEdges([])
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setSaveError('')
    setIsDirty(false)
    setMode('builder')
    setTimeout(() => { isLoadingRef.current = false }, 100)
  }

  function handleBack() {
    if (isDirty) {
      setShowBackDialog(true)
      return
    }
    setIsDirty(false)
    setMode('list')
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const invalidEdges = getInvalidEdges()
  const selectedNode = nodes.find(n => n.id === selectedNodeId)
  const selectedNodeData = selectedNode?.data as AgentNodeData | undefined
  const selectedEdge = edges.find(e => e.id === selectedEdgeId)
  const selectedEdgeData = selectedEdge?.data as EdgeData | undefined
  const validation = showValidate ? validatePipeline() : null
  const rightPanel: 'node' | 'edge' | null =
    selectedNodeData ? 'node' : selectedEdgeData ? 'edge' : null

  // ═══════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ═══════════════════════════════════════════════════════════════════════

  if (mode === 'list') {
    return (
      <PipelineListView
        pipelines={pipelines}
        agents={agents}
        saveSuccess={saveSuccess}
        listError={listError}
        onListErrorClear={() => setListError('')}
        onNew={handleNew}
        onEdit={handleEdit}
        onRefresh={loadPipelines}
      />
    )
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BUILDER VIEW
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div>
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 mb-4">
        <PageHeader title="Pipelines" />
        <Button
          onClick={handleBack}
          variant="ghost"
          size="sm"
          icon={<ChevronLeft size={16} />}
          className="shrink-0 text-slate-500 hover:text-slate-800"
        >
          {isDirty ? <span className="text-amber-500">Back*</span> : 'Back'}
        </Button>
        <div className="h-5 w-px bg-slate-200 shrink-0" />
        <input
          value={pipelineName}
          onChange={e => setPipelineName(e.target.value)}
          placeholder="Pipeline name…"
          className="text-base font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-teal-500 focus:outline-none px-1 py-0.5 w-48 shrink-0"
        />
        <input
          value={pipelineDesc}
          onChange={e => setPipelineDesc(e.target.value)}
          placeholder="Description (optional)"
          className="text-sm text-slate-500 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-teal-400 focus:outline-none px-1 py-0.5 flex-1 min-w-0"
        />
        <CustomSelect
          value={inputType}
          onChange={val => setInputType(val as 'text' | 'audio')}
          options={[
            { value: 'text', label: 'Input: Text' },
            { value: 'audio', label: 'Input: Audio' },
          ]}
          className="w-36 shrink-0"
        />

        {edges.length > 0 && (
          <div className={cn(
            'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full shrink-0',
            invalidEdges.length === 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700',
          )}>
            {invalidEdges.length === 0
              ? <><CheckCircle size={13} /> Compatible</>
              : <><AlertTriangle size={13} /> {invalidEdges.length} warning{invalidEdges.length > 1 ? 's' : ''}</>}
          </div>
        )}

        <Button
          onClick={handleAutoLayout}
          disabled={nodes.length === 0}
          variant="outline"
          size="sm"
          icon={<GitBranch size={15} />}
          className="shrink-0"
        >
          Layout
        </Button>

        <Button
          onClick={() => setShowValidate(v => !v)}
          variant={showValidate ? 'primary' : 'outline'}
          size="sm"
          icon={<ClipboardList size={15} />}
          className="shrink-0"
        >
          Validate
        </Button>

        <Button
          onClick={() => setShowTestRun(true)}
          disabled={!editingId}
          title={!editingId ? 'Save pipeline first' : 'Test run'}
          variant="success"
          size="sm"
          icon={<Play size={15} />}
          className="shrink-0"
        >
          Test
        </Button>

        <Button
          onClick={handleSave}
          loading={saving}
          variant="primary"
          size="sm"
          icon={<Save size={15} />}
          className="shrink-0 shadow-sm"
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {saveError && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start justify-between gap-2">
          <span className="whitespace-pre font-mono">{saveError}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSaveError('')}
            className="shrink-0 p-1 min-h-0 min-w-0"
            icon={<X size={13} />}
          />
        </div>
      )}

      {saveSuccess && (
        <div className="mb-3 p-3 bg-green-50 dark:bg-emerald-950/20 dark:border dark:border-emerald-800/20 rounded-lg text-xs text-green-700 dark:text-emerald-400 flex items-center gap-2">
          <CheckCircle size={14} className="text-green-600 dark:text-emerald-400" /> Pipeline saved.
        </div>
      )}

      {/* ── Validate panel ── */}
      {showValidate && validation && (
        <div className="mb-3 bg-white border border-slate-200 rounded-xl p-4 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {validation.valid
                ? <CheckCircle size={16} className="text-green-600 dark:text-emerald-400" />
                : <AlertTriangle size={16} className="text-amber-500" />}
              <span className="text-sm font-bold text-slate-800 dark:text-white">
                {validation.valid ? 'Pipeline is valid' : 'Validation issues found'}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowValidate(false)}
              className="text-slate-400 hover:text-slate-600 p-1 min-h-0 min-w-0"
              icon={<X size={15} />}
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {validation.checks.map((check, i) => (
              <div key={i} className={cn('flex items-start gap-2 p-2 rounded-lg text-xs', 
                check.ok 
                  ? 'bg-green-50 dark:bg-emerald-950/20 dark:border dark:border-emerald-800/20' 
                  : 'bg-red-50 dark:bg-rose-950/20 dark:border dark:border-rose-900/20'
              )}>
                {check.ok
                  ? <CheckCircle size={13} className="text-green-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  : <AlertTriangle size={13} className="text-red-500 dark:text-rose-400 shrink-0 mt-0.5" />}
                <div>
                  <p className={cn('font-semibold', check.ok ? 'text-green-800 dark:text-emerald-300' : 'text-red-700 dark:text-rose-300')}>{check.label}</p>
                  {check.detail && <p className="text-red-600 dark:text-rose-400 mt-0.5 whitespace-pre-wrap font-mono">{check.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Edge legend ── */}
      <div className="flex items-center gap-5 mb-3 text-[10px] font-semibold text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-green-500" /> Sequential
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed border-amber-400" /> Fan-out
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed border-purple-500" /> Merger input
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-red-400" /> Topic mismatch
        </span>
        <span className="text-slate-300">· Click edge to configure type</span>
      </div>

      {/* ── Canvas area ── */}
      <div className="flex gap-3" style={{ height: '68vh' }}>
        <PipelinePalette
          agents={agents}
          paletteSearch={paletteSearch}
          onSearchChange={setPaletteSearch}
          onDragStart={onDragStart}
        />

        <div ref={rfWrapperRef} className="flex-1 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(inst) => { rfInstanceRef.current = inst }}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            colorMode={resolvedTheme}
            fitView
            deleteKeyCode="Delete"
          >
            <Background gap={20} color={resolvedTheme === 'dark' ? '#475569' : '#e2e8f0'} />
            <Controls />
            <MiniMap nodeColor={() => '#0d9488'} maskColor={resolvedTheme === 'dark' ? 'rgba(15,23,42,0.7)' : 'rgba(248,250,252,0.7)'} />
          </ReactFlow>
        </div>

        {rightPanel === 'node' && selectedNodeData && (
          <PipelineNodeConfigPanel
            data={selectedNodeData}
            configOverrideText={configOverrideText}
            configJsonError={configJsonError}
            onClose={() => setSelectedNodeId(null)}
            onUpdate={updateSelectedNode}
            onConfigChange={handleConfigOverrideChange}
            onDelete={deleteSelectedNode}
          />
        )}
        {rightPanel === 'edge' && selectedEdgeData && (
          <PipelineEdgeConfigPanel
            data={selectedEdgeData}
            onClose={() => setSelectedEdgeId(null)}
            onUpdate={updateSelectedEdge}
            onDelete={deleteSelectedEdge}
          />
        )}
      </div>

      {/* ── API Preview Bar ── */}
      <PipelineApiPreview
        pipelineName={pipelineName || 'untitled'}
        pipelineId={editingId || undefined}
        inputType={inputType}
      />

      {showTestRun && editingId && (
        <PipelineTestRunModal
          pipelineName={pipelineName}
          pipelineId={editingId}
          inputType={inputType}
          onClose={() => setShowTestRun(false)}
        />
      )}

      <CustomDialog
        isOpen={showBackDialog}
        onClose={() => setShowBackDialog(false)}
        onConfirm={() => {
          setShowBackDialog(false)
          setIsDirty(false)
          setMode('list')
        }}
        title="Unsaved Changes"
        description="You have unsaved changes. Are you sure you want to leave without saving?"
        confirmText="Leave"
        cancelText="Stay"
        type="confirm"
      />
    </div>
  )
}

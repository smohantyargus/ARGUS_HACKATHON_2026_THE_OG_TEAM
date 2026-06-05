// Raw API response shapes
export interface RegistryAgentRaw {
  id: number
  name: string
  input_topic: string
  output_topic: string
  version?: string
  is_active: boolean
}

export interface GenericAgentRaw {
  id: string
  name: string
  input_topic: string
  output_topic: string
  is_active: boolean
}

export interface MergerRaw {
  id: string
  name: string
  input_topic_map: Record<string, string>
  output_topic: string
  is_active: boolean
}

// Discriminated union — each variant carries only fields relevant to its type
export type RegistryAgentInfo = {
  agent_type: 'registry'
  id: number
  name: string
  input_topic: string
  output_topic: string
  version?: string
  is_active: boolean
}

export type GenericAgentInfo = {
  agent_type: 'generic_llm'
  id: string
  name: string
  input_topic: string
  output_topic: string
  is_active: boolean
}

export type MergerAgentInfo = {
  agent_type: 'output_merger'
  id: string
  name: string
  input_topic: string
  output_topic: string
  is_active: boolean
  input_topic_map: Record<string, string>
}

export type AgentInfo = RegistryAgentInfo | GenericAgentInfo | MergerAgentInfo

export interface PipelineSummary {
  id: string
  name: string
  description?: string
  input_type?: string
  version: number
  is_active: boolean
  created_at?: string
}

export interface PipelineVersion {
  id: string
  version: number
  created_at: string
  snapshot?: {
    name: string
    description?: string
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
  }
}

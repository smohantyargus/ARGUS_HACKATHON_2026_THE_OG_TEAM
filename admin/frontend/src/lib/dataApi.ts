import axios, { type InternalAxiosRequestConfig } from 'axios'

const TOKEN_KEY = 'civis_token'

/** DataQueryAgent REST API (proxied via /api/data -> data_query_agent:8020/api/data) */
export const dataApi = axios.create({ baseURL: '/api/data', withCredentials: true })

dataApi.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = sessionStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Types ────────────────────────────────────────────────────────────────────

export interface Domain {
  domain_key: string
  name: string
  description: string | null
  status: string
  owner_user_id: string | null
  created_at: string | null
  updated_at: string | null
}

export interface EntityDefinition {
  id: number
  domain_key: string
  entity_key: string
  display_name: string | null
  description: string | null
  is_root: boolean
  parent_entity: string | null
  strict: boolean
}

export interface FieldDefinition {
  id: number
  entity_id: number
  field_key: string
  data_type: string
  required: boolean
  default_value: unknown
  enum_values: string[] | null
  ref_entity: string | null
  min_value: number | null
  max_value: number | null
  max_length: number | null
  unit: string | null
  description: string | null
}

export interface QueryDefinition {
  id: number
  domain_key: string
  query_key: string
  entity_key: string
  filter_spec: Record<string, string> | null
  projection: string[] | null
  join_spec: { entity_key: string }[] | null
  description: string | null
}

export interface DomainMember {
  id: number
  domain_key: string
  user_id: string
  role: string
}

export interface DomainRecord {
  id: number
  domain_key: string
  entity_key: string
  record_key: string | null
  parent_id: number | null
  data: Record<string, unknown>
  created_at: string | null
  updated_at: string | null
}

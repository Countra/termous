export type SystemServiceCapabilityStatus = 'ready' | 'read_only' | 'unsupported' | 'manager_unavailable' | 'unknown'

export type SystemServiceManageMode = 'direct' | 'sudo' | 'read_only'

export type SystemServiceRuntimeFilter = '' | 'running' | 'stopped' | 'active' | 'inactive' | 'failed' | 'activating' | 'deactivating' | 'reloading' | 'maintenance' | 'refreshing'

export type SystemServiceSort = 'name' | 'description' | 'runtime' | 'unit_file'

export type SystemServiceAction = 'start' | 'stop' | 'restart' | 'reload' | 'reset_failed' | 'enable' | 'disable' | 'mask' | 'unmask'

export type SystemServiceOperationPhase = 'queued' | 'enqueued' | 'verifying' | 'succeeded' | 'failed' | 'uncertain' | 'cancelled'

export interface SystemServiceCapability {
  provider: string
  available: boolean
  manageable: boolean
  status: SystemServiceCapabilityStatus
  message?: string
  version?: string
  manager_state?: string
  manage_mode: SystemServiceManageMode
  journal_readable: boolean
  warnings: string[]
  collected_at: string
}

export interface SystemServiceQuery {
  query?: string
  runtime_state?: SystemServiceRuntimeFilter
  unit_file_state?: string
  sort?: SystemServiceSort
  order?: 'asc' | 'desc'
  limit?: number
}

export interface SystemServiceSummary {
  id: string
  names: string[]
  description?: string
  load_state: string
  active_state: string
  sub_state: string
  unit_file_state: string
  template: boolean
}

export interface SystemServiceListResult {
  items: SystemServiceSummary[]
  total: number
  filtered: number
  running: number
  failed: number
  collected_at: string
  warnings: string[]
}

export interface SystemServiceDetail {
  summary: SystemServiceSummary
  main_pid: number
  control_pid: number
  result?: string
  exec_main_code?: string
  exec_main_status: number
  restart_count: number
  can_start: boolean
  can_stop: boolean
  can_reload: boolean
  refuse_manual_start: boolean
  refuse_manual_stop: boolean
  fragment_path?: string
  drop_in_paths: string[]
  user?: string
  group?: string
  working_directory?: string
  exec_start?: string
  restart_policy?: string
  type?: string
  active_duration_seconds: number
  memory_current_bytes?: number
  tasks_current?: number
  cpu_usage_nanoseconds?: number
  warnings: string[]
  collected_at: string
}

export interface SystemServiceLogQuery {
  limit?: number
  priority?: string
  boot?: 'current' | 'all'
  after_cursor?: string
}

export interface SystemServiceLogEntry {
  cursor?: string
  timestamp: string
  priority: number
  message: string
  pid?: number
  command?: string
}

export interface SystemServiceLogsResult {
  entries: SystemServiceLogEntry[]
  cursor?: string
  collected_at: string
  warnings: string[]
}

export interface SystemServiceActionRequest {
  action: SystemServiceAction
}

export interface SystemServiceOperation {
  id: string
  revision: number
  session_id: string
  unit_id: string
  action: SystemServiceAction
  phase: SystemServiceOperationPhase
  message: string
  error_code?: string
  state?: SystemServiceSummary
  started_at: string
  updated_at: string
  completed_at?: string
}

export type CrontabCapabilityStatus =
  | 'ready'
  | 'read_only'
  | 'permission_denied'
  | 'unsupported'
  | 'unavailable'
  | 'unknown'

export type CrontabScheduleKind = 'standard' | 'macro'

export interface CrontabCapability {
  status: CrontabCapabilityStatus
  available: boolean
  readable: boolean
  writable: boolean
  username: string
  warnings: string[]
  checked_at: string
}

export interface CrontabJob {
  id: string
  line_number: number
  enabled: boolean
  schedule_kind: CrontabScheduleKind
  expression: string
  command: string
  editable: boolean
  warnings: string[]
}

export interface CrontabSnapshot {
  session_id: string
  username: string
  exists: boolean
  revision: string
  jobs: CrontabJob[]
  unmanaged_line_count: number
  warnings: string[]
  collected_at: string
  content?: string
}

export interface CrontabJobInput {
  expected_revision: string
  schedule: string
  command: string
  enabled: boolean
}

export interface CrontabContentInput {
  expected_revision: string
  content: string
}

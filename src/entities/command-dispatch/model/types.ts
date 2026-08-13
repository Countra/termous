export type CommandDispatchScope = 'current' | 'selected' | 'all'

export type CommandDispatchTaskStatus =
  | 'queued'
  | 'validating'
  | 'running'
  | 'interrupting'
  | 'completed'
  | 'partial_failed'
  | 'failed'
  | 'interrupted'

export type CommandDispatchTargetStatus =
  | 'queued'
  | 'validating'
  | 'running'
  | 'interrupting'
  | 'succeeded'
  | 'failed'
  | 'interrupted'
  | 'rejected'
  | 'disconnected'
  | 'uncertain'
  | 'completed_unknown'

export type CommandDispatchOutputGapReason =
  | 'epoch_mismatch'
  | 'buffer_evicted'
  | 'offset_ahead'

export interface CommandDispatchTaskInput {
  scope: CommandDispatchScope
  command: string
  target_session_ids: string[]
  client_request_id: string
}

export interface CommandDispatchInputLock {
  locked: boolean
  owner?: 'command_dispatch'
  task_id?: string
  locked_at?: string
}

export interface CommandDispatchOutputStream {
  epoch: string
  oldest_offset: string
  next_offset: string
  resume_offset: string
  truncated: boolean
}

export interface CommandDispatchTarget {
  session_id: string
  session_name?: string
  host_id?: string
  host_name?: string
  endpoint?: string
  index: number
  status: CommandDispatchTargetStatus
  status_message?: string
  input_lock: CommandDispatchInputLock
  exit_code_known: boolean
  exit_code?: number
  output_stream: CommandDispatchOutputStream
  started_at?: string
  finished_at?: string
  error_code?: string
  error_message?: string
}

export interface CommandDispatchTask {
  id: string
  client_request_id: string
  revision: number
  scope: CommandDispatchScope
  status: CommandDispatchTaskStatus
  status_message?: string
  command: string
  target_session_ids: string[]
  targets: CommandDispatchTarget[]
  total_targets: number
  completed_targets: number
  succeeded_targets: number
  failed_targets: number
  interrupted_targets: number
  rejected_targets: number
  unknown_targets: number
  interruptible: boolean
  created_at: string
  started_at?: string
  finished_at?: string
  error_code?: string
  error_message?: string
}

export interface CommandDispatchTaskEvent {
  type: 'command_dispatch_task_snapshot' | 'command_dispatch_task_update'
  task: CommandDispatchTask
}

export interface CommandDispatchOutputAttachedEvent {
  type: 'output_attached'
  task_id: string
  session_id: string
  target: CommandDispatchTarget
  stream: CommandDispatchOutputStream
  reason?: CommandDispatchOutputGapReason
  ended: boolean
}

export interface CommandDispatchOutputGapEvent {
  type: 'output_gap'
  reason: CommandDispatchOutputGapReason
  stream: CommandDispatchOutputStream
}

export interface CommandDispatchOutputEndedEvent {
  type: 'output_ended'
  target: CommandDispatchTarget
  stream: CommandDispatchOutputStream
}

export type CommandDispatchEvent =
  | CommandDispatchTaskEvent
  | CommandDispatchOutputAttachedEvent
  | CommandDispatchOutputGapEvent
  | CommandDispatchOutputEndedEvent

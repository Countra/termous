export type AliasBridgeStatus = 'missing' | 'installed'

export type AliasApplyStatus = 'applied' | 'next_prompt' | 'reconnect_required'

export interface ShellAlias {
  id: string
  name: string
  command: string
  description?: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface ShellAliasInput {
  name: string
  command: string
  description: string
  enabled: boolean
}

export type ShellAliasPatch = Partial<ShellAliasInput>

export interface AliasWorkspace {
  shell: 'bash' | 'zsh' | 'fish'
  bridge_status: AliasBridgeStatus
  items: ShellAlias[]
}

export interface AliasMutationResult {
  workspace: AliasWorkspace
  alias?: ShellAlias
  apply_status: AliasApplyStatus
}

export type AliasSyncTaskStatus =
  | 'queued'
  | 'loading_source'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'partial_failed'
  | 'failed'
  | 'cancelled'

export type AliasSyncTargetStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'skipped'
  | 'failed'
  | 'cancelled'
  | 'uncertain'

export type AliasSyncTargetPhase =
  | 'resolving'
  | 'connecting'
  | 'waiting_host_trust'
  | 'reading'
  | 'merging'
  | 'committing'

export type AliasSyncSkipReason = 'no_changes' | 'shell_mismatch'

export interface AliasSyncTaskInput {
  alias_ids: string[]
  target_host_ids: string[]
}

export interface AliasSyncTaskSource {
  session_id: string
  host_id?: string
  host_name?: string
  address?: string
  port?: number
  username?: string
  shell?: 'bash' | 'zsh' | 'fish'
}

export interface AliasSyncTarget {
  id: string
  host_id: string
  host_name?: string
  address?: string
  port?: number
  username?: string
  index: number
  status: AliasSyncTargetStatus
  phase?: AliasSyncTargetPhase
  phase_message?: string
  detected_shell?: 'bash' | 'zsh' | 'fish'
  added_count: number
  added_names: string[]
  skipped_count: number
  skipped_names: string[]
  skip_reason?: AliasSyncSkipReason
  apply_status?: AliasApplyStatus
  error_code?: string
  error_message?: string
  started_at?: string
  finished_at?: string
}

export interface AliasSyncTask {
  id: string
  revision: number
  status: AliasSyncTaskStatus
  status_message?: string
  source: AliasSyncTaskSource
  alias_ids: string[]
  target_host_ids: string[]
  targets: AliasSyncTarget[]
  current_target_index?: number
  total_targets: number
  completed_targets: number
  succeeded_targets: number
  skipped_targets: number
  failed_targets: number
  cancelled_targets: number
  uncertain_targets: number
  progress_percent: number
  cancellable: boolean
  created_at: string
  started_at?: string
  finished_at?: string
  error_code?: string
  error_message?: string
}

export interface AliasSyncTaskEvent {
  type: 'alias_sync_task_update'
  task: AliasSyncTask
}

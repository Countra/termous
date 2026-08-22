import type { AppConfig } from './application'

export type DataPortabilityDatasetKey =
  | 'host_groups'
  | 'host_icons'
  | 'credentials'
  | 'connection_proxies'
  | 'hosts'
  | 'host_key_trust_records'
  | 'terminal_fonts'
  | 'settings'
  | 'code_snippet_groups'
  | 'code_snippets'
  | 'file_bookmark_groups'
  | 'file_bookmarks'
  | 'local_path_mappings'
  | 'file_rename_presets'
  | 'forward_profiles'
  | 'firewall_disabled_rules'

export interface DataPortabilityDatasetSummary {
  key: DataPortabilityDatasetKey
  count: number
}

export interface DataPortabilitySummary {
  datasets: DataPortabilityDatasetSummary[]
  total_items: number
  asset_count: number
  asset_bytes: number
}

export interface DataPortabilityWarning {
  code: string
  dataset?: DataPortabilityDatasetKey
  item_id?: string
  label?: string
}

export interface DataPortabilityImport extends DataPortabilitySummary {
  import_id: string
  source_app_version: string
  created_at: string
  expires_at: string
  warnings: DataPortabilityWarning[]
}

export interface DataPortabilityExportDialogResult {
  canceled: boolean
  file_name?: string
}

export interface DataPortabilityImportDialogResult {
  canceled: boolean
  inspection?: DataPortabilityImport
}

export interface DataPortabilityImportSelectionResult {
  canceled: boolean
  selection_id?: string
  file_name?: string
  size_bytes?: number
}

export interface DataPortabilityRestartResult {
  restarted: boolean
  requires_manual_restart: boolean
  config: AppConfig
}

export interface DataPortabilityProgress {
  operation: 'export' | 'import'
  phase: 'selecting' | 'transferring' | 'finalizing' | 'complete'
  transferred_bytes?: number
  total_bytes?: number
}

export type DataPortabilityRestoreMode = 'replace_all' | 'merge_all' | 'selective'

export type DataPortabilityPlanStatus =
  | 'added'
  | 'unchanged'
  | 'conflict'
  | 'dependency'
  | 'skipped'
  | 'removed'

export type DataPortabilityResolution = 'keep_current' | 'use_backup' | 'keep_both'

export interface DataPortabilityItemRef {
  dataset: DataPortabilityDatasetKey
  id: string
}

export interface DataPortabilityFieldDifference {
  field: string
  current?: unknown
  backup?: unknown
  sensitive?: boolean
}

export interface DataPortabilityPlanItem {
  key: string
  reference: DataPortabilityItemRef
  current_id?: string
  label: string
  status: DataPortabilityPlanStatus
  reason?: string
  dependency?: boolean
  required_by?: string[]
  differences?: DataPortabilityFieldDifference[]
  allowed_actions?: DataPortabilityResolution[]
  resolution?: DataPortabilityResolution
  remapped_id?: string
  automatic_alias_id?: string
}

export interface DataPortabilityPlanSummary {
  total: number
  unresolved: number
  by_status: Partial<Record<DataPortabilityPlanStatus, number>>
  by_dataset: Partial<Record<DataPortabilityDatasetKey, number>>
}

export interface DataPortabilityRestorePlan {
  id: string
  revision: number
  mode: DataPortabilityRestoreMode
  target_fingerprint: string
  backup_fingerprint: string
  items: DataPortabilityPlanItem[]
  summary: DataPortabilityPlanSummary
}

export interface DataPortabilityPlanRequest {
  mode: DataPortabilityRestoreMode
  selected_datasets?: DataPortabilityDatasetKey[]
  selected_items?: DataPortabilityItemRef[]
}

export interface DataPortabilityPlanItemPage {
  items: DataPortabilityPlanItem[]
  next_cursor?: string
  total: number
}

export interface DataPortabilityPlanItemQuery {
  dataset?: DataPortabilityDatasetKey
  status?: DataPortabilityPlanStatus
  cursor?: string
  limit?: number
}

export interface DataPortabilityResolutionRequest {
  expected_revision: number
  action: DataPortabilityResolution
  item_keys?: string[]
  dataset?: DataPortabilityDatasetKey
}

export interface DataPortabilityApplyResult {
  import_id: string
  operation_id: string
  restart_required: boolean
  state: 'applied'
}

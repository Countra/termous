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

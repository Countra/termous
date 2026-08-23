export type FileNameSearchCapabilityStatus =
  | 'ready'
  | 'missing'
  | 'outdated'
  | 'unsupported'

export type FileNameSearchEntryType = 'all' | 'file' | 'directory'

export type FileNameSearchMatchMode = 'literal' | 'regex' | 'glob'

export type FileNameSearchCaseMode = 'insensitive' | 'smart' | 'sensitive'

export type FileNameSearchMatchTarget = 'name' | 'full_path'

export type FileNameSearchHiddenMode = 'include' | 'exclude'

export type FileNameSearchIgnoreMode = 'bypass' | 'respect'

export type FileNameSearchInstallPrivilege = 'root' | 'sudo' | 'none'

export interface FileNameSearchInstallCommand {
  id: string
  title: string
  command: string
}

export interface FileNameSearchInstallPlan {
  automatic: boolean
  privilege: FileNameSearchInstallPrivilege
  plan_hash: string
  commands: FileNameSearchInstallCommand[]
  manual_commands: string[]
  warnings: string[]
}

export interface FileNameSearchCapability {
  connection_generation: number
  status: FileNameSearchCapabilityStatus
  executable?: string
  version?: string
  minimum_version: string
  distribution?: string
  package_manager?: string
  privilege: FileNameSearchInstallPrivilege
  install_available: boolean
  install_plan?: FileNameSearchInstallPlan
  message?: string
}

export interface FileNameSearchRequest {
  expected_connection_generation: number
  query: string
  entry_type: FileNameSearchEntryType
  one_file_system: boolean
  limit: number
  search_root?: string
  match_mode?: FileNameSearchMatchMode
  case_mode?: FileNameSearchCaseMode
  match_target?: FileNameSearchMatchTarget
  hidden_mode?: FileNameSearchHiddenMode
  ignore_mode?: FileNameSearchIgnoreMode
  max_depth?: number
  extensions?: string[]
  exclude_globs?: string[]
  modified_after?: string
  modified_before?: string
  min_size_bytes?: number
  max_size_bytes?: number
}

export interface FileNameSearchResultItem {
  path: string
  name: string
  parent_path: string
}

export interface FileNameSearchResult {
  items: FileNameSearchResultItem[]
  returned_count: number
  truncated: boolean
  partial: boolean
  timed_out: boolean
  skipped_invalid_utf8: number
  duration_ms: number
  connection_generation: number
  one_file_system: boolean
}

export interface FileNameSearchInstallRequest {
  expected_connection_generation: number
  expected_plan_hash: string
  confirmed: true
}

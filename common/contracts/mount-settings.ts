export interface MountSettings {
  cache_directory: string
  cache_max_bytes: number
  cache_min_free_bytes: number
}

export interface MountSettingsState extends MountSettings {
  default_directory: string
  active_cache_directory: string
  active_cache_max_bytes: number
  active_cache_min_free_bytes: number
  next_cache_directory: string
  restart_required: boolean
  startup_warning?: string
}

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

export interface MountCacheClear {
  id: string
  state: 'idle' | 'accepted' | 'running' | 'completed' | 'failed'
  freed_bytes: number
  error?: string
  started_at?: string
  finished_at?: string
}

export interface MountCacheState {
  persistent: boolean
  limit_bytes: number
  used_bytes: number
  clean_bytes: number
  private_bytes: number
  reclaimable_bytes: number
  index_bytes: number
  warning?: string
  clear: MountCacheClear
}

import type { Dispatch, SetStateAction } from 'react'
import type { AppData } from './appData'

export interface CoreRuntimeInfo {
  name: string
  version: string
  pid: number
  addr: string
  uptime_seconds: number
  heartbeat_enabled: boolean
  heartbeat_timeout_ms: number
  last_heartbeat_at: string
  shutdown_in_progress: boolean
  shutdown_reason?: string
  shutdown_started_at?: string
}

export interface StorageStatus {
  databases: {
    domain: 'core' | 'agent' | 'workflows' | 'audit'
    status: 'ready' | 'unavailable'
    code?: string
    version?: number
    diagnostics_code?: string
    metrics?: {
      measured_at: string
      database_bytes: number
      wal_bytes: number
      free_page_bytes: number
      tracked_asset_bytes: number
    }
  }[]
  configuration_compaction?: 'pending' | 'running' | 'done' | 'deferred'
}

export interface MutableValue<T> {
  current: T
}

export type SetAppData = Dispatch<SetStateAction<AppData>>
export type SetRuntimeState<T> = Dispatch<SetStateAction<T>>

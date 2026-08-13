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

export interface MutableValue<T> {
  current: T
}

export type SetAppData = Dispatch<SetStateAction<AppData>>
export type SetRuntimeState<T> = Dispatch<SetStateAction<T>>

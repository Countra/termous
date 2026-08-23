export type ForwardMode = 'local' | 'remote' | 'dynamic'

export type ForwardScope = 'session' | 'background_once' | 'background_profile'

export type ForwardStatus = 'starting' | 'waiting_host_trust' | 'running' | 'reconnecting' | 'stopping' | 'stopped' | 'failed'

export type ForwardPhase =
  | 'queued'
  | 'resolving_session'
  | 'resolving_auth'
  | 'dialing_ssh'
  | 'waiting_host_trust'
  | 'starting_listener'
  | 'ready'
  | 'waiting_retry'
  | 'stopping'
  | 'stopped'
  | 'failed'

export interface ForwardProfile {
  id: string
  name: string
  description?: string
  mode: ForwardMode
  host_id: string
  bind_host: string
  bind_port: number
  target_host?: string
  target_port?: number
  created_at: string
  updated_at: string
}

export interface ForwardProfileInput {
  name: string
  description: string
  mode: ForwardMode
  host_id: string
  bind_host: string
  bind_port: number
  target_host: string
  target_port: number
}

export interface ForwardStartRequest {
  profile_id?: string
  scope?: ForwardScope
  session_id?: string
  host_id?: string
  name?: string
  description?: string
  mode?: ForwardMode
  bind_host?: string
  bind_port?: number
  target_host?: string
  target_port?: number
}

export interface ForwardInstance {
  id: string
  profile_id?: string
  session_id?: string
  host_id?: string
  name: string
  description?: string
  mode: ForwardMode
  scope: ForwardScope
  status: ForwardStatus
  phase: ForwardPhase
  progress: number
  status_message?: string
  host_key_challenge_id?: string
  bind_host: string
  bind_port: number
  bound_address?: string
  target_host?: string
  target_port?: number
  target_address?: string
  active_connections: number
  total_connections: number
  bytes_in: number
  bytes_out: number
  started_at: string
  stopped_at?: string
  last_error?: string
  reconnect_attempt?: number
  reconnect_max_attempts?: number
  next_reconnect_at?: string
}

export interface ForwardEvent {
  type: string
  forward: ForwardInstance
  message?: string
}

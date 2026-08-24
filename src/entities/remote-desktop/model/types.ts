export type RemoteDesktopProtocol = 'vnc'

export type RemoteDesktopTransport = 'ssh_tunnel'

export type RemoteDesktopDisplayMode = 'fit' | 'resize' | 'actual'

export type RemoteDesktopSessionStatus =
  | 'connecting'
  | 'waiting_host_trust'
  | 'ready'
  | 'streaming'
  | 'reattach_wait'
  | 'reconnecting'
  | 'stopping'
  | 'failed'

export type RemoteDesktopSessionPhase =
  | 'queued'
  | 'resolving_auth'
  | 'dialing_ssh'
  | 'waiting_host_trust'
  | 'ready'
  | 'dialing_target'
  | 'streaming'
  | 'waiting_reattach'
  | 'waiting_retry'
  | 'stopping'
  | 'failed'

export interface VncProfileSettings {
  loopback_host: '127.0.0.1' | '::1'
  port: number
  shared: boolean
  default_view_only: boolean
  default_display_mode: RemoteDesktopDisplayMode
}

export interface RemoteDesktopProfile {
  id: string
  name: string
  description: string
  protocol: RemoteDesktopProtocol
  transport: RemoteDesktopTransport
  ssh_host_id: string
  vnc: VncProfileSettings
  created_at: string
  updated_at: string
}

export interface RemoteDesktopProfileInput {
  name: string
  description: string
  protocol: RemoteDesktopProtocol
  transport: RemoteDesktopTransport
  ssh_host_id: string
  vnc: VncProfileSettings
}

export interface RemoteDesktopSession {
  id: string
  profile_id: string
  profile_name: string
  ssh_host_id: string
  ssh_host_name: string
  protocol: RemoteDesktopProtocol
  vnc: VncProfileSettings
  status: RemoteDesktopSessionStatus
  phase: RemoteDesktopSessionPhase
  status_message?: string
  host_key_challenge_id?: string
  connection_generation: number
  viewer_attached: boolean
  reconnect_attempt?: number
  reconnect_max_attempts?: number
  next_reconnect_at?: string
  created_at: string
  updated_at: string
  last_error?: string
  error_code?: string
}

export interface RemoteDesktopAttachTicket {
  ticket: string
  expires_at: string
  connection_generation: number
  stream_path: string
}

export type RemoteDesktopSessionEvent =
  | {
      type: 'snapshot'
      sessions: RemoteDesktopSession[]
    }
  | {
      type: 'upsert'
      session: RemoteDesktopSession
    }
  | {
      type: 'removed'
      session: Pick<RemoteDesktopSession, 'id'>
    }
  | RemoteDesktopTelemetryEvent

export interface RemoteDesktopTelemetryEvent {
  type: 'telemetry'
  session_id: string
  connection_generation: number
  ssh_rtt_ms: number
  sampled_at: string
}

export type VncCredentialType = 'username' | 'password' | 'target'

export type VncCredentials = Partial<Record<VncCredentialType, string>>

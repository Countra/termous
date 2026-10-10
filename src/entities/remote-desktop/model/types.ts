import type { DesktopState } from './desktop.ts'

export type RemoteDesktopProtocol = 'vnc' | 'rdp'

export type RemoteDesktopRoute = 'ssh_tunnel' | 'direct'

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
  target_host: string
  port: number
  shared: boolean
  default_view_only: boolean
  default_display_mode: RemoteDesktopDisplayMode
}

export interface RemoteDesktopTargetAuthSummary {
  credential_id: string
  updated_at: string
}

export interface RdpProfileSettings {
  target_host: string
  port: number
  server_name: string
  username: string
  domain: string
  width: number
  height: number
  audio: boolean
  default_view_only: boolean
  default_display_mode: RemoteDesktopDisplayMode
}

export interface RdpAttachment {
  subscription_id: string
  control_url: string
  display_url: string
  control_ticket: string
  display_ticket: string
}

interface RemoteDesktopAccessProfileBase {
  id: string
  host_id: string
  name: string
  description: string
  is_default: boolean
  sort_order: number
  target_auth: RemoteDesktopTargetAuthSummary | null
  created_at: string
  updated_at: string
}

interface RemoteDesktopSSHTunnelRoute {
  route: 'ssh_tunnel'
  route_config_version: 1
  ssh_profile_id: string
}

interface RemoteDesktopDirectRoute {
  route: 'direct'
  route_config_version: 1
  ssh_profile_id?: never
}

type RemoteDesktopRouteConfiguration =
  | RemoteDesktopSSHTunnelRoute
  | RemoteDesktopDirectRoute

export type VncRemoteDesktopAccessProfile = RemoteDesktopAccessProfileBase
  & RemoteDesktopRouteConfiguration
  & {
    protocol: 'vnc'
    protocol_config_version: 1
    vnc: VncProfileSettings
  }

export type RdpRemoteDesktopAccessProfile = RemoteDesktopAccessProfileBase
  & RemoteDesktopRouteConfiguration
  & { protocol: 'rdp'; protocol_config_version: 1; rdp: RdpProfileSettings }

export type RemoteDesktopAccessProfile = VncRemoteDesktopAccessProfile | RdpRemoteDesktopAccessProfile

interface VncRemoteDesktopAccessProfileInputBase {
  host_id: string
  name: string
  description: string
  protocol: 'vnc'
  protocol_config_version: 1
  vnc: VncProfileSettings
}

export type VncRemoteDesktopAccessProfileInput = VncRemoteDesktopAccessProfileInputBase
  & RemoteDesktopRouteConfiguration

export type RdpRemoteDesktopAccessProfileInput = Pick<RdpRemoteDesktopAccessProfile, 'host_id' | 'name' | 'description' | 'protocol' | 'protocol_config_version' | 'rdp'> & RemoteDesktopRouteConfiguration
export type RemoteDesktopAccessProfileInput = VncRemoteDesktopAccessProfileInput | RdpRemoteDesktopAccessProfileInput

interface RemoteDesktopSessionBase {
  remote_viewer?: { attachment_id: string; device_id: string; generation: number; phase: string }
  desktop?: DesktopState
  id: string
  profile_id: string
  profile_name: string
  host_id: string
  host_name: string
  route_config_version: number
  protocol: RemoteDesktopProtocol
  protocol_config_version: number
  vnc: VncProfileSettings
  rdp?: RdpProfileSettings
  viewer_count?: number
  certificate?: { challenge_id: string; server_name: string; fingerprint: string; subject: string }
  credentials_required?: boolean
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

export type RemoteDesktopSession = RemoteDesktopSessionBase & (
  | { route: 'ssh_tunnel'; ssh_profile_id: string }
  | { route: 'direct'; ssh_profile_id?: never }
)

export interface RemoteDesktopAttachTicket {
  rdp?: RdpAttachment
  ticket: string
  credential_ticket: string
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

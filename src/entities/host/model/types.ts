export type AuthMethod = 'password' | 'private_key'

export type HostPlatform = 'linux'

export type HostReachabilityStatus = 'unknown' | 'checking' | 'online' | 'offline' | 'unavailable'

export interface HostIcon {
  id: string
  display_name: string
  file_name: string
  mime_type: string
  size_bytes: number
  sha256: string
  sort_order: number
  created_at: string
}

export interface HostIconReorderItem {
  id: string
  sort_order: number
}

export interface Host {
  id: string
  name: string
  platform: HostPlatform
  icon_id?: string
  group_id: string
  address: string
  port: number
  username: string
  auth_method: AuthMethod
  credential_id: string
  jump_host_id?: string
  proxy_id?: string
  fingerprint?: string
  tags: string[]
  favorite: boolean
  fingerprint_policy: string
  note?: string
  last_file_directory?: string
  created_at?: string
  updated_at?: string
  last_connected_at?: string
}

export interface HostGroup {
  id: string
  name: string
  sort_order: number
  created_at?: string
  updated_at?: string
}

export interface HostReachability {
  host_id: string
  address: string
  status: HostReachabilityStatus
  latency_ms?: number
  packet_loss: number
  checked_at?: string
  error_code?: string
  error_message?: string
}

export interface HostReachabilityEvent {
  type: 'snapshot' | 'checking' | 'updated' | string
  state?: HostReachability
  items?: HostReachability[]
}

export interface HostInput {
  name: string
  platform: HostPlatform
  icon_id: string
  group_id: string
  address: string
  port: number
  username: string
  auth_method: AuthMethod
  credential_id: string
  jump_host_id: string
  proxy_id: string
  tags: string[]
  favorite: boolean
  fingerprint_policy: string
  note: string
}

export type Language = 'zh-CN' | 'en-US'

export type ThemeMode = 'dark' | 'light'

export type PageKey = 'workbench' | 'hosts' | 'vault' | 'settings'

export type AuthMethod = 'password' | 'private_key' | 'system'

export type CredentialType = 'password' | 'private_key' | 'private_key_passphrase'

export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed'

export type SessionKind = 'ssh' | 'local'

export type LocalShell = 'powershell' | 'cmd'

export interface Settings {
  language: Language
}

export interface Host {
  id: string
  name: string
  group_id: string
  address: string
  port: number
  username: string
  auth_method: AuthMethod
  credential_id: string
  jump_host_id?: string
  fingerprint?: string
  tags: string[]
  fingerprint_policy: string
  note?: string
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

export interface CredentialView {
  id: string
  name: string
  type: CredentialType
  vault_id: string
  metadata: Record<string, string>
  fingerprint?: string
  bound_host_count: number
  created_at?: string
  updated_at?: string
  last_used_at?: string
}

export interface KnownHost {
  id: string
  host_id: string
  address: string
  port: number
  host_key_type: string
  fingerprint_sha256: string
  trusted_at?: string
  last_seen_at?: string
  created_at?: string
  updated_at?: string
}

export interface Session {
  id: string
  kind: SessionKind
  host_id?: string
  jump_host_id?: string
  status: SessionStatus
  status_message?: string
  started_at: string
  connected_at?: string
  ended_at?: string
  last_error?: string
  exit_code?: number
  pty_cols: number
  pty_rows: number
}

export interface ApiErrorBody {
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export interface AppConfig {
  apiBaseUrl: string
  apiToken: string
}

export interface HostInput {
  name: string
  group_id: string
  address: string
  port: number
  username: string
  auth_method: AuthMethod
  credential_id: string
  jump_host_id: string
  tags: string[]
  fingerprint_policy: string
  note: string
}

export interface CredentialInput {
  name: string
  type: CredentialType
  vault_id: string
  secret: string
  metadata: Record<string, string>
}

export interface AppData {
  hosts: Host[]
  groups: HostGroup[]
  credentials: CredentialView[]
  knownHosts: KnownHost[]
  sessions: Session[]
  settings: Settings
}

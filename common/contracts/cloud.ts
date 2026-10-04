export interface CloudStatus {
  qr_login?: CloudQRLogin
  revision: number
  binding_id?: string
  authenticated: boolean
  current_session_id?: string
  configured: boolean
  origin?: string
  generation: string
  phase: 'unconfigured' | 'unavailable' | 'signed_out' | 'ready' | 'blocked' | 'syncing'
  error_code?: string
  email?: string
  user_id?: string
  device_id?: string
  device_status?: 'pending' | 'active' | 'revoked'
  workspace_id?: string
  key_epoch?: string
  confirmed: boolean
  auto_sync: boolean
  pending: number
  conflicts: number
  last_success?: string
}

export interface CloudQRLogin {
  id: string
  state: 'pending' | 'scanned' | 'preparing' | 'ready' | 'approved' | 'issued' | 'completed' | 'expired' | 'cancelled' | 'rejected' | 'invalidated'
  revision: string
  qr_code?: string
  pairing_code: string
  expires_at: string
  remaining_seconds: number
  error_code?: string
}
export interface CloudQRLoginInput {
  generation: string
  action: 'create' | 'watch' | 'cancel' | 'retry'
  id?: string
  watching?: boolean
  reauthenticate?: boolean
}

export interface CloudDevice {
  id: string
  user_id: string
  name: string
  signing_key: string
  recipient: string
  status: 'pending' | 'active' | 'revoked'
  created_at: string
}

export interface CloudSession {
  id: string
  device_id: string
  created_at: string
  expires_at: string
  revoked: boolean
}

export const cloudAccountAreas = ['profile', 'devices', 'sessions', 'security', 'mfa', 'recovery', 'authorizations', 'workspaces', 'rekey'] as const
export type CloudAccountArea = typeof cloudAccountAreas[number]
export interface CloudAccountChange { generation: string; changes: CloudAccountArea[]; operations: string[] }
export interface CloudEvent {
  type: 'snapshot' | 'status' | 'resync' | 'datasets' | 'security' | 'account'
  status: CloudStatus
  datasets?: string[]
  changes?: CloudAccountArea[]
  operations?: string[]
}

export type CloudAuthAction = 'register' | 'verify-email' | 'resend-verification' | 'password-reset/request' | 'password-reset/confirm'

export type CloudMFAMethod = 'totp' | 'backup_code'
export interface CloudMFAProof { password?: string; method?: CloudMFAMethod; code?: string }
export interface CloudLoginChallenge { id: string; expires_at: string; methods: CloudMFAMethod[] }
export type CloudLoginResult = { state: 'authenticated'; status: CloudStatus } | { state: 'mfa_required'; challenge: CloudLoginChallenge }
export interface CloudMFAStatus {
  enabled: boolean
  revision: string
  enabled_at?: string
  backup_codes_remaining: number
  verified_until?: string
}
export interface CloudMFASetup { setup_id: string; expires_at: string; secret: string; otpauth_uri: string; revision: string }
export interface CloudMFACodes { status: CloudMFAStatus; backup_codes: string[] }
export interface CloudReauthentication { verified_until: string }

export interface CloudPreviewItem { dataset: string; upload: number; download: number; delete: number; conflicts: number }
export interface CloudPreview { id: string; generation: string; items: CloudPreviewItem[]; blocked: boolean; error_code?: string }
export interface CloudConflict { id: string; dataset: string; object_id: string; name: string; local_deleted: boolean; remote_deleted: boolean }
export interface CloudRekeyStatus { id?: string; status: string; completed: number; total: number }
export type CloudTab = 'profile' | 'sync' | 'devices' | 'security'

export interface CloudProfile {
  user_id: string
  name: string
  bio: string
  organization: string
  avatar: string
  revision: string
  updated_at: string | null
}
export type CloudProfileFields = Pick<CloudProfile, 'name' | 'bio' | 'organization' | 'avatar'>
export type CloudProfilePatch = Partial<CloudProfileFields> & { expected_revision: string }

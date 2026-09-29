export interface CloudStatus {
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

export interface CloudChallenge {
  id: string
  kind: string
  nonce: string
  user_id: string
  session_id: string
  device_id: string
  workspace_id: string
  key_epoch: string
  recovery_version: string
  signing_key: string
  recipient: string
  recovery_epoch: string
  expires_at: string
}

export interface CloudEvent {
  type: 'snapshot' | 'status' | 'resync' | 'datasets'
  status: CloudStatus
  datasets?: string[]
}

export type CloudAuthAction = 'register' | 'verify-email' | 'resend-verification' | 'password-reset/request' | 'password-reset/confirm' | 'reauthenticate'

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

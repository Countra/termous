import type { CloudMFAProof } from './cloud'

export type CloudAuthorizationKind = 'approval' | 'recovery' | 'enablement'
export type CloudAuthorizationAction = 'approve' | 'reject' | 'cancel' | 'verify' | 'complete' | 'claim'
export interface CloudAuthorizationTarget { id: string; kind: CloudAuthorizationKind }
export interface CloudAuthorization {
  id: string
  workspace_id: string
  device_id: string
  approver_id?: string
  kind: CloudAuthorizationKind
  name: string
  status: 'pending' | 'verifying' | 'verified' | 'processing' | 'approved' | 'acknowledged' | 'rejected' | 'cancelled' | 'expired' | 'invalidated' | 'failed'
  revision: string
  expires_at: string
  created_at: string
  source_summary: string
  platform: string
  fingerprint?: string
  target_confirmed: boolean
  keys_verified: boolean
  allowed_actions: string[]
}
export interface CloudRecoveryStatus {
  policy: { workspace_id: string; revision: string; status: 'disabled' | 'enabling' | 'enabled' | 'frozen'; updated_at: string }
  available: boolean
  reason?: string
  blocked_until?: string
}
export interface CloudSecurityOverview {
  account: { contract: 'cloud-authorization-v1' | 'cloud-recovery-safeguards-v1' | 'cloud-direct-approval-v1'; managed_recovery: boolean; mfa_enabled: boolean; mfa_revision: string; recovery_blocked_until?: string; workspace_id?: string; recovery_required?: boolean; recovery_ready?: boolean; personal_recovery_enabled?: boolean; archive_available?: boolean }
  recovery: CloudRecoveryStatus
  membership_initialized: boolean
  keys_verified: boolean
}
export interface CloudAuthorizationInput extends Partial<CloudMFAProof> {
  expected_revision: string
  confirm_trust?: boolean
}

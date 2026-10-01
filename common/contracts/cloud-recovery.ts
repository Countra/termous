import type { CloudConflict, CloudPreview } from './cloud'

export interface CloudPersonalRecoveryStatus { enabled: boolean; revision: string }
export interface CloudPersonalRecoveryOperation {
  id: string; kind: 'setup' | 'recover'; status: 'pending' | 'verified' | 'prepared' | 'completed' | 'acknowledged' | 'cancelled' | 'expired' | 'invalidated'
  revision: string; membership_head: string; personal_revision: string; key_epoch: string; expires_at: string; verified_until?: string
}
export interface CloudPersonalRecoverySetup extends CloudPersonalRecoveryOperation { recovery_key: string; confirm_groups: number[] }
export interface CloudWorkspaceRestart {
  id: string; status: 'pending' | 'verified' | 'completed' | 'cancelled' | 'expired' | 'invalidated'; revision: number
  source_workspace_id: string; target_workspace_id: string; expires_at: string; verified_until?: string; email_sent: boolean
  source_device_count?: number; archive_expires_at?: string; local_pending?: boolean
}
export interface CloudArchive { id: string; status: 'archived' | 'deleting'; revision: string; expires_at?: string; local_key_available: boolean }
export interface CloudArchivePreview extends CloudPreview { workspace_id: string; expires_at: string; conflicts: CloudConflict[] }

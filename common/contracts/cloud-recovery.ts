import type { CloudConflict, CloudPreview } from './cloud'

export interface CloudPersonalRecoveryStatus { enabled: boolean; revision: string }
export interface CloudPersonalRecoveryOperation {
  server_time: string
  id: string; kind: 'setup' | 'recover'; status: 'pending' | 'verified' | 'prepared' | 'completed' | 'acknowledged' | 'cancelled' | 'expired' | 'invalidated'
  revision: string; membership_head: string; personal_revision: string; key_epoch: string; expires_at: string; verified_until?: string
}
export interface CloudPersonalRecoverySetup extends CloudPersonalRecoveryOperation { recovery_key: string; recovery_file: string }
export interface CloudWorkspaceRestart {
  server_time: string
  id: string; status: 'pending' | 'verified' | 'completed' | 'cancelled' | 'expired' | 'invalidated'; revision: number
  source_workspace_id: string; target_workspace_id: string; expires_at: string; verified_until?: string; email_sent: boolean
  source_device_count?: number; archive_expires_at?: string; local_pending?: boolean
}
export interface CloudArchive { id: string; status: 'archived' | 'deleting'; revision: string; expires_at?: string; local_key_available: boolean }
export interface CloudArchivePreview extends CloudPreview { server_time: string; workspace_id: string; expires_at: string; conflicts: CloudConflict[] }

export const CLOUD_PERSONAL_KEY_FILE_EXTENSION = '.torkey'
export const CLOUD_PERSONAL_KEY_FILE_MAX_BYTES = 4096
export type CloudRecoveryCredential = { recovery_file: string; recovery_key?: never } | { recovery_key: string; recovery_file?: never }

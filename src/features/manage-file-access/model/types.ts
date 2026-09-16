import type { SSHAccessProfile } from '#entities/ssh-access-profile'

export interface SFTPProfileDraft {
  engine: 'sftp'
  host_id: string
  name: string
  ssh_profile_id: string
}

export type FileAccessProfileEditorDraft = SFTPProfileDraft

export interface FileAccessProfileEditorErrors {
  name?: 'required' | 'too_long'
  ssh_profile_id?: 'required' | 'unavailable'
}

export interface FileAccessProfileEditorViewProps {
  draft: FileAccessProfileEditorDraft
  sshProfiles: SSHAccessProfile[]
  errors?: FileAccessProfileEditorErrors
  disabled: boolean
  onChange: (draft: FileAccessProfileEditorDraft) => void
}

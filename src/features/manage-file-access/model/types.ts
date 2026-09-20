import type { ComponentType } from 'react'
import type { FileAccessEngine, FileAccessProfile, FileAccessProfileCreateInput, FileAccessProfilePatchInput } from '#entities/file-access-profile'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

export interface SFTPProfileDraft {
  engine: 'sftp'
  host_id: string
  name: string
  ssh_profile_id: string
}

export interface S3ProfileDraft {
  engine: 's3'
  host_id: string
  name: string
  endpoint: string
  bucket: string
  prefix: string
  region: string
  addressing_style: 'path' | 'virtual' | 'auto'
  access_key: string
  secret_key: string
  session_token: string
  configured_slots: string[]
  clear_session_token: boolean
}

export interface WebDAVProfileDraft {
  engine: 'webdav'
  host_id: string
  name: string
  endpoint: string
  username: string
  password: string
  password_configured: boolean
}

export interface FTPProfileDraft {
  engine: 'ftp'
  host_id: string
  name: string
  host: string
  port: number | null
  security: 'none' | 'explicit_tls' | 'implicit_tls'
  username: string
  password: string
  password_configured: boolean
  root_path: string
}

export type FileAccessProfileEditorDraft = SFTPProfileDraft | S3ProfileDraft | WebDAVProfileDraft | FTPProfileDraft

export interface FileAccessProfileEditorErrors {
  endpoint?: 'required' | 'invalid'
  bucket?: 'required' | 'invalid'
  prefix?: 'invalid'
  access_key?: 'required'
  secret_key?: 'required'
  username?: 'required' | 'invalid'
  password?: 'required' | 'invalid'
  host?: 'required' | 'invalid'
  port?: 'invalid'
  root_path?: 'invalid'
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

export interface FileAccessProfileEditorDefinition {
  engine: FileAccessEngine
  configVersion: number
  label: string
  Editor: ComponentType<FileAccessProfileEditorViewProps>
  createDraft: (hostId: string, sshProfiles: SSHAccessProfile[]) => FileAccessProfileEditorDraft
  editDraft: (profile: FileAccessProfile) => FileAccessProfileEditorDraft | undefined
  normalize: (draft: FileAccessProfileEditorDraft) => FileAccessProfileEditorDraft
  validate: (
    draft: FileAccessProfileEditorDraft,
    sshProfiles: SSHAccessProfile[],
  ) => FileAccessProfileEditorErrors
  summary: (draft: FileAccessProfileEditorDraft, sshProfiles: SSHAccessProfile[]) => string
  toCreateInput: (draft: FileAccessProfileEditorDraft) => FileAccessProfileCreateInput
  toPatchInput: (draft: FileAccessProfileEditorDraft) => FileAccessProfilePatchInput
}

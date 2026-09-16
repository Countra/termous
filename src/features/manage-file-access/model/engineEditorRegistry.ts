import type {
  FileAccessEngine,
  FileAccessProfile,
  FileAccessProfileCreateInput,
  FileAccessProfilePatchInput,
} from '#entities/file-access-profile'
import { getSFTPAccessConfig } from '#entities/file-access-profile'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import type { ComponentType } from 'react'
import { SFTPProfileEditor } from '../engines/sftp/SFTPProfileEditor.tsx'
import type {
  FileAccessProfileEditorDraft,
  FileAccessProfileEditorErrors,
  FileAccessProfileEditorViewProps,
} from './types.ts'

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

const sftpEditor: FileAccessProfileEditorDefinition = {
  engine: 'sftp',
  configVersion: 1,
  label: 'SFTP',
  Editor: SFTPProfileEditor,
  createDraft: (hostId, sshProfiles) => ({
    engine: 'sftp',
    host_id: hostId,
    name: 'SFTP',
    ssh_profile_id: sshProfiles.find((profile) => profile.host_id === hostId && profile.is_default)?.id
      ?? sshProfiles.find((profile) => profile.host_id === hostId)?.id
      ?? '',
  }),
  editDraft: (profile) => {
    const config = getSFTPAccessConfig(profile)
    return profile.host_id && config ? {
        engine: 'sftp',
        host_id: profile.host_id,
        name: profile.name,
        ssh_profile_id: config.ssh_profile_id,
      }
      : undefined
  },
  normalize: (draft) => ({
    ...draft,
    host_id: draft.host_id.trim(),
    name: draft.name.trim(),
    ssh_profile_id: draft.ssh_profile_id.trim(),
  }),
  validate: (draft, sshProfiles) => {
    const name = draft.name.trim()
    const sshProfileId = draft.ssh_profile_id.trim()
    return {
      name: !name ? 'required' : Array.from(name).length > 80 ? 'too_long' : undefined,
      ssh_profile_id: !sshProfileId
        ? 'required'
        : sshProfiles.some((profile) => profile.id === sshProfileId && profile.host_id === draft.host_id)
          ? undefined
          : 'unavailable',
    }
  },
  summary: (draft, sshProfiles) => {
    const profile = sshProfiles.find((item) => item.id === draft.ssh_profile_id)
    return profile?.name || profile?.address || draft.ssh_profile_id
  },
  toCreateInput: (draft) => ({
    host_id: draft.host_id,
    name: draft.name,
    engine: 'sftp',
    engine_config_version: 1,
    config: { ssh_profile_id: draft.ssh_profile_id },
  }),
  toPatchInput: (draft) => ({
    name: draft.name,
    engine_config_version: 1,
    config: { ssh_profile_id: draft.ssh_profile_id },
  }),
}

const definitions = new Map<string, FileAccessProfileEditorDefinition>([['sftp', sftpEditor]])

export function getFileAccessProfileEditor(engine: string, configVersion?: number) {
  const definition = definitions.get(engine)
  if (configVersion !== undefined && definition?.configVersion !== configVersion) return undefined
  return definition
}

export function listFileAccessProfileEditors() {
  return [...definitions.values()]
}

export function fileAccessProfileEditorDraftsEqual(
  left: FileAccessProfileEditorDraft,
  right: FileAccessProfileEditorDraft,
) {
  const editor = getFileAccessProfileEditor(left.engine)
  return Boolean(editor && right.engine === left.engine
    && JSON.stringify(editor.normalize(left)) === JSON.stringify(editor.normalize(right)))
}

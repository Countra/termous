import { getSFTPAccessConfig } from '#entities/file-access-profile'
import { SFTPProfileEditor } from '../engines/sftp/SFTPProfileEditor.tsx'
export type { FileAccessProfileEditorDefinition } from './types.ts'
import { s3Editor } from '../engines/s3/definition.ts'
import type {
  FileAccessProfileEditorDraft,
  FileAccessProfileEditorDefinition,
} from './types.ts'


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
    ...requireSFTP(draft),
    host_id: draft.host_id.trim(),
    name: draft.name.trim(),
    ssh_profile_id: requireSFTP(draft).ssh_profile_id.trim(),
  }),
  validate: (draft, sshProfiles) => {
    const name = draft.name.trim()
    const sshProfileId = requireSFTP(draft).ssh_profile_id.trim()
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
    const profile = sshProfiles.find((item) => item.id === requireSFTP(draft).ssh_profile_id)
    return profile?.name || profile?.address || requireSFTP(draft).ssh_profile_id
  },
  toCreateInput: (draft) => ({
    host_id: draft.host_id,
    name: draft.name,
    engine: 'sftp',
    engine_config_version: 1,
    config: { ssh_profile_id: requireSFTP(draft).ssh_profile_id },
  }),
  toPatchInput: (draft) => ({
    name: draft.name,
    engine_config_version: 1,
    config: { ssh_profile_id: requireSFTP(draft).ssh_profile_id },
  }),
}

function requireSFTP(draft: FileAccessProfileEditorDraft) {
  if (draft.engine !== 'sftp') throw new Error('文件配置编辑器类型不一致')
  return draft
}

const definitions = new Map<string, FileAccessProfileEditorDefinition>([['sftp', sftpEditor], ['s3', s3Editor]])

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

import type { FileAccessProfileCreateInput } from '#entities/file-access-profile'
import type { FileAccessProfileEditorDefinition, FileAccessProfileEditorDraft, FileAccessProfileEditorErrors } from '../../model/types.ts'
import { SMBProfileEditor } from './SMBProfileEditor.tsx'

function requireSMB(draft: FileAccessProfileEditorDraft) {
  if (draft.engine !== 'smb') throw new Error('文件配置编辑器类型不一致')
  return draft
}

function validHost(input: string) {
  const host = input.trim().toLowerCase()
  if (!host || /[/\\@?#%\s\p{Cc}]/u.test(host)) return false
  if (host.includes(':')) {
    if (host.startsWith('[') && !host.endsWith(']')) return false
    try { return Boolean(new URL(`http://${host.startsWith('[') ? host : `[${host}]`}`).hostname) } catch { return false }
  }
  return host.length <= 253 && host.replace(/\.$/u, '').split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
}

function validName(value: string) {
  return value.length > 0 && value.length <= 255 && value !== '.' && value !== '..'
    && !/[/\\:*?"<>|\p{Cc}\p{Cs}]/u.test(value) && !/[. ]$/u.test(value)
}

function validRoot(value: string) {
  return value === '/' || value.length <= 32760 && value.startsWith('/') && value.slice(1).split('/').every(validName)
}

function toInput(input: FileAccessProfileEditorDraft): FileAccessProfileCreateInput {
  const draft = requireSMB(input)
  return {
    host_id: draft.host_id, name: draft.name.trim(), engine: 'smb', engine_config_version: 1,
    config: { host: draft.host.trim(), port: draft.port ?? 445, share: draft.share, username: draft.username, domain: draft.domain, root_path: draft.root_path || '/' },
    secret_values: draft.password === '' ? {} : { password: draft.password },
  }
}

export const smbEditor: FileAccessProfileEditorDefinition = {
  engine: 'smb', configVersion: 1, label: 'SMB', Editor: SMBProfileEditor,
  createDraft: (hostId) => ({ engine: 'smb', host_id: hostId, name: 'SMB', host: '', port: 445, share: '', username: '', domain: '', password: '', password_configured: false, root_path: '/' }),
  editDraft: (profile) => {
    const config = profile.config
    if (!profile.host_id || profile.engine !== 'smb' || profile.engine_config_version !== 1 || typeof config.host !== 'string' || typeof config.username !== 'string'
      || typeof config.share !== 'string' || typeof config.domain !== 'string' || typeof config.root_path !== 'string' || typeof config.port !== 'number') return undefined
    return { engine: 'smb', host_id: profile.host_id, name: profile.name, host: config.host, port: config.port, share: config.share, username: config.username, domain: config.domain, root_path: config.root_path, password: '', password_configured: Boolean(profile.secret_refs?.password) }
  },
  normalize: (input) => { const draft = requireSMB(input); return { ...draft, host_id: draft.host_id.trim(), name: draft.name.trim(), host: draft.host.trim(), root_path: draft.root_path || '/' } },
  validate: (input) => {
    const draft = requireSMB(input)
    const errors: FileAccessProfileEditorErrors = {}
    if (!draft.name.trim()) errors.name = 'required'
    else if (Array.from(draft.name.trim()).length > 80) errors.name = 'too_long'
    if (!validHost(draft.host)) errors.host = draft.host.trim() ? 'invalid' : 'required'
    if (draft.port === null || !Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) errors.port = 'invalid'
    if (!validName(draft.share)) errors.share = draft.share ? 'invalid' : 'required'
    if (!draft.username) errors.username = 'required'
    else if (/[\\\p{Cc}\p{Cs}]/u.test(draft.username) || draft.username.length > 256) errors.username = 'invalid'
    if (/[/\\\p{Cc}\p{Cs}]/u.test(draft.domain) || draft.domain.length > 255) errors.domain = 'invalid'
    if (!draft.password && !draft.password_configured) errors.password = 'required'
    if (!validRoot(draft.root_path || '/')) errors.root_path = 'invalid'
    return errors
  },
  summary: (input) => {
    const draft = requireSMB(input)
    const host = draft.host.includes(':') && !draft.host.startsWith('[') ? `[${draft.host}]` : draft.host
    return `SMB · ${host}:${draft.port} / ${draft.share} · ${draft.root_path || '/'}`
  },
  toCreateInput: toInput,
  toPatchInput: (input) => { const { name, engine_config_version, config, secret_values } = toInput(input); return { name, engine_config_version, config, secret_values } },
}

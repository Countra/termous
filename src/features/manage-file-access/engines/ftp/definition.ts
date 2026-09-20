import type { FileAccessProfileCreateInput } from '#entities/file-access-profile'
import type { FileAccessProfileEditorDefinition, FileAccessProfileEditorDraft, FileAccessProfileEditorErrors, FTPProfileDraft } from '../../model/types.ts'
import { FTPProfileEditor } from './FTPProfileEditor.tsx'

function requireFTP(draft: FileAccessProfileEditorDraft) {
  if (draft.engine !== 'ftp') throw new Error('文件配置编辑器类型不一致')
  return draft
}

export function ftpDefaultPort(security: FTPProfileDraft['security']) { return security === 'implicit_tls' ? 990 : 21 }

function validHost(input: string) {
  const host = input.trim().toLowerCase()
  if (!host || /[/\\@?#%\s\p{Cc}]/u.test(host)) return false
  if (host.includes(':')) {
    if (host.startsWith('[') && !host.endsWith(']')) return false
    try { return Boolean(new URL(`http://${host.startsWith('[') ? host : `[${host}]`}`).hostname) } catch { return false }
  }
  return host.length <= 253 && host.replace(/\.$/u, '').split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
}

function validRoot(value: string) {
  return value === '/' || value.startsWith('/') && !/[\\\p{Cc}]/u.test(value) && value.slice(1).split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

function toInput(input: FileAccessProfileEditorDraft): FileAccessProfileCreateInput {
  const draft = requireFTP(input)
  return {
    host_id: draft.host_id, name: draft.name.trim(), engine: 'ftp', engine_config_version: 1,
    config: { host: draft.host.trim(), port: draft.port ?? ftpDefaultPort(draft.security), security: draft.security, username: draft.username, root_path: draft.root_path || '/' },
    secret_values: draft.password === '' ? {} : { password: draft.password },
  }
}

export const ftpEditor: FileAccessProfileEditorDefinition = {
  engine: 'ftp', configVersion: 1, label: 'FTP', Editor: FTPProfileEditor,
  createDraft: (hostId) => ({ engine: 'ftp', host_id: hostId, name: 'FTP', host: '', port: 21, security: 'explicit_tls', username: '', password: '', password_configured: false, root_path: '/' }),
  editDraft: (profile) => {
    const config = profile.config
    if (!profile.host_id || profile.engine !== 'ftp' || profile.engine_config_version !== 1 || typeof config.host !== 'string' || typeof config.username !== 'string'
      || typeof config.root_path !== 'string' || typeof config.port !== 'number' || !['none', 'explicit_tls', 'implicit_tls'].includes(String(config.security))) return undefined
    return { engine: 'ftp', host_id: profile.host_id, name: profile.name, host: config.host, port: config.port, security: config.security as FTPProfileDraft['security'], username: config.username, root_path: config.root_path, password: '', password_configured: Boolean(profile.secret_refs?.password) }
  },
  normalize: (input) => { const draft = requireFTP(input); return { ...draft, host_id: draft.host_id.trim(), name: draft.name.trim(), host: draft.host.trim(), root_path: draft.root_path || '/' } },
  validate: (input) => {
    const draft = requireFTP(input)
    const errors: FileAccessProfileEditorErrors = {}
    if (!draft.name.trim()) errors.name = 'required'
    else if (Array.from(draft.name.trim()).length > 80) errors.name = 'too_long'
    if (!validHost(draft.host)) errors.host = draft.host.trim() ? 'invalid' : 'required'
    if (draft.port === null || !Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) errors.port = 'invalid'
    if (!draft.username) errors.username = 'required'
    else if (/\p{Cc}/u.test(draft.username)) errors.username = 'invalid'
    if (!draft.password && !draft.password_configured) errors.password = 'required'
    else if (/[\r\n\0]/u.test(draft.password)) errors.password = 'invalid'
    if (!validRoot(draft.root_path || '/')) errors.root_path = 'invalid'
    return errors
  },
  summary: (input) => {
    const draft = requireFTP(input)
    const mode = draft.security === 'none' ? 'FTP' : draft.security === 'explicit_tls' ? 'FTPS (AUTH TLS)' : 'FTPS (TLS)'
    const host = draft.host.includes(':') && !draft.host.startsWith('[') ? `[${draft.host}]` : draft.host
    return `${mode} · ${host}:${draft.port} · ${draft.root_path || '/'}`
  },
  toCreateInput: toInput,
  toPatchInput: (input) => { const { name, engine_config_version, config, secret_values } = toInput(input); return { name, engine_config_version, config, secret_values } },
}

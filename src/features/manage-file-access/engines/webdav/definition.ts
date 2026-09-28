import type { FileAccessProfileEditorDefinition, FileAccessProfileEditorDraft, FileAccessProfileEditorErrors } from '../../model/types.ts'
import { WebDAVProfileEditor } from './WebDAVProfileEditor.tsx'
import type { FileAccessProfileCreateInput } from '#entities/file-access-profile'

function requireWebDAV(draft: FileAccessProfileEditorDraft) {
  if (draft.engine !== 'webdav') throw new Error('文件配置编辑器类型不一致')
  return draft
}

function toInput(input: FileAccessProfileEditorDraft): FileAccessProfileCreateInput {
  const draft = requireWebDAV(input)
  return {
    host_id: draft.host_id, name: draft.name.trim(), engine: 'webdav', engine_config_version: 1,
    config: { endpoint: draft.endpoint.trim(), username: draft.username },
    secret_values: draft.password === '' ? {} : { password: draft.password },
  }
}

function validEndpoint(value: string) {
  try {
    const raw = value.trim()
    const endpoint = new URL(raw)
    if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.hostname || endpoint.port === '0' || endpoint.username || endpoint.password || /[?#\\\p{Cc}]/u.test(raw)) return false
    // URL 会自动清理点段，校验原始路径才能与后端保持一致。
    const match = raw.match(/^https?:\/\/([^/]+)(\/.*)?$/iu)
    // 浏览器会抹去空用户信息、空端口及编码主机名，原始地址仍须符合后端合同。
    if (!match || /[@%]/u.test(match[1]) || match[1].endsWith(':')) return false
    const path = match[2] ?? ''
    if (path === '' || path === '/') return true
    return path.slice(1).replace(/\/$/u, '').split('/').every((part) => {
      const decoded = decodeURIComponent(part)
      return decoded !== '' && decoded !== '.' && decoded !== '..' && !/[/\\\p{Cc}]/u.test(decoded)
    })
  } catch { return false }
}

export const webdavEditor: FileAccessProfileEditorDefinition = {
  engine: 'webdav', configVersion: 1, label: 'WebDAV', Editor: WebDAVProfileEditor,
  createDraft: (hostId) => ({ engine: 'webdav', host_id: hostId, name: 'WebDAV', endpoint: 'https://', username: '', password: '', password_configured: false }),
  editDraft: (profile) => {
    if (!profile.host_id || profile.engine !== 'webdav' || profile.engine_config_version !== 1 || typeof profile.config.endpoint !== 'string' || typeof profile.config.username !== 'string') return undefined
    return { engine: 'webdav', host_id: profile.host_id, name: profile.name, endpoint: profile.config.endpoint, username: profile.config.username, password: '', password_configured: Boolean(profile.secret_refs?.password) }
  },
  normalize: (input) => {
    const draft = requireWebDAV(input)
    return { ...draft, host_id: draft.host_id.trim(), name: draft.name.trim(), endpoint: draft.endpoint.trim() }
  },
  validate: (input) => {
    const draft = requireWebDAV(input)
    const errors: FileAccessProfileEditorErrors = {}
    if (!draft.name.trim()) errors.name = 'required'
    else if (Array.from(draft.name.trim()).length > 80) errors.name = 'too_long'
    if (!validEndpoint(draft.endpoint)) errors.endpoint = 'invalid'
    if (!draft.username) errors.username = 'required'
    else if (/[:\p{Cc}]/u.test(draft.username)) errors.username = 'invalid'
    if (!draft.password && !draft.password_configured) errors.password = 'required'
    return errors
  },
  summary: (input) => { const draft = requireWebDAV(input); return `${draft.endpoint} · ${draft.username}` },
  toCreateInput: toInput,
  toPatchInput: (input) => { const { name, engine_config_version, config, secret_values } = toInput(input); return { name, engine_config_version, config, secret_values } },
}

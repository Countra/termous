import type { FileAccessProfileEditorDefinition } from '../../model/types.ts'
import type { FileAccessProfileEditorDraft, FileAccessProfileEditorErrors } from '../../model/types.ts'
import { S3ProfileEditor } from './S3ProfileEditor.tsx'

function requireS3(draft: FileAccessProfileEditorDraft) {
  if (draft.engine !== 's3') throw new Error('文件配置编辑器类型不一致')
  return draft
}

function toInput(input: FileAccessProfileEditorDraft) {
  const draft = requireS3(input)
  return {
    host_id: draft.host_id, name: draft.name.trim(), engine: 's3', engine_config_version: 1,
    config: { endpoint: draft.endpoint.trim(), bucket: draft.bucket.trim(), prefix: draft.prefix, region: draft.region.trim(), addressing_style: draft.addressing_style },
    secret_values: Object.fromEntries(
      (['access_key', 'secret_key', 'session_token'] as const)
        .filter((slot) => draft[slot] !== '' && !(slot === 'session_token' && draft.clear_session_token))
        .map((slot) => [slot, draft[slot]]),
    ),
    clear_secret_slots: draft.clear_session_token ? ['session_token'] : [],
  }
}

export const s3Editor: FileAccessProfileEditorDefinition = {
  engine: 's3', configVersion: 1, label: 'S3 / MinIO', Editor: S3ProfileEditor,
  createDraft: (hostId) => ({ engine: 's3', host_id: hostId, name: 'S3 / MinIO', endpoint: 'https://', bucket: '', prefix: '', region: '', addressing_style: 'path', access_key: '', secret_key: '', session_token: '', configured_slots: [], clear_session_token: false }),
  editDraft: (profile) => {
    const config = profile.config
    if (!profile.host_id || profile.engine !== 's3' || profile.engine_config_version !== 1 || typeof config.endpoint !== 'string' || typeof config.bucket !== 'string') return undefined
    return {
      engine: 's3', host_id: profile.host_id, name: profile.name, endpoint: config.endpoint, bucket: config.bucket,
      prefix: typeof config.prefix === 'string' ? config.prefix : '', region: typeof config.region === 'string' ? config.region : '',
      addressing_style: config.addressing_style === 'virtual' || config.addressing_style === 'auto' ? config.addressing_style : 'path',
      access_key: '', secret_key: '', session_token: '', configured_slots: Object.keys(profile.secret_refs ?? {}), clear_session_token: false,
    }
  },
  normalize: (input) => {
    const draft = requireS3(input)
    return { ...draft, host_id: draft.host_id.trim(), name: draft.name.trim(), endpoint: draft.endpoint.trim(), bucket: draft.bucket.trim(), region: draft.region.trim() }
  },
  validate: (input) => {
    const draft = requireS3(input)
    const errors: FileAccessProfileEditorErrors = {}
    if (!draft.name.trim()) errors.name = 'required'
    else if (Array.from(draft.name.trim()).length > 80) errors.name = 'too_long'
    try {
      const endpoint = new URL(draft.endpoint.trim())
      if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || draft.endpoint.includes('?') || draft.endpoint.includes('#') || (endpoint.pathname !== '' && endpoint.pathname !== '/')) errors.endpoint = 'invalid'
    } catch { errors.endpoint = 'invalid' }
    if (!draft.bucket.trim()) errors.bucket = 'required'
    else if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(draft.bucket.trim()) || draft.bucket.includes('..') || /^\d+\.\d+\.\d+\.\d+$/.test(draft.bucket.trim())) errors.bucket = 'invalid'
    const prefix = draft.prefix.endsWith('/') ? draft.prefix.slice(0, -1) : draft.prefix
    if (prefix && prefix.split('/').some((part) => !part || part === '.' || part === '..') || draft.prefix.startsWith('/') || prefix.includes('\0') || new TextEncoder().encode(prefix).length > 1023) errors.prefix = 'invalid'
    if (!draft.access_key && !draft.configured_slots.includes('access_key')) errors.access_key = 'required'
    if (!draft.secret_key && !draft.configured_slots.includes('secret_key')) errors.secret_key = 'required'
    return errors
  },
  summary: (input) => { const draft = requireS3(input); return `${draft.endpoint} / ${draft.bucket}${draft.prefix ? ` / ${draft.prefix}` : ''}` },
  toCreateInput: toInput,
  toPatchInput: (input) => { const { name, engine_config_version, config, secret_values, clear_secret_slots } = toInput(input); return { name, engine_config_version, config, secret_values, clear_secret_slots } },
}

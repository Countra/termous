import type {
  FileAccessEngineDescriptor,
  FileAccessProfile,
  FileAccessProfileLifecycleOwner,
  FileAccessProfileReferences,
  SFTPAccessConfig,
  SFTPFileAccessProfile,
} from './types.ts'

export function decodeFileAccessProfile(value: unknown): FileAccessProfile {
  const source = objectValue(value, '文件 Profile 响应无效')
  const engine = requiredString(source.engine, '文件 Profile Engine 无效')
  const canonicalConfig = optionalObject(source.config)
  const legacySFTP = optionalObject(source.sftp)
  let config = canonicalConfig
  let sftp: SFTPAccessConfig | undefined

  if (engine === 'sftp') {
    const canonical = canonicalConfig ? decodeSFTPConfig(canonicalConfig) : undefined
    const legacy = legacySFTP ? decodeSFTPConfig(legacySFTP) : undefined
    if (!canonical && !legacy) throw new Error('SFTP Profile 配置缺失')
    if (canonical && legacy && canonical.ssh_profile_id !== legacy.ssh_profile_id) {
      throw new Error('SFTP Profile 兼容配置不一致')
    }
    sftp = canonical ?? legacy
    config = { ...sftp }
  }
  if (!config) throw new Error('文件 Profile 配置缺失')
  const clonedConfig = cloneConfig(config)

  const hostId = optionalString(source.host_id, '文件 Profile Host ID 无效')
  const result: FileAccessProfile = {
    id: requiredString(source.id, '文件 Profile ID 无效'),
    name: requiredString(source.name, '文件 Profile 名称无效'),
    engine,
    engine_config_version: positiveInteger(source.engine_config_version, '文件 Profile 配置版本无效'),
    config: clonedConfig,
    is_default: booleanValue(source.is_default, '文件 Profile 默认状态无效'),
    sort_order: integerValue(source.sort_order, '文件 Profile 排序值无效'),
    created_at: requiredString(source.created_at, '文件 Profile 创建时间无效'),
    updated_at: requiredString(source.updated_at, '文件 Profile 更新时间无效'),
  }
  if (hostId) result.host_id = hostId
  if (sftp) result.sftp = { ...sftp }
  const secretRefs = decodeSecretRefs(source.secret_refs)
  if (secretRefs) result.secret_refs = secretRefs
  const lastDirectory = optionalString(source.last_directory, '文件 Profile 最近目录无效')
  if (lastDirectory) result.last_directory = lastDirectory
  const lifecycleOwner = decodeLifecycleOwner(source.lifecycle_owner)
  if (lifecycleOwner) result.lifecycle_owner = lifecycleOwner
  return result
}

export function decodeFileAccessProfiles(value: unknown): FileAccessProfile[] {
  if (!Array.isArray(value)) throw new Error('文件 Profile 列表响应无效')
  return value.map(decodeFileAccessProfile)
}

export function decodeFileAccessEngineDescriptors(value: unknown): FileAccessEngineDescriptor[] {
  if (!Array.isArray(value)) throw new Error('文件 Engine 列表响应无效')
  return value.map((item) => {
    const source = objectValue(item, '文件 Engine 响应无效')
    const configVersions = source.config_versions
    if (!Array.isArray(configVersions) || configVersions.length === 0
      || !configVersions.every(isPositiveInteger)
      || configVersions.some((version, index) => index > 0 && version <= Number(configVersions[index - 1]))) {
      throw new Error('文件 Engine 支持版本无效')
    }
    if (!Array.isArray(source.capabilities) || !source.capabilities.every((entry) => typeof entry === 'string')) {
      throw new Error('文件 Engine 能力无效')
    }
    const hostScope = requiredString(source.host_scope, '文件 Engine Host 范围无效')
    if (!['required', 'optional', 'forbidden'].includes(hostScope)) {
      throw new Error('文件 Engine Host 范围无效')
    }
    const currentConfigVersion = positiveInteger(source.current_config_version, '文件 Engine 当前版本无效')
    if (!configVersions.includes(currentConfigVersion)) {
      throw new Error('文件 Engine 当前版本无效')
    }
    const descriptor: FileAccessEngineDescriptor = {
      id: requiredString(source.id, '文件 Engine ID 无效'),
      config_versions: [...configVersions],
      current_config_version: currentConfigVersion,
      host_scope: hostScope as FileAccessEngineDescriptor['host_scope'],
      capabilities: [...source.capabilities],
    }
    const secretSlots = decodeSecretSlots(source.secret_slots)
    if (secretSlots) descriptor.secret_slots = secretSlots
    return descriptor
  })
}

export function decodeFileAccessProfileReferences(value: unknown): FileAccessProfileReferences {
  const source = objectValue(value, '文件 Profile 引用响应无效')
  const result: FileAccessProfileReferences = {
    agent_sessions: nonNegativeInteger(source.agent_sessions, 'Agent 引用数无效'),
    active_file_sessions: nonNegativeInteger(source.active_file_sessions, '活动文件会话数无效'),
    is_default: booleanValue(source.is_default, '默认项状态无效'),
    peer_profiles: nonNegativeInteger(source.peer_profiles, '同 Host Profile 数量无效'),
    blocking_total: nonNegativeInteger(source.blocking_total, '阻塞引用总数无效'),
  }
  const lifecycleOwner = decodeLifecycleOwner(source.lifecycle_owner)
  if (lifecycleOwner) result.lifecycle_owner = lifecycleOwner
  return result
}

export function isSFTPFileAccessProfile(profile: FileAccessProfile): profile is SFTPFileAccessProfile {
  return profile.engine === 'sftp'
    && profile.engine_config_version === 1
    && typeof profile.host_id === 'string'
    && profile.host_id.length > 0
    && profile.sftp !== undefined
}

function decodeSFTPConfig(value: Record<string, unknown>): SFTPAccessConfig {
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'ssh_profile_id') {
    throw new Error('SFTP Profile 配置字段无效')
  }
  return { ssh_profile_id: requiredString(value.ssh_profile_id, 'SFTP Profile SSH ID 无效') }
}

function decodeLifecycleOwner(value: unknown): FileAccessProfileLifecycleOwner | undefined {
  if (value === undefined || value === null) return undefined
  const source = objectValue(value, '文件 Profile 生命周期所有者无效')
  return {
    kind: requiredString(source.kind, '文件 Profile 生命周期所有者类型无效'),
    id: requiredString(source.id, '文件 Profile 生命周期所有者 ID 无效'),
  }
}

const secretSlotName = /^[a-z][a-z0-9_]{0,63}$/

function decodeSecretRefs(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined
  const source = objectValue(value, '文件 Profile 秘密引用无效')
  return Object.fromEntries(Object.entries(source).map(([slot, id]) => {
    if (!secretSlotName.test(slot) || typeof id !== 'string' || !id || id.trim() !== id) {
      throw new Error('文件 Profile 秘密引用无效')
    }
    return [slot, id]
  }))
}

function decodeSecretSlots(value: unknown): FileAccessEngineDescriptor['secret_slots'] {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error('文件 Engine 秘密槽位无效')
  const names = new Set<string>()
  return value.map((item) => {
    const slot = objectValue(item, '文件 Engine 秘密槽位无效')
    if (typeof slot.name !== 'string' || !secretSlotName.test(slot.name) || names.has(slot.name)
      || typeof slot.required !== 'boolean' || slot.type !== 'secret' || slot.purpose !== 'file_access_auth') {
      throw new Error('文件 Engine 秘密槽位无效')
    }
    names.add(slot.name)
    return { name: slot.name, required: slot.required, type: 'secret', purpose: 'file_access_auth' }
  })
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return value === undefined || value === null ? undefined : objectValue(value, '文件 Profile 配置无效')
}

function cloneConfig(value: Record<string, unknown>): Record<string, unknown> {
  validateJSONValue(value, new WeakSet())
  const encoded = JSON.stringify(value)
  if (new TextEncoder().encode(encoded).byteLength > 64 * 1024) {
    throw new Error('文件 Profile 配置过大')
  }
  return JSON.parse(encoded) as Record<string, unknown>
}

function validateJSONValue(value: unknown, ancestors: WeakSet<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object') throw new Error('文件 Profile 配置不是有效 JSON')
  if (ancestors.has(value)) throw new Error('文件 Profile 配置不是有效 JSON')
  ancestors.add(value)
  if (Array.isArray(value)) {
    value.forEach((item) => validateJSONValue(item, ancestors))
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('文件 Profile 配置不是有效 JSON')
    }
    Object.values(value).forEach((item) => validateJSONValue(item, ancestors))
  }
  ancestors.delete(value)
}

function requiredString(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value
}

function optionalString(value: unknown, message: string) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(message)
  return value
}

function booleanValue(value: unknown, message: string) {
  if (typeof value !== 'boolean') throw new Error(message)
  return value
}

function integerValue(value: unknown, message: string) {
  if (!Number.isInteger(value)) throw new Error(message)
  return value as number
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function positiveInteger(value: unknown, message: string) {
  if (!isPositiveInteger(value)) throw new Error(message)
  return value
}

function nonNegativeInteger(value: unknown, message: string) {
  if (!isNonNegativeInteger(value)) throw new Error(message)
  return value
}

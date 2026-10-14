import { isRecord } from './validation.ts'
import { validOpaqueIdentifier } from './validation.ts'
import { isRuntimeDesktopBinding, type RuntimeDesktopResourceBinding } from './runtimeDesktopBinding.ts'

export interface RuntimeSSHResourceBinding {
  kind: 'ssh_session'
  session_id: string
  host_id: string
  ssh_profile_id: string
  host_name: string
  platform: 'linux'
  bound_at: string
}

export interface RuntimeSSHProfileBinding {
  kind: 'ssh_profile'
  ssh_profile_id: string
  ssh_profile_name: string
  host_id: string
  host_name: string
  platform: 'linux'
  bound_at: string
}

export interface RuntimeFileResourceBinding {
  kind: 'file_profile'
  file_access_profile_id: string
  file_access_profile_name: string
  host_id: string
  ssh_profile_id: string
  host_name: string
  engine: 'sftp'
  bound_at: string
}

export type RuntimeResourceBinding = RuntimeSSHResourceBinding | RuntimeSSHProfileBinding | RuntimeFileResourceBinding | RuntimeDesktopResourceBinding

function isRuntimeSSHResourceBinding(value: unknown): value is RuntimeSSHResourceBinding {
  if (!isRecord(value) || !hasExactKeys(value, [
    'kind',
    'session_id',
    'host_id',
    'ssh_profile_id',
    'host_name',
    'platform',
    'bound_at',
  ])) {
    return false
  }
  return value.kind === 'ssh_session'
    && validOpaqueIdentifier(value.session_id)
    && validOpaqueIdentifier(value.host_id)
    && validOpaqueIdentifier(value.ssh_profile_id)
    && typeof value.host_name === 'string'
    && value.host_name.trim().length > 0
    && Buffer.byteLength(value.host_name, 'utf8') <= 1024
    && value.platform === 'linux'
    && validRuntimeTimestamp(value.bound_at)
}

function isRuntimeSSHProfileBinding(value: unknown): value is RuntimeSSHProfileBinding {
  if (!isRecord(value) || !hasExactKeys(value, [
    'kind',
    'ssh_profile_id',
    'ssh_profile_name',
    'host_id',
    'host_name',
    'platform',
    'bound_at',
  ])) {
    return false
  }
  return value.kind === 'ssh_profile'
    && validOpaqueIdentifier(value.ssh_profile_id)
    && typeof value.ssh_profile_name === 'string'
    && value.ssh_profile_name.trim().length > 0
    && Buffer.byteLength(value.ssh_profile_name, 'utf8') <= 1024
    && validOpaqueIdentifier(value.host_id)
    && typeof value.host_name === 'string'
    && value.host_name.trim().length > 0
    && Buffer.byteLength(value.host_name, 'utf8') <= 1024
    && value.platform === 'linux'
    && validRuntimeTimestamp(value.bound_at)
}

function isRuntimeFileResourceBinding(value: unknown): value is RuntimeFileResourceBinding {
  return isRecord(value) && hasExactKeys(value, [
    'kind', 'file_access_profile_id', 'file_access_profile_name', 'host_id', 'ssh_profile_id', 'host_name', 'engine', 'bound_at',
  ]) && value.kind === 'file_profile' && value.engine === 'sftp'
    && validOpaqueIdentifier(value.file_access_profile_id) && validOpaqueIdentifier(value.host_id)
    && validOpaqueIdentifier(value.ssh_profile_id)
    && typeof value.file_access_profile_name === 'string' && value.file_access_profile_name.trim().length > 0
    && Buffer.byteLength(value.file_access_profile_name, 'utf8') <= 1024
    && typeof value.host_name === 'string' && value.host_name.trim().length > 0
    && Buffer.byteLength(value.host_name, 'utf8') <= 1024 && validRuntimeTimestamp(value.bound_at)
}

export function isRuntimeResourceBindings(value: unknown): value is RuntimeResourceBinding[] {
  return Array.isArray(value) && value.length <= 4
    && value.every((binding) => isRuntimeSSHResourceBinding(binding)
      || isRuntimeSSHProfileBinding(binding)
      || isRuntimeFileResourceBinding(binding) || isRuntimeDesktopBinding(binding))
    && new Set(value.map((binding: RuntimeResourceBinding) => binding.kind)).size === value.length
    && value.filter((binding: RuntimeResourceBinding) => binding.kind === 'ssh_profile' || binding.kind === 'ssh_session').length <= 1
    && value.filter((binding: RuntimeResourceBinding) => binding.kind === 'desktop_profile' || binding.kind === 'desktop_session').length <= 1
}

export function normalizeRuntimeResourceBindings(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.session)) return false
  const session = value.session
  const legacy = session.resource_binding
  if (legacy !== undefined && !isRuntimeSSHResourceBinding(legacy)) return false
  const bindings = session.resource_bindings === undefined ? (legacy ? [legacy] : []) : session.resource_bindings
  if (!isRuntimeResourceBindings(bindings)) return false
  if (legacy) {
    const ssh = bindings.find((binding) => binding.kind === 'ssh_session')
    if (!ssh || Object.keys(legacy).some((key) => Reflect.get(ssh, key) !== Reflect.get(legacy, key))) return false
  }
  // 兼容字段只在入口对账，冻结后的 Worker 会话只有一份规范状态。
  const order: Record<RuntimeResourceBinding['kind'], number> = {
    ssh_session: 0, ssh_profile: 0, file_profile: 1, desktop_session: 2, desktop_profile: 2, desktop_workflow: 3,
  }
  session.resource_bindings = [...bindings].sort((left, right) => order[left.kind] - order[right.kind])
  delete session.resource_binding
  return true
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function validRuntimeTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 64
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && Number.isFinite(Date.parse(value))
}

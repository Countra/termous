import { isRecord } from './validation.ts'

interface DesktopBinding {
  desktop_profile_id: string
  desktop_profile_name: string
  host_id: string
  host_name: string
  protocol: 'rdp' | 'vnc'
  bound_at: string
}
export type RuntimeDesktopBinding = DesktopBinding & (
  | { kind: 'desktop_session'; session_id: string; connection_generation: number }
  | { kind: 'desktop_profile' }
)
export interface RuntimeWorkflowBinding {
  kind: 'desktop_workflow'; workflow_id: string; workflow_name: string; workflow_version: number
  host_name: string; bound_at: string
}
export type RuntimeDesktopResourceBinding = RuntimeDesktopBinding | RuntimeWorkflowBinding

export function isRuntimeDesktopBinding(value: unknown): value is RuntimeDesktopResourceBinding {
  if (!isRecord(value) || typeof value.bound_at !== 'string' || value.bound_at.length > 64 || !Number.isFinite(Date.parse(value.bound_at))) return false
  const common = ['kind', 'host_name', 'bound_at']
  if (value.kind === 'desktop_workflow') return exact(value, [...common, 'workflow_id', 'workflow_name', 'workflow_version'])
    && id(value.workflow_id) && name(value.workflow_name) && positive(value.workflow_version) && value.host_name === ''
  const fields = [...common, 'desktop_profile_id', 'desktop_profile_name', 'host_id', 'protocol']
  if (value.kind === 'desktop_session') fields.push('session_id', 'connection_generation')
  if (value.kind !== 'desktop_session' && value.kind !== 'desktop_profile' || !exact(value, fields)) return false
  return id(value.desktop_profile_id) && id(value.host_id) && name(value.desktop_profile_name) && name(value.host_name)
    && (value.protocol === 'rdp' || value.protocol === 'vnc')
    && (value.kind !== 'desktop_session' || id(value.session_id) && positive(value.connection_generation))
}

export function runtimeDesktopIdentity(binding: RuntimeDesktopResourceBinding) {
  return binding.kind === 'desktop_workflow'
    ? { kind: binding.kind, script_id: binding.workflow_id, version: binding.workflow_version, binding_mode: 'exact' }
    : { kind: binding.kind, profile_id: binding.desktop_profile_id, host_id: binding.host_id, protocol: binding.protocol, binding_mode: 'exact',
        ...(binding.kind === 'desktop_session' ? { session_id: binding.session_id, connection_generation: binding.connection_generation } : {}) }
}

function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)) }
function id(value: unknown) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
function name(value: unknown) { return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= 1024 }
function positive(value: unknown) { return Number.isSafeInteger(value) && Number(value) > 0 }

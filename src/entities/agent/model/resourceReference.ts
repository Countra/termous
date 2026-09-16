import type {
  AgentLaunchIntent,
  AgentFileResourceBinding,
  AgentResourceBinding,
  AgentResourceKind,
  AgentResourceReference,
  AgentResourceSlot,
  AgentResourceState,
  AgentSSHSlotResourceBinding,
} from './types.ts'
import { sameTerminalReferenceSource, type AgentReferenceTargetsSnapshot } from './terminalReference.ts'

export type AgentConnectionReferenceLaunch = Omit<Extract<AgentLaunchIntent, { source: 'connection_reference' }>, 'key'>
export type AgentConnectionResourceReference = AgentConnectionReferenceLaunch['resource_reference']
export type AgentConnectionResourceState = AgentConnectionReferenceLaunch['source_resource']
export type AgentResourceReferenceLaunch = AgentConnectionReferenceLaunch | Omit<Extract<AgentLaunchIntent, { source: 'terminal_selection' }>, 'key'>
export type AgentReferenceTarget = AgentConnectionReferenceLaunch['target']

export function getAgentResourceBinding<K extends AgentResourceKind>(bindings: readonly AgentResourceBinding[] | undefined, kind: K) {
  return bindings?.find((binding): binding is Extract<AgentResourceBinding, { kind: K }> => binding.kind === kind)
}

export function agentResourceSlot(kind: AgentResourceKind): AgentResourceSlot {
  return kind === 'file_profile' ? 'file' : 'ssh'
}

export function getAgentResourceBindingBySlot(
  bindings: readonly AgentResourceBinding[] | undefined,
  slot: 'ssh',
): AgentSSHSlotResourceBinding | undefined
export function getAgentResourceBindingBySlot(
  bindings: readonly AgentResourceBinding[] | undefined,
  slot: 'file',
): AgentFileResourceBinding | undefined
export function getAgentResourceBindingBySlot(
  bindings: readonly AgentResourceBinding[] | undefined,
  slot: AgentResourceSlot,
): AgentResourceBinding | undefined
export function getAgentResourceBindingBySlot(
  bindings: readonly AgentResourceBinding[] | undefined,
  slot: AgentResourceSlot,
) {
  return bindings?.find((binding) => agentResourceSlot(binding.kind) === slot)
}

export function resourceReference(source: AgentConnectionResourceState): AgentConnectionResourceReference
export function resourceReference(source: AgentResourceState | AgentResourceBinding): AgentResourceReference
export function resourceReference(source: AgentResourceState | AgentResourceBinding): AgentResourceReference {
  if ('file_access_profile_id' in source) {
    return { kind: 'file_profile', file_access_profile_id: source.file_access_profile_id }
  }
  if ('session_id' in source) return { kind: 'ssh_session', session_id: source.session_id }
  return { kind: 'ssh_profile', ssh_profile_id: source.ssh_profile_id }
}

export function resourceReferenceId(reference: AgentResourceReference) {
  if (reference.kind === 'ssh_session') return reference.session_id
  return reference.kind === 'ssh_profile' ? reference.ssh_profile_id : reference.file_access_profile_id
}

// 确认只属于当时的引用身份；展示名称变化无需中断操作，重新绑定则必须重新确认。
export function agentResourceBindingKey(binding: AgentResourceBinding | null | undefined): string {
  if (!binding) return JSON.stringify(null)
  if (binding.kind === 'file_profile') {
    return JSON.stringify([binding.kind, binding.file_access_profile_id, binding.engine, binding.bound_at])
  }
  return JSON.stringify([
    binding.kind, resourceReferenceId(resourceReference(binding)), binding.host_id, binding.ssh_profile_id,
    binding.platform, binding.bound_at,
  ])
}

export function resourceProfileName(resource: AgentResourceState) {
  return 'file_access_profile_name' in resource ? resource.file_access_profile_name : resource.ssh_profile_name
}

export function sameAgentResourceSource(captured: AgentResourceState, current: AgentResourceState | undefined): boolean {
  if ('file_access_profile_id' in captured) {
    return Boolean(current && 'file_access_profile_id' in current && current.status === 'ready'
      && current.file_access_profile_id === captured.file_access_profile_id && current.engine === captured.engine)
  }
  if ('session_id' in captured) {
    return current !== undefined && 'session_id' in current && sameTerminalReferenceSource(captured, current)
  }
  return Boolean(current && !('session_id' in current) && !('file_access_profile_id' in current)
    && current.status === 'ready' && current.ssh_profile_id === captured.ssh_profile_id
    && current.host_id === captured.host_id && current.platform === captured.platform)
}

export function resourceBindingMatchesSource(binding: AgentResourceBinding | undefined, source: AgentResourceState): boolean {
  if ('file_access_profile_id' in source) {
    return Boolean(binding && binding.kind === 'file_profile'
      && binding.file_access_profile_id === source.file_access_profile_id
      && binding.engine === source.engine)
  }
  if ('session_id' in source) {
    return Boolean(binding && binding.kind === 'ssh_session'
      && binding.host_id === source.host_id
      && binding.ssh_profile_id === source.ssh_profile_id
      && binding.session_id === source.session_id)
  }
  return Boolean(binding && binding.kind === 'ssh_profile'
    && binding.host_id === source.host_id
    && binding.ssh_profile_id === source.ssh_profile_id
    && binding.platform === source.platform)
}

export interface AgentConnectionReferenceSnapshot {
  ready: boolean
  source?: AgentConnectionResourceState
  targets: Array<AgentReferenceTargetsSnapshot['targets'][number] & { disabled?: boolean; disabled_reason?: 'binding_locked' }>
}

export interface AgentConnectionReferenceProps {
  getAgentConnectionReferenceSnapshot?: (reference: AgentConnectionResourceReference) => AgentConnectionReferenceSnapshot
  onReferenceAgentConnection?: (source: AgentConnectionResourceState, target: AgentReferenceTarget) => void
}

export function connectionReferenceMenuProps(reference: AgentConnectionResourceReference | undefined, props: AgentConnectionReferenceProps) {
  return {
    getSnapshot: reference && props.getAgentConnectionReferenceSnapshot ? () => {
      const snapshot = props.getAgentConnectionReferenceSnapshot?.(reference)
      return snapshot ? { ...snapshot, enabled: snapshot.source?.status === 'ready' } : undefined
    } : undefined,
    onSelect: props.onReferenceAgentConnection,
  }
}

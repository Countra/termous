import { hostDesktopTargetKey, isHostDesktopTarget, type HostDesktopTarget } from '#common/contracts'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { isRecord } from './validation.ts'
import type { RuntimeResourceBinding } from './resourceBindings.ts'

export type ObservationTarget = HostDesktopTarget | { kind: 'protocol_session'; session_id: string; connection_generation: number }

export interface DesktopObservationState {
  current(): ObservationTarget | undefined
  selected(): ObservationTarget | undefined
  observe(name: string, args: Record<string, unknown>, data: Record<string, unknown>): void
  project(result: AgentToolResult<unknown>): AgentToolResult<unknown>
}

export function observationTarget(value: unknown): ObservationTarget | undefined {
  if (!isRecord(value)) return undefined
  if (isHostDesktopTarget(value) && value.instance_id.length <= 256 && value.host.id.length <= 256) {
    return { kind: 'host_desktop', instance_id: value.instance_id,
      host: { id: value.host.id, kind: value.host.kind, generation: value.host.generation, title: '' } }
  }
  if (value.kind !== undefined && value.kind !== 'protocol_session') return undefined
  const protocol = value.kind === 'protocol_session' && isRecord(value.protocol) ? value.protocol : value
  if (typeof protocol.session_id === 'string' && protocol.session_id.length > 0 && protocol.session_id.length <= 256
    && Number.isSafeInteger(protocol.connection_generation) && Number(protocol.connection_generation) > 0) {
    // 执行端可随正常释放重建；续接只固定连接身份，不携带旧执行代次或附着。
    return { kind: 'protocol_session', session_id: protocol.session_id, connection_generation: Number(protocol.connection_generation) }
  }
  return undefined
}

export function observationTargetKey(target: ObservationTarget) {
  return target.kind === 'host_desktop' ? hostDesktopTargetKey(target) : JSON.stringify([target.session_id, target.connection_generation])
}

export function desktopBindingKey(bindings: readonly RuntimeResourceBinding[]) {
  const binding = bindings.find(value => ['host_desktop', 'desktop_session', 'desktop_profile'].includes(value.kind))
  if (!binding) return ''
  const identity = binding.kind === 'desktop_profile' ? binding.desktop_profile_id : boundObservationTarget(bindings)
  return JSON.stringify([binding.kind, identity, binding.bound_at])
}

export function boundObservationTarget(bindings: readonly RuntimeResourceBinding[]) {
  const binding = bindings.find(value => ['host_desktop', 'desktop_session', 'desktop_profile'].includes(value.kind))
  if (binding?.kind === 'host_desktop') return observationTarget(binding.desktop_target)
  if (binding?.kind === 'desktop_session') return observationTarget({ session_id: binding.session_id, connection_generation: binding.connection_generation })
  return undefined
}

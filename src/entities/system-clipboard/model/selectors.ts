import type { SystemClipboardConnectionState, SystemClipboardOperation } from '#common/contracts'
import { systemClipboardCapabilities } from './store.ts'

export function selectSystemClipboardOperation(state: SystemClipboardConnectionState, operation: SystemClipboardOperation) {
  const capability = state.snapshot?.capabilities[operation]
  const visible = !!capability && capability.state !== 'unsupported'
  const available = visible && state.status === 'connected' && capability.state === 'ready'
  const reason = available ? undefined : state.status !== 'connected' ? state.reason ?? 'service_unavailable' : capability?.reason
  return { visible, available, reason }
}

export function getSystemClipboardOperation(operation: SystemClipboardOperation) {
  return selectSystemClipboardOperation(systemClipboardCapabilities.get(), operation)
}

export function systemClipboardReasonKey(reason?: string) {
  switch (reason) {
    case 'initialization_failed': return 'systemClipboard.initializationFailed'
    case 'service_stopped': return 'systemClipboard.serviceStopped'
    case 'invalid_response': return 'systemClipboard.invalidResponse'
    default: return 'systemClipboard.unavailable'
  }
}

import type { SystemClipboardCapabilitiesSnapshot, SystemClipboardConnectionState } from '#common/contracts'

export class ClipboardCapabilitiesState {
  private value: SystemClipboardConnectionState = { version: 0, status: 'loading' }
  private listeners = new Set<(state: SystemClipboardConnectionState) => void>()
  get = () => this.value
  subscribe = (listener: (state: SystemClipboardConnectionState) => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  offline(reason = 'service_unavailable') { this.publish({ ...this.value, status: 'disconnected', reason }) }
  accept(snapshot: SystemClipboardCapabilitiesSnapshot) {
    const old = this.value.snapshot
    if (old?.instance_id === snapshot.instance_id && old.revision > snapshot.revision) return
    if (this.value.status === 'connected' && old?.instance_id === snapshot.instance_id && old.revision === snapshot.revision) return
    this.publish({ status: 'connected', snapshot })
  }
  private publish(value: Omit<SystemClipboardConnectionState, 'version'>) {
    this.value = { ...value, version: this.value.version + 1 }
    for (const listener of this.listeners) listener(this.value)
  }
}

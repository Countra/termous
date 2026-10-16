import { decodeSystemClipboardCapabilities, type SystemClipboardCapabilitiesBridge, type SystemClipboardConnectionState } from '#common/contracts'

export type SystemClipboardGateway = SystemClipboardCapabilitiesBridge
const initial: SystemClipboardConnectionState = { version: 0, status: 'loading' }

export class SystemClipboardStore {
  private state = initial
  private epoch = 0
  private listeners = new Set<() => void>()
  get = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(state: SystemClipboardConnectionState) {
    this.state = state
    for (const listener of this.listeners) listener()
  }
  connect(gateway?: SystemClipboardGateway) {
    const epoch = ++this.epoch
    this.publish(gateway ? initial : { version: 0, status: 'unsupported', reason: 'bridge_unavailable' })
    if (!gateway) return () => { if (epoch === this.epoch) this.epoch++ }
    let lastVersion = -1
    const receive = (value: SystemClipboardConnectionState) => {
      if (epoch !== this.epoch) return
      try {
        if (!value || !Number.isSafeInteger(value.version) || value.version < 0 || !['loading', 'connected', 'disconnected', 'unsupported'].includes(value.status)) throw new Error('SYSTEM_CLIPBOARD_INVALID_RESPONSE')
        if (value.version <= lastVersion) return
        const snapshot = value.snapshot ? decodeSystemClipboardCapabilities(value.snapshot) : undefined
        if (value.status === 'connected' && !snapshot) throw new Error('SYSTEM_CLIPBOARD_INVALID_RESPONSE')
        const previous = this.state.snapshot
        if (snapshot?.instance_id === previous?.instance_id && snapshot && previous && snapshot.revision < previous.revision) return
        lastVersion = value.version
        this.publish({ ...value, snapshot })
      } catch { offline('invalid_response') }
    }
    const offline = (reason = 'service_unavailable') => {
      if (epoch === this.epoch) this.publish({ ...this.state, status: 'disconnected', reason })
    }
    // 先订阅再读取，主进程的单调版本阻止迟到初始化覆盖新事件。
    const unsubscribe = gateway.subscribe(receive)
    void gateway.get().then(receive).catch(() => { if (lastVersion < 0) offline() })
    return () => {
      unsubscribe()
      if (epoch === this.epoch) { this.epoch++; this.publish({ ...this.state, status: 'disconnected', reason: 'service_unavailable' }) }
    }
  }
}

export const systemClipboardCapabilities = new SystemClipboardStore()

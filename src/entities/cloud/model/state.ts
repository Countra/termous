import { cloudAccountAreas, type CloudStatus, type CloudEvent, type CloudAccountChange } from '#common/contracts'

// HTTP 请求携带本地代次，账号切换及权威事件到达后拒绝旧响应回写。
export class CloudState {
  private value?: CloudStatus
  private listeners = new Set<() => void>()
  private changes = new Set<(value: CloudAccountChange) => void>()
  private retired = new Set<string>()
  epoch = 0
  snapshot = () => this.value
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  subscribeChanges = (listener: (value: CloudAccountChange) => void) => { this.changes.add(listener); return () => { this.changes.delete(listener) } }
  acceptEvent(event: CloudEvent) {
    this.accept(event.status)
    // 同绑定的失效提示不依赖状态版本，HTTP 先返回较新状态时仍需刷新对应页面。
    if (this.value?.generation !== event.status.generation) return
    const changes = event.type === 'snapshot' || event.type === 'resync' ? [...cloudAccountAreas] : event.changes ?? []
    if (changes.length) this.changes.forEach(listener => listener({ generation: event.status.generation, changes, operations: event.operations ?? [] }))
  }
  accept(value: CloudStatus, epoch = this.epoch) {
    if (epoch !== this.epoch || this.retired.has(value.generation)) return false
    if (this.value?.generation === value.generation && this.value.revision > value.revision) return false
    if (this.value?.generation !== value.generation) {
      if (this.value) this.retired.add(this.value.generation)
      this.epoch++
    }
    this.value = value
    this.listeners.forEach((listener) => listener())
    return true
  }
}

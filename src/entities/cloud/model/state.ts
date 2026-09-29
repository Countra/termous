import type { CloudStatus } from '#common/contracts'

// HTTP 请求携带本地代次，账号切换及权威事件到达后拒绝旧响应回写。
export class CloudState {
  private value?: CloudStatus
  private listeners = new Set<() => void>()
  private retired = new Set<string>()
  epoch = 0
  snapshot = () => this.value
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
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

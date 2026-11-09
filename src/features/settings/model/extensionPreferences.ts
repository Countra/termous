import type { SettingsSnapshot } from '#common/contracts'
import type { SettingsGateway } from '#entities/settings'

export type ExtensionPreferenceId = 'mcp_integrations' | 'web_search' | 'local_network'
export interface ExtensionPreferenceState {
  value?: Record<string, unknown>
  status: 'idle' | 'editing' | 'saving' | 'saved' | 'failed'
  error?: string
}
export const emptyExtensionPreference: ExtensionPreferenceState = { status: 'idle' }
// 确认快照会复制数组；直连清单按条目比较，避免相同内容被视为修改。
const difference = (value: Record<string, unknown>, base: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key, item]) => {
  const previous = base[key]
  return item !== previous && !(Array.isArray(item) && Array.isArray(previous)
    && item.length === previous.length && item.every((entry, index) => entry === previous[index]))
}))
const complete = (id: ExtensionPreferenceId, value: Record<string, unknown>) => {
  if (id === 'local_network') return !value.enabled || typeof value.url === 'string' && Boolean(value.url.trim())
  return id !== 'web_search' || value.mode === 'cloud' || typeof value.base_url === 'string' && Boolean(value.base_url.trim())
}

// 草稿和提交队列跟随设置网关，切换分区或关闭设置不撤销已提交的修改。
export class ExtensionPreferences {
  private state = emptyExtensionPreference
  private baseline?: SettingsSnapshot
  private generation = 0
  private pending = false
  private queued = false
  private observing = false
  private listeners = new Set<() => void>()
  private readonly gateway: SettingsGateway
  private readonly id: ExtensionPreferenceId
  constructor(gateway: SettingsGateway, id: ExtensionPreferenceId) { this.gateway = gateway; this.id = id }
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (!this.observing) { this.observing = true; this.gateway.subscribeSettings(this.receive) }
    this.receive()
    return () => { this.listeners.delete(listener) }
  }
  private publish(patch: Partial<ExtensionPreferenceState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  private receive = () => {
    const snapshot = this.gateway.getModule(this.id)
    if (!snapshot) {
      if (!this.baseline) return
      this.generation++; this.pending = this.queued = false; this.baseline = undefined
      this.publish({ ...emptyExtensionPreference, value: undefined, error: undefined })
    } else if (!this.baseline || this.state.status === 'idle' || this.state.status === 'saved') {
      this.baseline = snapshot
      if (this.state.value !== snapshot.value) this.publish({ value: snapshot.value })
    }
  }
  change = (patch: Record<string, unknown>) => {
    if (!this.baseline || !this.state.value) return
    const value = { ...this.state.value, ...patch }
    if (!Object.keys(difference(value, this.state.value)).length) return
    this.publish({ value, error: undefined, status: this.pending ? 'saving' : Object.keys(difference(value, this.baseline.value)).length ? 'editing' : 'saved' })
  }
  commit = () => {
    // 失焦、重试和离开设置共用此入口，统一处理地址两侧空白。
    if (this.id === 'local_network' && typeof this.state.value?.url === 'string') this.change({ url: this.state.value.url.trim() })
    if (!this.state.value || !complete(this.id, this.state.value)) return
    this.queued = true; void this.drain()
  }
  retry = () => {
    const latest = this.gateway.getModule(this.id)
    if (latest && this.baseline && this.state.value) {
      const changes = difference(this.state.value, this.baseline.value)
      this.baseline = latest
      this.publish({ value: { ...latest.value, ...changes } })
    }
    this.commit()
  }
  reset = () => {
    if (this.pending) return
    const latest = this.gateway.getModule(this.id)
    if (latest) { this.baseline = latest; this.publish({ value: latest.value, status: 'saved', error: undefined }) }
  }
  private async drain() {
    if (this.pending || !this.baseline || !this.state.value) return
    this.pending = true
    const generation = this.generation
    try {
      while (this.queued) {
        this.queued = false
        const submitted = this.state.value!
        // 等待前次提交时仍可编辑，实际出队时再次确认完整性，保留未填完的草稿。
        if (!complete(this.id, submitted)) break
        const patch = difference(submitted, this.baseline!.value)
        if (!Object.keys(patch).length) { this.publish({ status: 'saved', error: undefined }); continue }
        this.publish({ status: 'saving', error: undefined })
        const result = await this.gateway.updateModule(this.id, patch, { expectedRevision: this.baseline!.revision })
        if (generation !== this.generation) return
        // 回执只确认本次提交；请求期间继续编辑的字段保留，下一次失焦再提交。
        const later = difference(this.state.value!, submitted)
        this.baseline = result
        const value = { ...result.value, ...later }
        this.publish({ value, status: Object.keys(difference(value, result.value)).length ? 'editing' : 'saved' })
      }
    } catch (cause) {
      // 冲突与网络失败均保留草稿，交由用户重试，不自动覆盖其他窗口的修改。
      if (generation === this.generation) { this.queued = false; this.publish({ status: 'failed', error: cause instanceof Error ? cause.message : String(cause) }) }
    } finally { if (generation === this.generation) this.pending = false }
  }
}

const editors = new WeakMap<SettingsGateway, Map<ExtensionPreferenceId, ExtensionPreferences>>()
export function extensionPreferences(gateway: SettingsGateway, id: ExtensionPreferenceId) {
  let values = editors.get(gateway)
  if (!values) { values = new Map(); editors.set(gateway, values) }
  let editor = values.get(id)
  if (!editor) { editor = new ExtensionPreferences(gateway, id); values.set(id, editor) }
  return editor
}

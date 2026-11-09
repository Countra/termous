import type { PresentationDefaults } from '@termous/remote-protocol/presentation'
import { decodePresentationDefaults, type SettingsGateway } from '#entities/settings'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'
interface EditorState { draft?: PresentationDefaults; status: SaveStatus; invalidSnapshot: boolean }
export const emptyPresentationEditor: EditorState = { status: 'idle', invalidSnapshot: false }
const equal = (left: PresentationDefaults | undefined, right: PresentationDefaults) => JSON.stringify(left) === JSON.stringify(right)

// 队列属于设置实例，页面离开不撤销已提交的意图；实例重置仍清空草稿和迟到回执。
class PresentationDefaultsAutosave {
  private state: EditorState = emptyPresentationEditor
  private confirmed?: { value: PresentationDefaults; revision: number }
  private queued?: PresentationDefaults
  private dirty = false
  private pending = false
  private generation = 0
  private observing = false
  private listeners = new Set<() => void>()
  private readonly gateway: SettingsGateway
  constructor(gateway: SettingsGateway) { this.gateway = gateway }
  snapshot = () => this.state
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (!this.observing) {
      this.observing = true
      this.gateway.subscribeSettings(this.receive)
    }
    this.receive()
    return () => { this.listeners.delete(listener) }
  }
  private publish(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  private receive = () => {
    const snapshot = this.gateway.getModule('desktop_presentation')
    if (!snapshot) {
      if (!this.confirmed && !this.state.draft) return
      this.generation++
      this.confirmed = undefined
      this.queued = undefined
      this.dirty = this.pending = false
      this.publish({ ...emptyPresentationEditor, draft: undefined })
      return
    }
    try {
      const value = decodePresentationDefaults(snapshot.value)
      this.confirmed = { value, revision: snapshot.revision }
      // 冲突刷新与外部事件更新确认版本，但不覆盖未完成或保存失败的草稿。
      this.publish({ invalidSnapshot: false, ...(!this.dirty ? { draft: value } : {}) })
    } catch { this.publish({ invalidSnapshot: true }) }
  }
  change = (next: PresentationDefaults) => {
    if (!this.confirmed || equal(this.state.draft, next)) return
    this.dirty = true
    this.queued = next
    this.publish({ draft: next })
    void this.drain()
  }
  retry = () => {
    if (!this.state.draft) return
    this.queued = this.state.draft
    void this.drain()
  }
  private async drain() {
    if (this.pending || !this.confirmed) return
    this.pending = true
    const generation = this.generation
    this.publish({ status: 'saving' })
    try {
      while (this.queued) {
        const next = this.queued
        this.queued = undefined
        if (!equal(this.confirmed.value, next)) {
          const result = await this.gateway.updateModule('desktop_presentation', { ...next }, { expectedRevision: this.confirmed.revision })
          if (generation !== this.generation) return
          this.confirmed = { value: decodePresentationDefaults(result.value), revision: result.revision }
        }
        if (!this.queued) {
          this.dirty = false
          this.publish({ draft: this.confirmed.value, status: 'saved' })
        }
      }
    } catch {
      // 网关负责修订冲突和实例隔离；失败只保留最新草稿，不自动覆盖外部修改。
      if (generation === this.generation) {
        this.queued = undefined
        this.publish({ status: 'failed' })
      }
    } finally {
      if (generation === this.generation) this.pending = false
    }
  }
}

const editors = new WeakMap<SettingsGateway, PresentationDefaultsAutosave>()
export function presentationDefaultsAutosave(gateway: SettingsGateway) {
  let editor = editors.get(gateway)
  if (!editor) { editor = new PresentationDefaultsAutosave(gateway); editors.set(gateway, editor) }
  return editor
}

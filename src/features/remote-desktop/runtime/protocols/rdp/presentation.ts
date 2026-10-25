import { PresentationController, type PresentationPreference, type PresentationSettings, type PresentationState, type PresentationObservation } from '@termous/remote-protocol/presentation'
import type { PixelPresentationRequest, PixelPresentationState } from '@termous/rdp-protocol'

type Request = Pick<PixelPresentationRequest, 'sessionGeneration' | 'operationId' | 'expectedRevision' | 'updateRateLimit'>
type Pending = { configuration: boolean; resolve(state: PresentationState): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }

export class PixelPresentation {
  readonly controller: PresentationController
  private pending = new Map<string, Pending>()
  private closed = false
  constructor(private readonly generation: bigint, private readonly send: (request: Request) => boolean | undefined, changed: (state: PresentationState) => void, preference: PresentationPreference = {}) {
    this.controller = new PresentationController({ configure: (settings, operationId, revision) => {
      if (settings.kind !== 'pixels') return Promise.reject(new Error('desktop_capability_unsupported'))
      return this.request(operationId, revision, settings.updateRateLimit)
    } }, changed, preference)
  }
  start() { void this.query().catch(() => { if (!this.closed) this.controller.update({ capabilities: { kind: 'pixels', available: false, reason: 'desktop_presentation_unconfirmed' }, revision: 0n, configRevision: 0n, status: 'uncertain' }) }) }
  private query() { return this.request(crypto.randomUUID(), 0n) }
  private request(operationId: string, expectedRevision: bigint, updateRateLimit?: number): Promise<PresentationState> {
    if (this.closed || this.pending.size >= 2) return Promise.reject(new Error('desktop_presentation_unavailable'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(operationId)
        if (updateRateLimit !== undefined) this.controller.unconfirmed(expectedRevision + 1n, 'desktop_presentation_unconfirmed')
        reject(new Error('desktop_presentation_unconfirmed'))
        if (updateRateLimit !== undefined && !this.closed) void this.query().catch(() => { /* 原配置保留未确认状态，等待下次明确请求。 */ })
      }, 5000)
      this.pending.set(operationId, { configuration: updateRateLimit !== undefined, resolve, reject, timer })
      if (!this.send({ sessionGeneration: this.generation, operationId, expectedRevision, updateRateLimit })) {
        clearTimeout(timer); this.pending.delete(operationId); reject(new Error('desktop_presentation_unavailable'))
      }
    })
  }
  receive(value: PixelPresentationState) {
    if (this.closed) return
    const pending = this.pending.get(value.operationId)
    const completed = !!value.errorCode || !pending?.configuration || value.revision === value.appliedRevision
    if (pending && completed) { clearTimeout(pending.timer); this.pending.delete(value.operationId) }
    if (value.errorCode) { pending?.reject(new Error(value.errorCode)); return }
    const state: PresentationState = {
      capabilities: { kind: 'pixels', available: true, maxUpdateRate: 30, scope: 'viewer', applyMode: 'immediate', confirmation: 'configuration' },
      requested: { kind: 'pixels', updateRateLimit: value.requestedRate }, appliedPixels: { updateRateLimit: value.appliedRate },
      revision: value.revision, configRevision: value.appliedRevision, status: value.revision === value.appliedRevision ? 'applied' : 'confirming',
    }
    this.controller.update(state)
    if (completed) pending?.resolve(state)
  }
  set(settings: PresentationSettings) { this.controller.set(settings) }
  observe(value: PresentationObservation) { this.controller.observe(value) }
  dispose() {
    this.closed = true; this.controller.dispose()
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('desktop_presentation_closed')) }
    this.pending.clear()
  }
}

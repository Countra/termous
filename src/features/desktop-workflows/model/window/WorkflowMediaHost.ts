import { isWorkflowDetachedMedia, workflowMediaLimit, type WorkflowDetachedMedia } from '#common/contracts'
import type { ImageTarget } from '#entities/desktop-workflow'
import type { WorkflowController } from '../workspace/WorkflowController'
import type { WorkflowMediaGateway } from '../workspace/types'

export class WorkflowMediaHost {
  private previews = new Set<string>()
  private uploaded = new Set<string>()
  private epoch = 0
  private opening = 0
  constructor(private readonly gateway: WorkflowMediaGateway, private readonly controller: WorkflowController) {}
  private assetAllowed(id: string) {
    if (this.uploaded.has(id)) return true
    const model = this.controller.getSnapshot()
    const report = model.execution.report
    const definition = report.definition
    // 仅允许已发布草稿、版本、执行证据及当前报告的固定版本资源，不开放任意文件读取。
    const values = [model.state.draft?.definition, model.state.versions, report.value?.steps,
      definition?.status === 'ready' && definition.runID === report.value?.run.id ? definition.value : undefined]
    const contains = (value: unknown): boolean => !!value && typeof value === 'object' && Object.entries(value).some(([key, item]) =>
      key === 'asset_id' ? item === id : typeof item === 'object' && contains(item))
    return values.some(contains)
  }
  async handle(payload: WorkflowDetachedMedia) {
    if (!isWorkflowDetachedMedia(payload)) throw new Error('workflow_media_invalid')
    const epoch = this.epoch
    if (payload.kind === 'open') {
      const session = this.controller.getSnapshot().environment.sessions.find(item => item.id === payload.session)
      if (this.previews.size + this.opening >= 4 || !session || session.connection_generation !== payload.generation) throw new Error('desktop_session_generation_changed')
      this.opening++
      try {
        const preview = await this.gateway.openPreview(payload.session, payload.generation)
        if (epoch !== this.epoch) { await this.gateway.closePreview(preview.id); throw new Error('detached_disconnected') }
        this.previews.add(preview.id); return preview
      } finally { this.opening-- }
    }
    if (payload.kind === 'upload') {
      const asset = await this.gateway.upload(new Blob([payload.bytes], { type: payload.type }))
      if (epoch === this.epoch) this.uploaded.add(asset.id)
      return asset
    }
    if (payload.kind === 'asset') {
      if (!this.assetAllowed(payload.id)) throw new Error('workflow_asset_unavailable')
      return this.binary(await this.gateway.asset(payload.id))
    }
    if (!this.previews.has(payload.id)) throw new Error('workflow_preview_unavailable')
    if (payload.kind === 'close') { await this.gateway.closePreview(payload.id); this.previews.delete(payload.id); return }
    if (payload.kind === 'capture') {
      const shot = await this.gateway.capture(payload.id)
      return { metadata: shot.metadata, ...await this.binary(shot.blob) }
    }
    if (payload.kind !== 'match') throw new Error('workflow_media_invalid')
    if (typeof payload.target.asset_id !== 'string' || !this.assetAllowed(payload.target.asset_id)) throw new Error('workflow_asset_unavailable')
    const located = await this.gateway.match(payload.id, payload.target as unknown as ImageTarget)
    return { capture: located.capture, result: located.result, ...await this.binary(located.image) }
  }
  private async binary(blob: Blob) {
    if (!['image/png', 'image/jpeg'].includes(blob.type) || blob.size > workflowMediaLimit) throw new Error('workflow_binary_limit')
    return { bytes: await blob.arrayBuffer(), type: blob.type }
  }
  async reset() {
    this.epoch++; this.uploaded.clear()
    const previews = [...this.previews]; this.previews.clear()
    const results = await Promise.allSettled(previews.map(id => this.gateway.closePreview(id)))
    if (results.some(result => result.status === 'rejected')) throw new Error('workflow_preview_cleanup_failed')
  }
}

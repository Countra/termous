import { hostDesktopTargetKey } from '#common/contracts'
import { handleAnalysisMedia } from '#entities/screen-analysis'
import { isWorkflowDetachedMedia, workflowMediaLimit, type WorkflowDetachedMedia } from '#common/contracts'
import type { ImageTarget } from '#entities/desktop-workflow'
import type { WorkflowController } from '../workspace/WorkflowController'
import type { WorkflowMediaGateway } from '../workspace/types'

export class WorkflowMediaHost {
  private previews = new Set<string>()
  private uploaded = new Set<string>()
  private epoch = 0
  private opening = 0
  private observations = new Map<string, { preview: string; controller: AbortController }>()
  private analysisReads = new Map<string, AbortController>()
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
    if (payload.kind === 'import-asset') {
      if (!this.gateway.importAsset) throw new Error('workflow_asset_unavailable')
      return this.binary(await this.gateway.importAsset(payload.id, payload.hash))
    }
    if (payload.kind === 'analysis-read-cancel') { this.analysisReads.get(payload.id)?.abort(); return }
    if (payload.kind === 'ocr-defaults') return this.gateway.ocrDefaults()
    if (payload.kind === 'ocr-report') {
      if (this.controller.getSnapshot().execution.report.value?.run.id !== payload.id) throw new Error('workflow_report_unavailable')
      const result = await this.gateway.ocrReport(payload.id,payload.index,payload.offset,payload.limit)
      if (epoch !== this.epoch || this.controller.getSnapshot().execution.report.value?.run.id !== payload.id) throw new Error('workflow_report_unavailable')
      return result
    }
    if (payload.kind === 'ocr-cancel') {
      const pending = this.observations.get(payload.request)
      if (pending?.preview === payload.id) pending.controller.abort()
      return
    }
    if (payload.kind === 'runtime-status') return this.gateway.runtimeStatus?.() ?? {}
    if (payload.kind === 'runtime-warmup') return this.gateway.warmupRuntime?.()
    if (payload.kind === 'runtime-settings') return this.gateway.openRuntimeSettings?.()
    if (payload.kind === 'analysis') {
      const request = payload.request
      if (request.operation === 'action-context' && !this.previews.has(request.preview)) throw new Error('workflow_preview_unavailable')
      if (request.operation === 'submit' && request.input.source.kind === 'preview' && !this.previews.has(request.input.source.id)) throw new Error('workflow_preview_unavailable')
      if (!payload.read_id) return handleAnalysisMedia(this.gateway, request)
      if (['submit', 'cancel', 'delete', 'clear'].includes(request.operation) || this.analysisReads.size >= 16 || this.analysisReads.has(payload.read_id)) throw new Error('workflow_media_invalid')
      const controller = new AbortController()
      this.analysisReads.set(payload.read_id, controller)
      try {
        const value = await handleAnalysisMedia(this.gateway, request, controller.signal)
        controller.signal.throwIfAborted()
        if (epoch !== this.epoch) throw new Error('detached_disconnected')
        return value
      } finally { this.analysisReads.delete(payload.read_id) }
    }
    if (payload.kind === 'open' || payload.kind === 'open-host') {
      const environment = this.controller.getSnapshot().environment
      const session = payload.kind === 'open' ? environment.sessions.find(item => item.id === payload.session) : undefined
      const allowed = payload.kind === 'open-host'
        ? environment.hostSources?.some(source => hostDesktopTargetKey(source.target) === hostDesktopTargetKey(payload.target))
        : !!session && session.connection_generation === payload.generation
      if (this.previews.size + this.opening >= 4 || !allowed) throw new Error('desktop_session_generation_changed')
      this.opening++
      try {
        const preview = payload.kind === 'open-host' ? await this.gateway.openPreview('', 0, payload.target) : await this.gateway.openPreview(payload.session, payload.generation)
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
    if (payload.kind === 'ocr-preview') {
      if (this.observations.size >= 4 || this.observations.has(payload.request)) throw new Error('desktop_workflow_busy')
      const controller = new AbortController()
      this.observations.set(payload.request,{ preview: payload.id,controller })
      try {
        const result = await this.gateway.previewOCR(payload.id,payload.query,controller.signal)
        controller.signal.throwIfAborted()
        const image = await this.binary(result.image)
        controller.signal.throwIfAborted()
        if (epoch !== this.epoch || !this.previews.has(payload.id)) throw new Error('workflow_preview_unavailable')
        return { capture:result.capture, observation:result.observation, ...image }
      } finally { this.observations.delete(payload.request) }
    }
    if (payload.kind === 'close') {
      for (const value of this.observations.values()) if (value.preview === payload.id) value.controller.abort()
      await this.gateway.closePreview(payload.id); this.previews.delete(payload.id); return
    }
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
    for (const value of this.analysisReads.values()) value.abort()
    this.analysisReads.clear()
    for (const value of this.observations.values()) value.controller.abort()
    this.epoch++; this.uploaded.clear()
    const previews = [...this.previews]; this.previews.clear()
    const results = await Promise.allSettled(previews.map(id => this.gateway.closePreview(id)))
    if (results.some(result => result.status === 'rejected')) throw new Error('workflow_preview_cleanup_failed')
  }
}

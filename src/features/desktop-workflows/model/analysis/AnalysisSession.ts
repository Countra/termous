import { hostDesktopTargetKey, type HostDesktopTarget, type AnalysisRecord, type AnalysisSubmit } from '#common/contracts'
import type { WorkflowMediaGateway } from '../workspace/types'

// 预览和提交归属于工作台会话；关闭查看器只卸载读模型，不终止已接受的任务。
export class AnalysisSession {
  private preview?: { id: string; key: string; expires: number }
  private pending?: { content: string; id: string }
  private capture?: Promise<void>
  private submitting?: Promise<AnalysisRecord>
  private disposed = false
  private lease?: ReturnType<typeof setTimeout>
  live?: { id: string; preview: string; key: string }
  constructor(private readonly gateway: WorkflowMediaGateway) {}
  submit(session: { id: string; generation: number; target?: HostDesktopTarget }, parameters: AnalysisSubmit['parameters'], onSubmitted: (record: AnalysisRecord) => void) {
    if (this.submitting) return this.submitting
    const task = this.submitCapture(session, parameters, onSubmitted)
    this.submitting = task
    void task.then(() => { this.submitting = undefined }, () => { this.submitting = undefined })
    return task
  }
  private async submitCapture(session: { id: string; generation: number; target?: HostDesktopTarget }, parameters: AnalysisSubmit['parameters'], onSubmitted: (record: AnalysisRecord) => void) {
    const key = session.target ? hostDesktopTargetKey(session.target) : `${session.id}:${session.generation}`
    if (this.disposed) throw new Error('workflow_preview_unavailable')
    if (this.preview && (this.preview.key !== key || this.preview.expires <= Date.now())) await this.releasePreview()
    if (!this.preview) {
      const value = await this.gateway.openPreview(session.id, session.generation, session.target)
      if (this.disposed) { await this.gateway.closePreview(value.id); throw new Error('workflow_preview_unavailable') }
      this.preview = { id: value.id, key, expires: Date.now() + 14 * 60_000 }
      this.lease = setTimeout(() => { void this.release().catch(reason => console.warn('[termous:workflow] 到期分析预览清理失败', reason)) }, 14 * 60_000)
    }
    const preview = this.preview
    const input = { source: { kind: 'preview' as const, id: preview.id }, parameters }
    const record = await this.request(input)
    this.live = { id: record.id, preview: preview.id, key }
    onSubmitted(record)
    // 等到截图保存后再允许窗口交接释放预览；等待期限覆盖 Core 的捕获期限。
    this.capture = this.waitCapture(record)
    try { await this.capture } finally { this.capture = undefined }
    return record
  }
  async reanalyze(id: string, parameters: AnalysisSubmit['parameters']) {
    return this.request({ source: { kind: 'analysis', id }, parameters, reuse: false })
  }
  private async request(input: Omit<AnalysisSubmit, 'request_id'>) {
    const content = JSON.stringify(input)
    const pending = this.pending?.content === content ? this.pending : { content, id: crypto.randomUUID() }
    this.pending = pending
    const record = await this.gateway.submitAnalysis({ ...input, request_id: pending.id })
    this.pending = undefined
    return record
  }
  private async waitCapture(record: AnalysisRecord) {
    const deadline = Date.now() + 35_000
    let lastError: unknown
    while (record.state === 'preparing' && !record.sha256 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 300))
      try {
        record = await this.gateway.getAnalysis(record.id, AbortSignal.timeout(Math.max(1, deadline - Date.now())))
        lastError = undefined
      } catch (error) {
        // 读取短暂失败不能提前释放仍在捕获的预览，最多保留至捕获期限结束。
        lastError = error
      }
    }
    if (lastError) throw lastError
  }
  async release() {
    if (this.submitting) await this.submitting.catch(() => undefined)
    await this.releasePreview()
  }
  private async releasePreview() {
    clearTimeout(this.lease); this.lease = undefined
    const preview = this.preview
    this.preview = undefined; this.live = undefined
    if (this.capture) await this.capture.catch(() => undefined)
    if (preview) await this.gateway.closePreview(preview.id)
  }
  async dispose() {
    this.disposed = true
    // 提交失败仍须释放预览；错误已由提交调用方报告，不阻断清理。
    if (this.submitting) await this.submitting.catch(() => undefined)
    await this.releasePreview()
  }
}

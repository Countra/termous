import type { DetachedConnection, WorkflowFileBridge, WorkflowFileRequest } from '#common/contracts'
import type { WorkflowExchangeGateway, WorkflowGateway, WorkflowImportCommit, WorkflowImportReceipt } from '#entities/desktop-workflow'
import { workflowFailure, type WorkflowDraft } from '../workspace/types'
import type { ExchangeCommand, ExchangeState } from './types'

interface Context { draft?: WorkflowDraft; dirty: boolean; token: string }
interface Host {
  context(): Context
  changed(state: ExchangeState): void
  committed(receipt: WorkflowImportReceipt, context: Context): Promise<void>
}
export class WorkflowExchangeController {
  private state: ExchangeState
  private generation = 0
  private disposed = false
  private operation?: string
  private abort?: AbortController
  private pendingCommit?: WorkflowImportCommit
  private unsubscribe?: () => void
  constructor(private gateway: WorkflowExchangeGateway | undefined, private files: WorkflowFileBridge | undefined,
    private workflow: WorkflowGateway, private host: Host) {
    this.state = { available: !!gateway && !!files, busy: false }
  }
  activate() {
    // 订阅属于挂载生命周期，不能在 React 的渲染构造阶段注册；StrictMode 清理后允许重新挂载。
    this.disposed = false
    this.unsubscribe ??= this.files?.onProgress(progress => { if (progress.operation_id === this.operation) this.update({ progress }) })
    this.host.changed(this.state)
  }
  getSnapshot() { return this.state }
  private update(patch: Partial<ExchangeState>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.host.changed(this.state) } }
  async asset(id: string, hash: string, signal?: AbortSignal) {
    if (!this.gateway || this.state.preview?.id !== id || !this.state.preview.assets?.some(a => a.sha256 === hash)) throw new Error('workflow_asset_unavailable')
    return this.gateway.asset(id, hash, signal)
  }
  async dispatch(command: ExchangeCommand, origin?: DetachedConnection) {
    if (command.kind === 'cancel' || command.kind === 'close') { await this.cancel(); return }
    if (command.kind === 'open-directory') { await this.openDirectory(command.location_id, origin); return }
    if (!this.gateway || !this.files || this.state.busy || this.disposed) return
    if (this.state.uncertain && command.kind !== 'commit') return
    if (command.kind === 'name') { if (!this.state.uncertain) this.update({ name: command.name }); return }
    const generation = ++this.generation
    const current = () => !this.disposed && generation === this.generation
    const update = (patch: Partial<ExchangeState>) => { if (current()) this.update(patch) }
    const context = this.host.context()
    this.update({ busy: true, error: undefined, exported: undefined, exportedLocation: undefined, openingDirectory: false, directoryError: undefined })
    const abort = new AbortController(); this.abort = abort
    try {
      if (command.kind === 'import') {
        if (this.state.preview) await this.gateway.release(this.state.preview.id)
        if (!current()) return
        this.pendingCommit = undefined
        this.update({ preview: undefined, receipt: undefined, target: undefined, conflict: false, uncertain: false })
        if (abort.signal.aborted) return
        const response = await this.native({ kind: 'import', origin })
        if (response.import_id) {
          if (!current() || abort.signal.aborted) { await this.gateway.release(response.import_id); return }
          try {
            const preview = await this.gateway.inspect(response.import_id, abort.signal)
            if (!current() || abort.signal.aborted) { await this.gateway.release(response.import_id); return }
            update({ preview, name: preview.manifest?.name })
          } catch (error) {
            await this.gateway.release(response.import_id).catch(() => console.warn('[termous:workflow] 导入预览将由有效期回收'))
            throw error
          }
        }
      } else if (command.kind === 'target') {
        const target = command.id ? await this.workflow.get(command.id) : undefined
        if (!abort.signal.aborted) update({ target, conflict: false })
      } else if (command.kind === 'commit') {
        if (!this.state.preview || this.state.conflict) return
        const importID = this.state.preview.id
        const target = this.state.target?.script
        const input = this.pendingCommit ?? (target
          ? { mode: 'update', script_id: target.id, expected_revision: target.revision, name: this.state.name }
          : { mode: 'create', name: this.state.name }) as WorkflowImportCommit
        this.pendingCommit = input
        let receipt: WorkflowImportReceipt
        try { receipt = await this.gateway.commit(importID, input, abort.signal) }
        catch (error) {
          // 请求结束不代表事务未提交；先查回执，无法确认时锁定原参数供重试。
          const failure = workflowFailure(error)
          const view = await this.gateway.inspect(importID).catch(() => undefined)
          if (view?.receipt) receipt = view.receipt
          else {
            const uncertain = view?.state === 'committing' || !failure.status || failure.status >= 500 || failure.status === 408
            update({ uncertain, conflict: failure.code === 'desktop_workflow_revision_conflict' })
            if (current() && !uncertain) this.pendingCommit = undefined
            throw error
          }
        }
        if (current()) {
          this.pendingCommit = undefined
          update({ receipt, preview: undefined, target: undefined, uncertain: false })
          // 打开编辑器失败不改变提交成功结果，用户仍可从回执重新打开。
          await this.host.committed(receipt, context).catch(error => update({ error: workflowFailure(error) }))
        }
      } else if (command.kind === 'export') {
        const script = context.draft?.script
        if (!script || command.version === undefined && context.dirty) throw Object.assign(new Error('请先保存工作流'), { code: 'workflow_exchange_save_first' })
        if (this.state.preview) throw Object.assign(new Error('请先完成或关闭导入预览'), { code: 'desktop_workflow_exchange_busy' })
        update({ receipt: undefined, target: undefined, conflict: false })
        const response = await this.native({ kind: 'export', origin, script_id: script.id, version: command.version ?? script.revision, layout: command.layout })
        update({ exported: response.file_name, exportedLocation: response.location_id })
      }
    } catch (error) {
      // 普通读取取消只结束当前交互；提交取消仍需查询回执并保留不确定状态。
      if (!abort.signal.aborted || command.kind === 'commit') update({ error: workflowFailure(error) })
    }
    finally { if (current()) { this.abort = undefined; this.operation = undefined; update({ busy: false, progress: undefined }) } }
  }
  private async native(request: Omit<WorkflowFileRequest, 'operation_id'>) {
    this.operation = crypto.randomUUID()
    const response = await this.files!.run({ ...request, operation_id: this.operation })
    if (response.error) throw Object.assign(new Error(response.error.message), response.error)
    return response
  }
  private async openDirectory(location: string, origin?: DetachedConnection) {
    // 独立窗口可能仍展示上一份回执，不能把迟到点击转换为打开新的导出位置。
    if (!this.files || !this.state.exported || !location || location !== this.state.exportedLocation || this.state.busy || this.state.openingDirectory || this.disposed) return
    const generation = this.generation
    const current = () => !this.disposed && generation === this.generation && this.state.exportedLocation === location
    this.update({ openingDirectory: true, directoryError: undefined })
    try {
      const response = await this.files.openDirectory({ location_id: location, origin })
      if (response.error) throw Object.assign(new Error(response.error.message), response.error)
    } catch (error) {
      // 打开目录失败不能覆盖导出回执；关闭窗口或开始新操作后忽略迟到结果。
      if (current()) this.update({ directoryError: workflowFailure(error) })
    } finally { if (current()) this.update({ openingDirectory: false }) }
  }
  private async cancel() {
    if (this.disposed) return
    if (this.state.busy) {
      this.abort?.abort()
      if (this.operation) await this.files?.cancel(this.operation)
      return
    }
    if (this.state.uncertain) return
    const generation = this.generation
    try {
      if (this.state.preview) await this.gateway?.release(this.state.preview.id)
      if (generation === this.generation) this.update({ preview: undefined, error: undefined, receipt: undefined, exported: undefined, target: undefined,
        exportedLocation: undefined, openingDirectory: false, directoryError: undefined })
    } catch (error) { if (generation === this.generation) this.update({ error: workflowFailure(error) }) }
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true; this.generation++; this.unsubscribe?.(); this.abort?.abort()
    this.unsubscribe = undefined
    const uncertain = this.state.uncertain || !!this.pendingCommit
    const cleanup = this.operation ? this.files?.cancel(this.operation) : !uncertain && this.state.preview ? this.gateway?.release(this.state.preview.id) : undefined
    this.operation = undefined; this.abort = undefined
    this.state = { ...this.state, busy: false, progress: undefined, openingDirectory: false, uncertain, ...(!uncertain ? { preview: undefined } : {}) }
    void cleanup?.catch(() => console.warn('[termous:workflow] 文件交换资源将由租约回收'))
  }
}

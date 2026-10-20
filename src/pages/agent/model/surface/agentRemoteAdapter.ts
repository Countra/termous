import { agentDetachedCommands, canTransferAgentDetachedFiles, isAgentDetachedCommand, isAgentDetachedNoArgumentCommand,
  type AgentDetachedCommandName, type AgentDetachedFile } from '#common/contracts'
import type { DetachedClient } from '#shared/detached-window'
import type { AgentSurfaceModel } from './agentSurfaceModel.ts'
import { agentEditorOwner } from './agentSurfaceProjection.ts'
import { AgentPendingReceipts } from './agentPendingReceipts.ts'

const requiresInputReceipt = new Set<AgentDetachedCommandName>([
  'workspace.onCreateSession', 'workspace.onSelectSession', 'workspace.onReturnToActiveRun',
  'workspace.onArchiveSession', 'workspace.onDeleteSession', 'workspace.onSend', 'workspace.onQueueTurn',
  'workspace.onBeginQueuedTurnEdit', 'workspace.onSaveQueuedTurnEdit', 'workspace.onCancelQueuedTurnEdit',
  'workspace.onExecuteSlashCommand',
])

export class AgentRemoteAdapter {
  private sequence = 0
  private readonly receipts = new AgentPendingReceipts()
  private echoes = new Map<string, { value: string; sequence: number }>()
  private revision = 0
  private readonly listeners = new Set<() => void>()
  constructor(readonly client: DetachedClient, private readonly report: () => void) { }
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly getSnapshot = () => this.revision
  private changed() { this.revision++; for (const listener of this.listeners) listener() }

  connect(model: AgentSurfaceModel, capabilities: AgentDetachedCommandName[], acknowledged: number): AgentSurfaceModel {
    this.sequence = Math.max(this.sequence, acknowledged)
    for (const [key, value] of this.echoes) if (value.sequence <= acknowledged) this.echoes.delete(key)
    const owner = agentEditorOwner(model)
    const groups = {
      workspace: model.workspace, management: model.workspace?.session_management, archive: model.archive,
      readiness: model.readiness, reference: model.reference, surface: model
    }
    for (const name of agentDetachedCommands) {
      if (!capabilities.includes(name)) continue
      const [group, key] = name.split('.')
      const target = groups[group as keyof typeof groups] as Record<string, unknown> | undefined
      if (!target) continue
      target[key] = (...suppliedArgs: unknown[]) => {
        // 无参数业务回调可能直接绑定按钮；React 点击事件不能进入跨窗口命令。
        const args = isAgentDetachedNoArgumentCommand(name) ? [] : suppliedArgs
        const input = name === 'workspace.onDraftChange' || name === 'workspace.onQueuedTurnEditChange'
        const sequence = input ? ++this.sequence : undefined
        const payload = { name, args, owner, inputSequence: sequence }
        if (!isAgentDetachedCommand(payload)) {
          const operation = Promise.reject(new Error('agent_command_invalid'))
          void operation.catch(this.report)
          return operation
        }
        if (input) { this.echoes.set(`${owner}:${name}`, { value: args[0] as string, sequence: sequence! }); this.changed() }
        const operation = input
          ? this.receipts.start(`${owner}:${name}`, id => this.client.peer.request('command', payload, 10000, id))
          : (requiresInputReceipt.has(name) ? this.receipts.flush(false) : Promise.resolve())
            .then(() => this.client.peer.request('command', payload, 120000))
        // Widget 中无返回值的事件同样需要收敛拒绝；需要结果的操作仍向调用者返回失败。
        void operation.catch(this.report)
        return operation
      }
    }
    if (model.workspace) {
      const workspace = model.workspace
      const draft = this.echoes.get(`${owner}:workspace.onDraftChange`)
      const edit = this.echoes.get(`${owner}:workspace.onQueuedTurnEditChange`)
      if (draft) workspace.draft = draft.value
      if (edit && workspace.queued_turn_edit) workspace.queued_turn_edit = { ...workspace.queued_turn_edit, text: edit.value }
      workspace.onAttachFiles = async files => {
        if (!files.length) return
        // 传输校验失败的文件不进入回执队列，避免 Main 丢弃无效载荷后永久阻塞交接。
        if (!canTransferAgentDetachedFiles(files)) { this.report(); return }
        const task = this.receipts.start(crypto.randomUUID(), async id => {
          const payload: AgentDetachedFile[] = await Promise.all(files.map(async file => ({ name: file.name, type: file.type, lastModified: file.lastModified, bytes: await file.arrayBuffer() })))
          await this.client.peer.request('binary', { kind: 'attach', files: payload, owner }, 10000, id)
        })
        try { await task } catch { this.report() }
      }
      workspace.onLoadLocalAttachment = this.loadLocalAttachment
      workspace.onLoadAttachmentContent = this.loadAttachmentContent
      workspace.onLoadToolImage = this.loadToolImage
    }
    if (model.archive && model.workspace) {
      model.archive.onLoadAttachmentContent = model.workspace.onLoadAttachmentContent
      model.archive.onLoadToolImage = model.workspace.onLoadToolImage
    }
    return model
  }

  // 状态流更新不改变读取能力的身份，避免缩略图和预览反复取消、重新读取。
  private readonly loadLocalAttachment = (clientId: string, signal?: AbortSignal) => this.load({ kind: 'local', clientId }, signal)
  private readonly loadAttachmentContent: NonNullable<AgentSurfaceModel['workspace']>['onLoadAttachmentContent'] =
    (source, signal) => this.load({ kind: 'attachment', source }, signal)
  private readonly loadToolImage: NonNullable<AgentSurfaceModel['workspace']>['onLoadToolImage'] =
    (source, signal) => this.load({ kind: 'image', source }, signal)

  private async load(payload: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const result = await this.client.peer.request('binary', payload, 30000) as { bytes: ArrayBuffer; type: string }
    signal?.throwIfAborted()
    return new Blob([result.bytes], { type: result.type })
  }

  async flush() {
    await this.receipts.flush()
  }
}

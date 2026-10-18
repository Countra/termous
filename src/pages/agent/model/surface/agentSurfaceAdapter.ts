import { isAgentDetachedBinary, isAgentDetachedCommand, type AgentDetachedBinary, type DetachedPacket } from '#common/contracts'
import type { AgentFeedbackStore } from './agentFeedback.ts'
import type { AgentSurfaceModel } from './agentSurfaceModel.ts'
import { agentEditorOwner, agentSurfaceActions } from './agentSurfaceProjection.ts'
import { resolveAgentBinarySource } from './agentBinarySources.ts'

export class AgentSurfaceAdapter {
  model: AgentSurfaceModel = {}
  inputSequence = 0
  constructor(private readonly feedback: AgentFeedbackStore, private readonly attachmentError: () => string) { }

  retainResponse(packet: DetachedPacket) {
    if (packet.operation === 'binary' && isAgentDetachedBinary(packet.payload)) return packet.payload.kind === 'attach'
    if (packet.operation === 'command' && isAgentDetachedCommand(packet.payload)) {
      // 输入另有单调序号保护；频繁输入无需占用整代业务命令的去重表。
      return !['workspace.onDraftChange', 'workspace.onQueuedTurnEditChange'].includes(packet.payload.name)
    }
    return true
  }

  async handle(packet: DetachedPacket) {
    if (packet.operation === 'binary') {
      if (!isAgentDetachedBinary(packet.payload)) throw new Error('agent_binary_invalid')
      return this.binary(packet.payload)
    }
    if (packet.operation !== 'command' || !isAgentDetachedCommand(packet.payload)) throw new Error('agent_command_invalid')
    const command = packet.payload
    if (command.name === 'feedback.answer') { this.feedback.answer(command.args[0] as string, command.args[1] as boolean); return }
    if (command.name === 'feedback.dismiss') { this.feedback.dismiss(command.args[0] as string, command.args[1] as string); return }
    // 已确认输入的重试只补回执；会话随后切换也不能把它误判为未保存内容而阻塞收回。
    if (command.inputSequence !== undefined && command.inputSequence <= this.inputSequence) return
    if (command.name.startsWith('workspace.') && command.owner !== agentEditorOwner(this.model)) throw new Error('agent_editor_changed')
    const action = agentSurfaceActions(this.model).get(command.name)
    if (!action) throw new Error('agent_command_unavailable')
    const result = action(...command.args)
    if (command.inputSequence !== undefined) this.inputSequence = command.inputSequence
    return await result
  }

  private async binary(request: AgentDetachedBinary) {
    const workspace = this.model.workspace
    if (!workspace) throw new Error('agent_workspace_unavailable')
    if (request.kind === 'attach') {
      if (request.owner !== agentEditorOwner(this.model)) throw new Error('agent_editor_changed')
      const files = request.files.map(file => new File([file.bytes], file.name, { type: file.type, lastModified: file.lastModified }))
      // 收到完整文件后，上传归宿主持有；交接不等待网络上传完成。
      void workspace.onAttachFiles(files).catch(() => this.feedback.notification.error({ title: this.attachmentError() }))
      return { received: true }
    }
    let blob: Blob
    if (request.kind === 'local') {
      const file = workspace.draft_attachments.find(item => item.client_id === request.clientId)?.file
      if (!file) throw new Error('agent_attachment_missing')
      blob = file
    } else blob = await resolveAgentBinarySource(this.model, request)
    if (blob.size > 20.5 * 1024 * 1024) throw new Error('agent_binary_limit')
    return { bytes: await blob.arrayBuffer(), type: blob.type }
  }
}

import { isWorkflowDetachedCommand, isWorkflowDetachedMedia, workflowDetachedInputs, type DetachedPacket, type WorkflowDetachedAction } from '#common/contracts'
import type { WorkflowController } from '../workspace/WorkflowController'
import { workflowFailure } from '../workspace/types'
import { WorkflowMediaHost } from './WorkflowMediaHost'

const draftActions = new Set(['change', 'selectStep', 'save', 'validate', 'history', 'restore', 'remove', 'copy', 'openRun'])

export class WorkflowSurfaceAdapter {
  inputSequence = 0
  readonly media: WorkflowMediaHost
  constructor(private readonly controller: WorkflowController) {
    this.media = new WorkflowMediaHost(controller.media, controller)
  }
  retainResponse(packet: DetachedPacket) {
    if (packet.operation === 'binary' && isWorkflowDetachedMedia(packet.payload)) return ['open', 'close', 'upload'].includes(packet.payload.kind)
    return packet.operation !== 'command' || !isWorkflowDetachedCommand(packet.payload)
      || !(workflowDetachedInputs as readonly string[]).includes(packet.payload.name)
  }
  async handle(packet: DetachedPacket) {
    try {
      if (packet.operation === 'binary' && isWorkflowDetachedMedia(packet.payload)) return { ok: true, value: await this.media.handle(packet.payload) }
      if (packet.operation !== 'command' || !isWorkflowDetachedCommand(packet.payload)) throw new Error('workflow_command_invalid')
      const command = packet.payload
      // 已确认的输入只补回执，不能在切换脚本后再次应用旧草稿。
      if (command.inputSequence !== undefined && command.inputSequence <= this.inputSequence) return { ok: true }
      if (draftActions.has(command.name) && command.owner !== this.controller.getSnapshot().state.draft?.editingID) throw new Error('workflow_editor_changed')
      const actions = this.controller.actions as unknown as Record<WorkflowDetachedAction, (...args: unknown[]) => unknown>
      const value = actions[command.name](...command.args)
      if (command.inputSequence !== undefined) this.inputSequence = command.inputSequence
      return { ok: true, value: await value }
    } catch (reason) { return { ok: false, error: workflowFailure(reason) } }
  }
}

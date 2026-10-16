import {
  isAgentResourceRecoveryBlocking
} from '#entities/agent'
import {
  isAgentResourceBindingConnectionBlocking
} from '#features/agent-runtime'
import type { AgentSurfaceModel } from '../surface/agentSurfaceModel.ts'

interface Context {
  selected: import('#entities/agent').AgentSession | undefined
  workspaceInfrastructureReady: boolean
  perform: (operation: () => Promise<unknown>, errorContext?: "generic" | "resource", lane?: import('./agentHostHelpers.ts').AgentOperationLane) => Promise<boolean>
  slashExecutionSessionIdsRef: React.RefObject<Set<string>>
  recovery: ReturnType<typeof import('#features/agent-runtime').useAgentResourceRecovery>
  profileConnection: ReturnType<typeof import('#features/agent-runtime').useAgentResourceBindingConnection>
  controller: import('#features/agent-runtime').AgentWorkspaceController
  draftAttachments: ReturnType<typeof import('#features/agent-runtime').useAgentDraftAttachments>
  resourceContexts: import('#widgets/agent-workspace').AgentWorkspaceResourceContext[]
  committedQueuedTurnEditSessionIdsRef: React.RefObject<Set<string>>
}

export function createAgentQueueActions({ selected, workspaceInfrastructureReady, perform, slashExecutionSessionIdsRef, recovery, profileConnection, controller, draftAttachments, resourceContexts, committedQueuedTurnEditSessionIdsRef }: Context) {
  const actions: Pick<NonNullable<AgentSurfaceModel['workspace']>, 'onQueueTurn' | 'onBeginQueuedTurnEdit' | 'onQueuedTurnEditChange' | 'onRemoveQueuedTurnEditAttachment' | 'onSaveQueuedTurnEdit' | 'onCancelQueuedTurnEdit' | 'onDeleteQueuedTurn' | 'onMoveQueuedTurn' | 'onSteerQueuedTurn' | 'onResumeQueue'> = {
    onQueueTurn: async (message, attachmentIds) => {
      if (!selected || !workspaceInfrastructureReady) return
      await perform(async () => {
        if (slashExecutionSessionIdsRef.current.has(selected.id)) {
          throw new Error('AGENT_RESOURCE_BINDING_UNAVAILABLE')
        }
        if (isAgentResourceRecoveryBlocking(recovery.coordinator.getSnapshot()[selected.id])
          || isAgentResourceBindingConnectionBlocking(profileConnection.coordinator.getSnapshot()[selected.id])) {
          throw new Error('AGENT_RESOURCE_BINDING_UNAVAILABLE')
        }
        const submittedDraft = controller.getSnapshot().drafts[selected.id]
        await controller.enqueueTurn(selected.id, message, attachmentIds)
        if (controller.getSnapshot().drafts[selected.id] === submittedDraft) {
          controller.updateDraft(selected.id, '')
        }
        draftAttachments.clearCommitted(selected.id, attachmentIds ?? [])
      }, resourceContexts.length ? 'resource' : 'generic', 'queue')
    },
    onBeginQueuedTurnEdit: async (turnId) => {
      if (selected) await perform(
        () => controller.beginQueuedTurnEdit(selected.id, turnId),
        'generic',
        'queue',
      )
    },
    onQueuedTurnEditChange: (value) => {
      if (selected) controller.updateQueuedTurnEditDraft(selected.id, value)
    },
    onRemoveQueuedTurnEditAttachment: (attachmentId) => {
      if (selected) controller.removeQueuedTurnEditAttachment(selected.id, attachmentId)
    },
    onSaveQueuedTurnEdit: async (attachmentIds) => {
      if (!selected) return
      const edit = controller.getSnapshot().queued_turn_edits[selected.id]
      const retainedAttachmentIds = edit?.retained_attachment_ids ?? []
      await perform(async () => {
        committedQueuedTurnEditSessionIdsRef.current.add(selected.id)
        try {
          await controller.saveQueuedTurnEdit(selected.id, [...retainedAttachmentIds, ...attachmentIds])
        } catch (error) {
          committedQueuedTurnEditSessionIdsRef.current.delete(selected.id)
          throw error
        }
      }, 'generic', 'queue')
    },
    onCancelQueuedTurnEdit: async () => {
      if (selected) {
        await perform(() => controller.cancelQueuedTurnEdit(selected.id), 'generic', 'queue')
      }
    },
    onDeleteQueuedTurn: async (turnId) => {
      if (selected) await perform(
        () => controller.deleteQueuedTurn(selected.id, turnId),
        'generic',
        'queue',
      )
    },
    onMoveQueuedTurn: async (turnId, targetTurnId, placement) => {
      if (!selected) return false
      return await perform(() => (
        controller.moveQueuedTurn(selected.id, turnId, targetTurnId, placement)
      ), 'generic', 'queue')
    },
    onSteerQueuedTurn: async (turnId) => {
      if (selected && workspaceInfrastructureReady) await perform(
        () => controller.steerQueuedTurn(selected.id, turnId),
        'generic',
        'queue',
      )
    },
    onResumeQueue: async () => {
      if (selected && workspaceInfrastructureReady
        && !slashExecutionSessionIdsRef.current.has(selected.id)
        && !isAgentResourceRecoveryBlocking(recovery.coordinator.getSnapshot()[selected.id])
        && !isAgentResourceBindingConnectionBlocking(profileConnection.coordinator.getSnapshot()[selected.id])) {
        await perform(() => controller.resumeQueue(selected.id), 'generic', 'queue')
      }
    },
  }

  return actions
}

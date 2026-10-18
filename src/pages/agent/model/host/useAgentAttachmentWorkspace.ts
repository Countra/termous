import {
  useAgentDraftAttachments
} from '#features/agent-runtime'
import { termousNotificationClassName } from '#shared/ui'
import { useCallback, useEffect } from 'react'

interface Context {
  notificationRef: React.RefObject<import('../surface/agentFeedback.ts').AgentFeedback['notification']>
  tRef: React.RefObject<import('i18next').TFunction<"translation", undefined>>
  gateway: import('#features/agent-runtime').AgentWorkspaceGateway
  ensureAttachmentSession: () => Promise<string>
  controller: import('#features/agent-runtime').AgentWorkspaceController
  committedQueuedTurnEditSessionIdsRef: React.RefObject<Set<string>>
  getQueuedEditOwner: (sessionId: string) => string | undefined
  state: import('#features/agent-runtime').AgentWorkspaceState
  previousQueuedTurnEditSessionIdsRef: React.RefObject<Map<string, string>>
}

export function useAgentAttachmentWorkspace({ notificationRef, tRef, gateway, ensureAttachmentSession, controller, committedQueuedTurnEditSessionIdsRef, getQueuedEditOwner, state, previousQueuedTurnEditSessionIdsRef }: Context) {
  const reportAttachmentError = useCallback((code: string) => {
    notificationRef.current.error({
      title: tRef.current('agent.attachments.failed'),
      description: tRef.current(`agent.attachments.error.${code}`, {
        defaultValue: tRef.current('agent.attachments.error.unknown'),
      }),
      className: termousNotificationClassName,
    })
  }, [notificationRef, tRef])
  const loadAttachmentContent = useCallback(
    (attachment: import('#entities/agent').AgentAttachment, signal?: AbortSignal) => (
      gateway.attachmentContent(attachment.id, signal)
    ),
    [gateway],
  )
  const loadToolImage = useCallback(
    (image: import('#entities/agent').AgentToolImageSource, signal?: AbortSignal) => gateway.toolImageContent(image, signal),
    [gateway],
  )
  const draftAttachments = useAgentDraftAttachments({
    gateway,
    ensureSession: ensureAttachmentSession,
    onError: reportAttachmentError,
    getOwnerId: () => 'draft',
  })
  const queuedTurnEditExistingSelections = useCallback((sessionId: string) => {
    const edit = controller.getSnapshot().queued_turn_edits[sessionId]
    const turn = controller.getSnapshot().queued_turns[sessionId]
      ?.find(({ id }) => id === edit?.turn_id)
    const retained = new Set(edit?.retained_attachment_ids ?? [])
    return (turn?.attachments ?? [])
      .filter(({ id }) => retained.has(id))
      .map(({ kind, size_bytes }) => ({ kind, size_bytes }))
  }, [controller])
  const queuedTurnEditAttachments = useAgentDraftAttachments({
    gateway,
    ensureSession: ensureAttachmentSession,
    onError: reportAttachmentError,
    existingSelections: queuedTurnEditExistingSelections,
    getOwnerId: (sessionId) => committedQueuedTurnEditSessionIdsRef.current.has(sessionId)
      ? undefined : getQueuedEditOwner(sessionId),
  })

  useEffect(() => {
    const current = new Map(Object.keys(state.queued_turn_edits ?? {}).flatMap((sessionId) => {
      const owner = getQueuedEditOwner(sessionId)
      return owner ? [[sessionId, owner] as const] : []
    }))
    for (const [sessionId, owner] of previousQueuedTurnEditSessionIdsRef.current) {
      if (current.get(sessionId) === owner) continue
      void queuedTurnEditAttachments.discardOwner(sessionId, owner, committedQueuedTurnEditSessionIdsRef.current.delete(sessionId))
    }
    previousQueuedTurnEditSessionIdsRef.current = current
  }, [committedQueuedTurnEditSessionIdsRef, getQueuedEditOwner, previousQueuedTurnEditSessionIdsRef, queuedTurnEditAttachments, state.queued_turn_edits])

  return { loadAttachmentContent, loadToolImage, draftAttachments, queuedTurnEditAttachments }
}

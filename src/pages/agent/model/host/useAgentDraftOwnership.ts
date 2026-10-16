import {
  isAgentModelRunnable,
  type AgentResourceReference,
  type AgentSession
} from '#entities/agent'
import { useCallback } from 'react'
import { resolveAgentModelReasoningLevel } from '../agentModelSelection.ts'

interface Context {
  controller: import('#features/agent-runtime').AgentWorkspaceController
  newSessionModelId: string | undefined
  modelById: Map<string, import('#entities/agent').AgentModel>
  providerById: Map<string, import('#entities/agent').AgentModelProvider>
  tRef: React.RefObject<import('i18next').TFunction<"translation", undefined>>
  draftGroupId: string | undefined
  newSessionReasoningLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  setDraftGroupId: React.Dispatch<React.SetStateAction<string | undefined>>
  draftSessionCoordinator: import('#features/agent-runtime').AgentDraftSessionCoordinator
}

export function useAgentDraftOwnership({ controller, newSessionModelId, modelById, providerById, tRef, draftGroupId, newSessionReasoningLevel, setDraftGroupId, draftSessionCoordinator }: Context) {
  const createDraftSession = useCallback(async (
    resourceReference?: AgentResourceReference,
    selectionRevision = controller.getSnapshot().selection_intent_revision,
    select = true,
  ) => {
    const modelId = newSessionModelId
    if (!modelId) throw new Error('AGENT_DEFAULT_MODEL_MISSING')
    const model = modelById.get(modelId)
    if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
      throw new Error('AGENT_MODEL_UNAVAILABLE')
    }
    const session = await controller.createSession({
      title: tRef.current('agent.sessions.untitled'),
      group_id: resourceReference ? undefined : draftGroupId,
      auto_title_allowed: true,
      model_id: modelId,
      reasoning_level: resolveAgentModelReasoningLevel(model, newSessionReasoningLevel),
      resource_reference: resourceReference,
    }, selectionRevision, select)
    const current = controller.getSnapshot()
    if (current.selected_session_id === session.id && current.selection_intent_revision === selectionRevision + 1
      && !resourceReference) setDraftGroupId(undefined)
    return session
  }, [controller, draftGroupId, modelById, newSessionModelId, newSessionReasoningLevel, providerById, setDraftGroupId, tRef])

  const ensureDraftSession = useCallback((selectionRevision: number) => {
    return draftSessionCoordinator.ensure(
      selectionRevision,
      () => createDraftSession(undefined, selectionRevision, false),
    )
  }, [createDraftSession, draftSessionCoordinator])

  const ensureAttachmentSession = useCallback(async () => {
    const selection = controller.getSnapshot()
    if (selection.selected_session_id) return selection.selected_session_id
    const pendingSession = ensureDraftSession(selection.selection_intent_revision)
    let session: AgentSession
    try {
      session = await pendingSession
    } finally {
      draftSessionCoordinator.release(pendingSession)
    }
    const current = controller.getSnapshot()
    const ownsDraft = !current.selected_session_id
      && current.selection_intent_revision === selection.selection_intent_revision
    const newDraft = (ownsDraft ? current : selection).drafts.new?.text ?? ''
    // 同代草稿始终采用完成时内容；用户另开草稿后，迟到回执只保留原代快照。
    if (ownsDraft || newDraft && !current.drafts[session.id]) controller.updateDraft(session.id, newDraft)
    if (ownsDraft) {
      controller.updateDraft('new', '')
      controller.selectSession(session.id)
      setDraftGroupId(undefined)
    }
    return session.id
  }, [controller, draftSessionCoordinator, ensureDraftSession, setDraftGroupId])

  return { createDraftSession, ensureDraftSession, ensureAttachmentSession }
}

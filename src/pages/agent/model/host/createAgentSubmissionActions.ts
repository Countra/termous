import {
  isAgentModelRunnable,
  isAgentResourceRecoveryBlocking
} from '#entities/agent'
import {
  isAgentResourceBindingConnectionBlocking
} from '#features/agent-runtime'
import { resolveAgentModelReasoningLevel } from '../agentModelSelection.ts'
import type { AgentSurfaceModel } from '../surface/agentSurfaceModel.ts'
import { createSessionTitle } from './agentHostHelpers.ts'

interface Context {
  activeSetupReady: boolean
  workspaceInfrastructureReady: boolean
  perform: (operation: () => Promise<unknown>, errorContext?: "generic" | "resource", lane?: import('./agentHostHelpers.ts').AgentOperationLane) => Promise<boolean>
  controller: import('#features/agent-runtime').AgentWorkspaceController
  slashExecutionSessionIdsRef: React.RefObject<Set<string>>
  resourceRunBlocked: boolean
  selected: import('#entities/agent').AgentSession | undefined
  recovery: ReturnType<typeof import('#features/agent-runtime').useAgentResourceRecovery>
  profileConnection: ReturnType<typeof import('#features/agent-runtime').useAgentResourceBindingConnection>
  draftSessionCoordinator: import('#features/agent-runtime').AgentDraftSessionCoordinator
  newSessionModelId: string | undefined
  modelById: Map<string, import('#entities/agent').AgentModel>
  providerById: Map<string, import('#entities/agent').AgentModelProvider>
  t: import('i18next').TFunction<"translation", undefined>
  draftGroupId: string | undefined
  newSessionReasoningLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  setDraftModelId: React.Dispatch<React.SetStateAction<string | undefined>>
  readiness: import('#entities/agent').AgentReadiness
  firstRunnableModelId: string | undefined
  setDraftReasoningLevel: React.Dispatch<React.SetStateAction<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined>>
  setDraftGroupId: React.Dispatch<React.SetStateAction<string | undefined>>
  draftAttachments: ReturnType<typeof import('#features/agent-runtime').useAgentDraftAttachments>
  resourceContexts: import('#widgets/agent-workspace').AgentWorkspaceResourceContext[]
}

export function createAgentSubmissionActions({ activeSetupReady, workspaceInfrastructureReady, perform, controller, slashExecutionSessionIdsRef, resourceRunBlocked, selected, recovery, profileConnection, draftSessionCoordinator, newSessionModelId, modelById, providerById, t, draftGroupId, newSessionReasoningLevel, setDraftModelId, readiness, firstRunnableModelId, setDraftReasoningLevel, setDraftGroupId, draftAttachments, resourceContexts }: Context) {
  const actions: Pick<NonNullable<AgentSurfaceModel['workspace']>, 'onSend'> = {
    onSend: async (message, attachmentIds) => {
      if (!activeSetupReady || !workspaceInfrastructureReady) return
      await perform(async () => {
        const submissionOwner = controller.getSnapshot().selected_session_id ?? 'new'
        if (slashExecutionSessionIdsRef.current.has(submissionOwner)) {
          throw new Error('AGENT_RESOURCE_BINDING_UNAVAILABLE')
        }
        if (resourceRunBlocked
          || isAgentResourceRecoveryBlocking(selected ? recovery.coordinator.getSnapshot()[selected.id] : undefined)
          || isAgentResourceBindingConnectionBlocking(selected
            ? profileConnection.coordinator.getSnapshot()[selected.id]
            : undefined)) throw new Error('AGENT_RESOURCE_BINDING_UNAVAILABLE')
        let targetSession = selected
        if (!targetSession) {
          const selectionRevision = controller.getSnapshot().selection_intent_revision
          const pendingSession = draftSessionCoordinator.acquire(selectionRevision)
          if (pendingSession) {
            try {
              targetSession = await pendingSession
            } finally {
              draftSessionCoordinator.release(pendingSession)
            }
          } else {
            const modelId = newSessionModelId
            if (!modelId) throw new Error('AGENT_DEFAULT_MODEL_MISSING')
            const model = modelById.get(modelId)
            if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
              throw new Error('AGENT_MODEL_UNAVAILABLE')
            }
            targetSession = await controller.createSession({
              title: createSessionTitle(message, t('agent.sessions.untitled')),
              group_id: draftGroupId,
              model_id: modelId,
              reasoning_level: resolveAgentModelReasoningLevel(model, newSessionReasoningLevel),
            })
          }
          controller.updateDraft(targetSession.id, message)
          const current = controller.getSnapshot()
          if (current.selected_session_id === targetSession.id
            && current.selection_intent_revision === selectionRevision + 1) {
            controller.updateDraft('new', '')
            setDraftModelId(readiness.settings.default_model_id
              || firstRunnableModelId)
            setDraftReasoningLevel(undefined)
            setDraftGroupId(undefined)
          } else if (!current.selected_session_id && current.selection_intent_revision === selectionRevision) {
            controller.updateDraft('new', '')
            controller.selectSession(targetSession.id)
            setDraftModelId(readiness.settings.default_model_id
              || firstRunnableModelId)
            setDraftReasoningLevel(undefined)
            setDraftGroupId(undefined)
          }
        }
        const targetSessionId = targetSession.id
        await controller.startRun(targetSessionId, message, attachmentIds)
        draftAttachments.clearCommitted(targetSessionId, attachmentIds ?? [])
      }, resourceContexts.length ? 'resource' : 'generic')
    },
  }

  return actions
}

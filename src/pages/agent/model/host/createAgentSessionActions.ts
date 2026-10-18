import {
  isAgentModelRunnable
} from '#entities/agent'
import { resolveAgentModelReasoningLevel } from '../agentModelSelection.ts'
import {
  selectionAfterSessionRemoval
} from '../agentWorkspaceProjection.ts'
import type { AgentSurfaceModel } from '../surface/agentSurfaceModel.ts'
import { notifyError, requireSession, updateInput } from './agentHostHelpers.ts'

interface Context {
  workspaceInfrastructureReady: boolean
  controller: import('#features/agent-runtime').AgentWorkspaceController
  setDraftGroupId: React.Dispatch<React.SetStateAction<string | undefined>>
  readiness: import('#entities/agent').AgentReadiness
  firstRunnableModelId: string | undefined
  modelById: Map<string, import('#entities/agent').AgentModel>
  setDraftModelId: React.Dispatch<React.SetStateAction<string | undefined>>
  setDraftReasoningLevel: React.Dispatch<React.SetStateAction<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined>>
  activeRun: import('#entities/agent').AgentRun | undefined
  workspaceSessions: import('#widgets/agent-workspace').AgentWorkspaceSession[]
  management: ReturnType<typeof import('#features/agent-runtime').useAgentSessionManagement>
  draftAttachments: ReturnType<typeof import('#features/agent-runtime').useAgentDraftAttachments>
  notificationRef: React.RefObject<import('../surface/agentFeedback.ts').AgentFeedback['notification']>
  tRef: React.RefObject<import('i18next').TFunction<"translation", undefined>>
  remote: boolean
  perform: (operation: () => Promise<unknown>, errorContext?: "generic" | "resource", lane?: import('./agentHostHelpers.ts').AgentOperationLane) => Promise<boolean>
  selected: import('#entities/agent').AgentSession | undefined
  providerById: Map<string, import('#entities/agent').AgentModelProvider>
  newSessionReasoningLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  selectedModel: import('#entities/agent').AgentModel | undefined
}

export function createAgentSessionActions({ workspaceInfrastructureReady, controller, setDraftGroupId, readiness, firstRunnableModelId, modelById, setDraftModelId, setDraftReasoningLevel, activeRun, workspaceSessions, management, draftAttachments, notificationRef, tRef, remote, perform, selected, providerById, newSessionReasoningLevel, selectedModel }: Context) {
  const actions: Pick<NonNullable<AgentSurfaceModel['workspace']>, 'onCreateSession' | 'onSelectSession' | 'onReturnToActiveRun' | 'onArchiveSession' | 'onDeleteSession' | 'onModelChange' | 'onReasoningChange' | 'onResetResponseOptions'> = {
    onCreateSession: (groupId) => {
      if (!workspaceInfrastructureReady) return
      controller.selectSession(undefined)
      setDraftGroupId(groupId)
      const modelId = readiness.settings.default_model_id ?? firstRunnableModelId
      const model = modelId ? modelById.get(modelId) : undefined
      setDraftModelId(modelId)
      setDraftReasoningLevel(model?.effective_default_reasoning_level ?? 'off')
    },
    onSelectSession: (sessionId) => controller.selectSession(sessionId),
    onReturnToActiveRun: () => {
      if (activeRun) controller.selectSession(activeRun.session_id)
    },
    onArchiveSession: (sessionId) => void (async () => {
      const selection = controller.getSnapshot()
      const nextSessionId = selectionAfterSessionRemoval(workspaceSessions, sessionId)
      await management.metadata(sessionId, { archived: true })
      await draftAttachments.discard(sessionId)
      if (
        selection.selected_session_id === sessionId
        && controller.getSnapshot().selection_intent_revision === selection.selection_intent_revision
      ) {
        controller.selectSession(nextSessionId)
      }
    })().catch((error: unknown) => notifyError(notificationRef.current, tRef.current, error, 'generic', remote)),
    onDeleteSession: (sessionId) => void management.perform([sessionId], async () => {
      const session = requireSession(controller.getSnapshot().sessions, sessionId)
      await controller.deleteSession(sessionId, session.revision)
      draftAttachments.clear(sessionId)
    }).catch((error: unknown) => notifyError(notificationRef.current, tRef.current, error, 'generic', remote)),
    onModelChange: (modelId) => void perform(async () => {
      if (!selected) {
        const model = modelById.get(modelId)
        if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
          throw new Error('AGENT_MODEL_UNAVAILABLE')
        }
        setDraftReasoningLevel((current) => resolveAgentModelReasoningLevel(
          model,
          current ?? newSessionReasoningLevel,
        ))
        setDraftModelId(modelId)
        return
      }
      const model = modelById.get(modelId)
      if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
        throw new Error('AGENT_MODEL_UNAVAILABLE')
      }
      await controller.updateSession(selected.id, {
        ...updateInput(selected, false),
        model_id: modelId,
        reasoning_level: resolveAgentModelReasoningLevel(model, selected.reasoning_level),
      })
    }),
    onReasoningChange: (reasoningLevel) => void perform(async () => {
      const model = selectedModel
      if (!model || !model.supported_reasoning_levels.includes(reasoningLevel)) {
        throw new Error('AGENT_REASONING_LEVEL_UNSUPPORTED')
      }
      if (!selected) {
        setDraftReasoningLevel(reasoningLevel)
        return
      }
      await controller.updateSession(selected.id, {
        ...updateInput(selected, false),
        reasoning_level: reasoningLevel,
      })
    }),
    onResetResponseOptions: () => void perform(async () => {
      const modelId = readiness.settings.default_model_id ?? firstRunnableModelId
      const model = modelId ? modelById.get(modelId) : undefined
      if (!model || !isAgentModelRunnable(model, providerById.get(model.provider_id))) {
        throw new Error('AGENT_DEFAULT_MODEL_MISSING')
      }
      const reasoningLevel = resolveAgentModelReasoningLevel(
        model,
        model.effective_default_reasoning_level,
      )
      if (!selected) {
        setDraftModelId(model.id)
        setDraftReasoningLevel(reasoningLevel)
        return
      }
      await controller.updateSession(selected.id, {
        ...updateInput(selected, false),
        model_id: model.id,
        reasoning_level: reasoningLevel,
      })
    }),
  }

  return actions
}

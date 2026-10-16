import {
  isAgentModelRunnable,
  type AgentModel,
  type AgentModelProvider,
  type AgentReadiness,
  type AgentReasoningLevel
} from '#entities/agent'
import { loadAgentModelCatalog } from '#features/agent-setup'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { notifyError } from './agentHostHelpers.ts'

interface Context {
  setupGateway: Pick<import('#features/agent-setup').AgentSetupGateway, "readiness" | "modelProviders" | "models"> & Partial<Pick<import('#features/agent-setup').AgentSetupGateway, "setup">>
  controller: import('#features/agent-runtime').AgentWorkspaceController
  remote: boolean
  notificationRef: React.RefObject<import('../surface/agentFeedback.ts').AgentFeedback['notification']>
  tRef: React.RefObject<import('i18next').TFunction<"translation", undefined>>
  enabled: boolean
  active: boolean
}

export function useAgentSetupState({ setupGateway, controller, remote, notificationRef, tRef, enabled, active }: Context) {
  const [readiness, setReadiness] = useState<AgentReadiness | null>(null)

  const [providers, setProviders] = useState<AgentModelProvider[]>([])

  const [models, setModels] = useState<AgentModel[]>([])

  const [setupLoading, setSetupLoading] = useState(true)

  const [draftModelId, setDraftModelId] = useState<string>()

  const [draftReasoningLevel, setDraftReasoningLevel] = useState<AgentReasoningLevel>()

  const [activeSetupReadyEpoch, setActiveSetupReadyEpoch] = useState(0)

  const [activeSetupFailedEpoch, setActiveSetupFailedEpoch] = useState(0)

  const setupLoadRequestRef = useRef(0)

  const activeSetupEpochRef = useRef(0)

  const activeSetupReadyEpochRef = useRef(0)

  const activeSetupAbortRef = useRef<AbortController | null>(null)

  const acceptSetupSnapshot = useCallback((
    nextReadiness: AgentReadiness,
    nextProviders: AgentModelProvider[],
    nextModels: AgentModel[],
  ) => {
    const nextProvidersById = new Map(nextProviders.map((provider) => [provider.id, provider]))
    setReadiness(nextReadiness)
    setProviders(nextProviders)
    setModels(nextModels)
    setDraftModelId((current) => (
      current && nextModels.some((model) => model.id === current)
        ? current
        : nextReadiness.settings.default_model_id
        || nextModels.find((model) => (
          isAgentModelRunnable(model, nextProvidersById.get(model.provider_id))
        ))?.id
    ))
  }, [])

  const loadSetup = useCallback(async (
    signal?: AbortSignal,
    shouldAccept: () => boolean = () => true,
  ) => {
    const request = setupLoadRequestRef.current + 1
    setupLoadRequestRef.current = request
    setSetupLoading(true)
    try {
      const [nextReadiness, catalog] = await Promise.all([
        setupGateway.readiness(signal),
        loadAgentModelCatalog(setupGateway, signal),
      ])
      signal?.throwIfAborted()
      if (!shouldAccept()) return false
      acceptSetupSnapshot(nextReadiness, catalog.providers, catalog.models)
      const selectedSessionId = controller.getSnapshot().selected_session_id
      if (selectedSessionId) {
        try {
          await Promise.all([
            controller.reloadContext(selectedSessionId),
            controller.reloadUsage(selectedSessionId),
          ])
        } catch {
          if (!signal?.aborted && !remote) notifyError(notificationRef.current, tRef.current)
        }
      }
      signal?.throwIfAborted()
      return shouldAccept()
    } catch {
      if (!signal?.aborted && !remote) notifyError(notificationRef.current, tRef.current)
      return false
    } finally {
      if (setupLoadRequestRef.current === request) setSetupLoading(false)
    }
  }, [acceptSetupSnapshot, controller, setupGateway, remote, notificationRef, tRef])

  const markActiveSetupReady = useCallback((epoch: number) => {
    if (epoch <= 0 || activeSetupEpochRef.current !== epoch) return
    activeSetupReadyEpochRef.current = epoch
    setActiveSetupReadyEpoch(epoch)
    setActiveSetupFailedEpoch(0)
  }, [])

  const hydrateActiveSetup = useCallback((epoch: number) => {
    activeSetupAbortRef.current?.abort()
    const controller = new AbortController()
    activeSetupAbortRef.current = controller
    activeSetupReadyEpochRef.current = 0
    setActiveSetupReadyEpoch(0)
    setActiveSetupFailedEpoch(0)
    return loadSetup(
      controller.signal,
      () => activeSetupEpochRef.current === epoch,
    ).then((accepted) => {
      if (controller.signal.aborted || activeSetupEpochRef.current !== epoch) return false
      if (accepted) markActiveSetupReady(epoch)
      else setActiveSetupFailedEpoch(epoch)
      return accepted
    })
  }, [loadSetup, markActiveSetupReady])

  useLayoutEffect(() => {
    if (!enabled || !active) return
    const epoch = activeSetupEpochRef.current + 1
    activeSetupEpochRef.current = epoch
    void hydrateActiveSetup(epoch)
    return () => {
      if (activeSetupEpochRef.current !== epoch) return
      activeSetupAbortRef.current?.abort()
      activeSetupAbortRef.current = null
      activeSetupReadyEpochRef.current = 0
    }
  }, [active, enabled, hydrateActiveSetup])

  const activeSetupReady = active
    && activeSetupEpochRef.current > 0
    && activeSetupReadyEpoch === activeSetupEpochRef.current
    && activeSetupReadyEpochRef.current === activeSetupEpochRef.current

  const activeSetupFailed = active
    && activeSetupFailedEpoch > 0
    && activeSetupFailedEpoch === activeSetupEpochRef.current

  return { readiness, setReadiness, providers, models, setupLoading, draftModelId, setDraftModelId, draftReasoningLevel, setDraftReasoningLevel, activeSetupEpochRef, activeSetupReadyEpochRef, activeSetupAbortRef, acceptSetupSnapshot, markActiveSetupReady, hydrateActiveSetup, activeSetupReady, activeSetupFailed }
}

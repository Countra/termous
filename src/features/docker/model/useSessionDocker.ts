import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DockerAction,
  DockerActionResult,
  DockerCapability,
  DockerContainerDetail,
  DockerContainerQuery,
  DockerContainerStats,
  DockerListResult,
  DockerLogsResult,
} from '#entities/docker'
import type { DockerGateway, DockerSessionContext } from './contracts'

export interface SessionDockerQueryState {
  text: string
  state: string
  health: string
  port: string
  limit: number
  logTail: number
}

export interface SessionDockerState {
  query: SessionDockerQueryState
  capability: DockerCapability | null
  list: DockerListResult | null
  detail: DockerContainerDetail | null
  stats: DockerContainerStats | null
  logs: DockerLogsResult | null
  selectedRef: string
  loadingCapability: boolean
  loadingList: boolean
  detailLoading: boolean
  statsLoading: boolean
  logsLoading: boolean
  actionRef: string
  error: string
  detailError: string
  statsError: string
  logsError: string
  lastUpdatedAt: string
  refreshRequired: boolean
}

interface UseSessionDockerOptions {
  api: DockerGateway
  session: DockerSessionContext | null
  enabled: boolean
}

export const defaultDockerQuery: SessionDockerQueryState = {
  text: '',
  state: '',
  health: '',
  port: '',
  limit: 100,
  logTail: 200,
}

const maxDockerLogTail = 1000

const emptyDockerState: SessionDockerState = {
  query: defaultDockerQuery,
  capability: null,
  list: null,
  detail: null,
  stats: null,
  logs: null,
  selectedRef: '',
  loadingCapability: false,
  loadingList: false,
  detailLoading: false,
  statsLoading: false,
  logsLoading: false,
  actionRef: '',
  error: '',
  detailError: '',
  statsError: '',
  logsError: '',
  lastUpdatedAt: '',
  refreshRequired: false,
}

function createDockerState(): SessionDockerState {
  return {
    ...emptyDockerState,
    query: { ...defaultDockerQuery },
  }
}

function normalizeDockerLogTail(tail: number) {
  if (!Number.isFinite(tail) || tail <= 0) {
    return defaultDockerQuery.logTail
  }
  return Math.min(Math.trunc(tail), maxDockerLogTail)
}

export function useSessionDocker({ api, session, enabled }: UseSessionDockerOptions) {
  const statesRef = useRef<Record<string, SessionDockerState>>({})
  const capabilityAbortRef = useRef<AbortController | null>(null)
  const listAbortRef = useRef<AbortController | null>(null)
  const detailAbortRef = useRef<AbortController | null>(null)
  const statsAbortRef = useRef<AbortController | null>(null)
  const logsAbortRef = useRef<AbortController | null>(null)
  const capabilityRevisionRef = useRef<Record<string, number>>({})
  const listRevisionRef = useRef<Record<string, number>>({})
  const detailRevisionRef = useRef<Record<string, number>>({})
  const statsRevisionRef = useRef<Record<string, number>>({})
  const logsRevisionRef = useRef<Record<string, number>>({})
  const actionRefreshRef = useRef<Set<string>>(new Set())
  const actionRevisionRef = useRef<Record<string, number>>({})
  const [states, setStates] = useState<Record<string, SessionDockerState>>({})
  const sessionId = session?.id ?? ''
  const supported = Boolean(sessionId && session?.kind === 'ssh' && session.status === 'connected')
  const readScopeRef = useRef({ enabled, sessionId, supported })
  readScopeRef.current = { enabled, sessionId, supported }
  const currentState = supported ? states[sessionId] ?? emptyDockerState : emptyDockerState

  const updateSessionState = useCallback((id: string, updater: (current: SessionDockerState) => SessionDockerState) => {
    if (!id) {
      return
    }
    setStates((current) => {
      const previous = current[id] ?? createDockerState()
      const next = updater(previous)
      if (next === previous) {
        return current
      }
      const nextStates = { ...current, [id]: next }
      statesRef.current = nextStates
      return nextStates
    })
  }, [])

  useEffect(() => {
    statesRef.current = states
  }, [states])

  const abortReadRequests = useCallback(() => {
    capabilityAbortRef.current?.abort()
    listAbortRef.current?.abort()
    detailAbortRef.current?.abort()
    statsAbortRef.current?.abort()
    logsAbortRef.current?.abort()
  }, [])

  useEffect(() => () => abortReadRequests(), [abortReadRequests, enabled, sessionId, supported])

  const updateQuery = useCallback(
    (patch: Partial<SessionDockerQueryState>) => {
      updateSessionState(sessionId, (current) => {
        const nextQuery = { ...current.query, ...patch }
        return {
          ...current,
          query: {
            ...nextQuery,
            logTail: normalizeDockerLogTail(nextQuery.logTail),
          },
        }
      })
    },
    [sessionId, updateSessionState],
  )

  const resetQuery = useCallback(() => {
    updateSessionState(sessionId, (current) => ({
      ...current,
      query: { ...defaultDockerQuery },
    }))
  }, [sessionId, updateSessionState])

  const refreshCapability = useCallback(async (): Promise<DockerCapability | null> => {
    if (!supported || !enabled || !sessionId) {
      return null
    }
    const revision = (capabilityRevisionRef.current[sessionId] ?? 0) + 1
    capabilityRevisionRef.current[sessionId] = revision
    capabilityAbortRef.current?.abort()
    const controller = new AbortController()
    capabilityAbortRef.current = controller
    updateSessionState(sessionId, (current) => ({ ...current, loadingCapability: true, error: '' }))
    try {
      const capability = await api.sessionDockerCapability(sessionId, { signal: controller.signal })
      if (capabilityRevisionRef.current[sessionId] !== revision) {
        return null
      }
      updateSessionState(sessionId, (current) => ({
        ...current,
        capability,
        loadingCapability: false,
        error: capability.available ? '' : capability.message ?? '',
      }))
      return capability
    } catch (error) {
      if (capabilityRevisionRef.current[sessionId] !== revision) {
        return null
      }
      if (isRequestAborted(error)) {
        updateSessionState(sessionId, (current) => ({ ...current, loadingCapability: false }))
        return null
      }
      const message = error instanceof Error ? error.message : ''
      updateSessionState(sessionId, (current) => ({ ...current, loadingCapability: false, error: message }))
      return null
    } finally {
      if (capabilityAbortRef.current === controller) {
        capabilityAbortRef.current = null
      }
    }
  }, [api, enabled, sessionId, supported, updateSessionState])

  const refreshList = useCallback(async (queryOverride?: SessionDockerQueryState) => {
    if (!supported || !enabled || !sessionId) {
      return
    }
    const revision = (listRevisionRef.current[sessionId] ?? 0) + 1
    listRevisionRef.current[sessionId] = revision
    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller
    const query = buildDockerQuery(queryOverride ?? statesRef.current[sessionId]?.query ?? defaultDockerQuery)
    updateSessionState(sessionId, (current) => ({ ...current, loadingList: true, error: '' }))
    try {
      const list = await api.sessionDockerContainers(sessionId, query, { signal: controller.signal })
      if (listRevisionRef.current[sessionId] !== revision) {
        return
      }
      updateSessionState(sessionId, (current) => ({
        ...current,
        list,
        loadingList: false,
        error: '',
        lastUpdatedAt: list.collected_at,
      }))
    } catch (error) {
      if (listRevisionRef.current[sessionId] !== revision) {
        return
      }
      if (isRequestAborted(error)) {
        updateSessionState(sessionId, (current) => ({ ...current, loadingList: false }))
        return
      }
      const message = error instanceof Error ? error.message : ''
      updateSessionState(sessionId, (current) => ({ ...current, loadingList: false, error: message }))
    } finally {
      if (listAbortRef.current === controller) {
        listAbortRef.current = null
      }
    }
  }, [api, enabled, sessionId, supported, updateSessionState])

  const selectContainer = useCallback(
    async (ref: string) => {
      if (!supported || !enabled || !sessionId || !ref) {
        return
      }
      const revision = (detailRevisionRef.current[sessionId] ?? 0) + 1
      detailRevisionRef.current[sessionId] = revision
      detailAbortRef.current?.abort()
      const controller = new AbortController()
      detailAbortRef.current = controller
      updateSessionState(sessionId, (current) => {
        const keepCurrentDetail = current.selectedRef === ref && Boolean(current.detail)
        return {
          ...current,
          selectedRef: ref,
          detail: keepCurrentDetail ? current.detail : null,
          stats: keepCurrentDetail ? current.stats : null,
          logs: keepCurrentDetail ? current.logs : null,
          detailLoading: true,
          detailError: '',
        }
      })
      try {
        const detail = await api.sessionDockerContainerDetail(sessionId, ref, { signal: controller.signal })
        if (detailRevisionRef.current[sessionId] !== revision) {
          return
        }
        updateSessionState(sessionId, (current) => ({
          ...current,
          detail,
          stats: detail.stats ?? null,
          logs: current.logs ?? (detail.logs_preview
            ? {
                lines: detail.logs_preview,
                tail: normalizeDockerLogTail(current.query.logTail),
                timestamps: true,
                collected_at: detail.collected_at,
              }
            : null),
          detailLoading: false,
          detailError: '',
        }))
      } catch (error) {
        if (detailRevisionRef.current[sessionId] !== revision) {
          return
        }
        if (isRequestAborted(error)) {
          updateSessionState(sessionId, (current) => ({ ...current, detailLoading: false }))
          return
        }
        const message = error instanceof Error ? error.message : ''
        updateSessionState(sessionId, (current) => ({ ...current, detailLoading: false, detailError: message }))
      } finally {
        if (detailAbortRef.current === controller) {
          detailAbortRef.current = null
        }
      }
    },
    [api, enabled, sessionId, supported, updateSessionState],
  )

  const refreshAll = useCallback(async () => {
    const capability = await refreshCapability()
    const scope = readScopeRef.current
    if (!capability?.available || !scope.enabled || !scope.supported || scope.sessionId !== sessionId) {
      return
    }
    await refreshList()
    const nextScope = readScopeRef.current
    if (!nextScope.enabled || !nextScope.supported || nextScope.sessionId !== sessionId) {
      return
    }
    const selectedRef = statesRef.current[sessionId]?.selectedRef
    if (selectedRef) {
      await selectContainer(selectedRef)
    }
  }, [refreshCapability, refreshList, selectContainer, sessionId])

  const refreshChangedContainer = useCallback(async () => {
    const scope = readScopeRef.current
    if (!scope.enabled || !scope.supported || scope.sessionId !== sessionId || actionRefreshRef.current.has(sessionId)) {
      return
    }
    actionRefreshRef.current.add(sessionId)
    try {
      let refreshAgain: boolean
      do {
        const actionRevision = actionRevisionRef.current[sessionId] ?? 0
        await refreshList()
        const nextScope = readScopeRef.current
        if (!nextScope.enabled || !nextScope.supported || nextScope.sessionId !== sessionId) {
          return
        }
        const selectedRef = statesRef.current[sessionId]?.selectedRef
        if (selectedRef) {
          await selectContainer(selectedRef)
        }
        const finalScope = readScopeRef.current
        if (!finalScope.enabled || !finalScope.supported || finalScope.sessionId !== sessionId) {
          return
        }
        refreshAgain = (actionRevisionRef.current[sessionId] ?? 0) !== actionRevision
        if (!refreshAgain) {
          updateSessionState(sessionId, (current) => (
            current.refreshRequired ? { ...current, refreshRequired: false } : current
          ))
        }
      } while (refreshAgain)
    } finally {
      actionRefreshRef.current.delete(sessionId)
    }
  }, [refreshList, selectContainer, sessionId, updateSessionState])

  const clearSelection = useCallback(() => {
    updateSessionState(sessionId, (current) => ({
      ...current,
      selectedRef: '',
      detail: null,
      stats: null,
      logs: null,
      detailError: '',
      statsError: '',
      logsError: '',
    }))
  }, [sessionId, updateSessionState])

  const refreshStats = useCallback(
    async (refOverride?: string) => {
      const ref = refOverride || statesRef.current[sessionId]?.selectedRef
      if (!supported || !enabled || !sessionId || !ref) {
        return
      }
      const revision = (statsRevisionRef.current[sessionId] ?? 0) + 1
      statsRevisionRef.current[sessionId] = revision
      statsAbortRef.current?.abort()
      const controller = new AbortController()
      statsAbortRef.current = controller
      updateSessionState(sessionId, (current) => ({ ...current, statsLoading: true, statsError: '' }))
      try {
        const stats = await api.sessionDockerContainerStats(sessionId, ref, { signal: controller.signal })
        if (statsRevisionRef.current[sessionId] !== revision) {
          return
        }
        updateSessionState(sessionId, (current) => ({ ...current, stats, statsLoading: false, statsError: '' }))
      } catch (error) {
        if (statsRevisionRef.current[sessionId] !== revision) {
          return
        }
        if (isRequestAborted(error)) {
          updateSessionState(sessionId, (current) => ({ ...current, statsLoading: false }))
          return
        }
        const message = error instanceof Error ? error.message : ''
        updateSessionState(sessionId, (current) => ({ ...current, statsLoading: false, statsError: message }))
      } finally {
        if (statsAbortRef.current === controller) {
          statsAbortRef.current = null
        }
      }
    },
    [api, enabled, sessionId, supported, updateSessionState],
  )

  const refreshLogs = useCallback(
    async (refOverride?: string, tailOverride?: number) => {
      const state = statesRef.current[sessionId]
      const ref = refOverride || state?.selectedRef
      const tail = normalizeDockerLogTail(tailOverride ?? state?.query.logTail ?? defaultDockerQuery.logTail)
      if (!supported || !enabled || !sessionId || !ref) {
        return
      }
      const revision = (logsRevisionRef.current[sessionId] ?? 0) + 1
      logsRevisionRef.current[sessionId] = revision
      logsAbortRef.current?.abort()
      const controller = new AbortController()
      logsAbortRef.current = controller
      updateSessionState(sessionId, (current) => ({ ...current, logsLoading: true, logsError: '' }))
      try {
        const logs = await api.sessionDockerContainerLogs(sessionId, ref, tail, true, { signal: controller.signal })
        if (logsRevisionRef.current[sessionId] !== revision) {
          return
        }
        updateSessionState(sessionId, (current) => ({ ...current, logs, logsLoading: false, logsError: '' }))
      } catch (error) {
        if (logsRevisionRef.current[sessionId] !== revision) {
          return
        }
        if (isRequestAborted(error)) {
          updateSessionState(sessionId, (current) => ({ ...current, logsLoading: false }))
          return
        }
        const message = error instanceof Error ? error.message : ''
        updateSessionState(sessionId, (current) => ({ ...current, logsLoading: false, logsError: message }))
      } finally {
        if (logsAbortRef.current === controller) {
          logsAbortRef.current = null
        }
      }
    },
    [api, enabled, sessionId, supported, updateSessionState],
  )

  const runAction = useCallback(
    async (ref: string, action: DockerAction, timeoutSeconds?: number): Promise<DockerActionResult | null> => {
      if (!supported || !enabled || !sessionId || !ref) {
        return null
      }
      updateSessionState(sessionId, (current) => ({ ...current, actionRef: ref }))
      try {
        const result = await api.sessionDockerContainerAction(sessionId, ref, {
          action,
          timeout_seconds: timeoutSeconds,
        })
        actionRevisionRef.current[sessionId] = (actionRevisionRef.current[sessionId] ?? 0) + 1
        updateSessionState(sessionId, (current) => ({ ...current, refreshRequired: true }))
        const scope = readScopeRef.current
        if (scope.enabled && scope.supported && scope.sessionId === sessionId) {
          await refreshChangedContainer()
        }
        return result
      } finally {
        updateSessionState(sessionId, (current) => ({ ...current, actionRef: '' }))
      }
    },
    [api, enabled, refreshChangedContainer, sessionId, supported, updateSessionState],
  )

  useEffect(() => {
    if (!enabled || !supported || currentState.loadingCapability || currentState.loadingList) {
      return
    }
    if (!currentState.capability) {
      void refreshAll()
      return
    }
    if (currentState.refreshRequired) {
      void refreshChangedContainer()
      return
    }
    if (currentState.capability.available && !currentState.list && !currentState.error) {
      void refreshList()
      return
    }
    if (currentState.capability.available && currentState.selectedRef && !currentState.detail && !currentState.detailLoading && !currentState.detailError) {
      void selectContainer(currentState.selectedRef)
    }
  }, [currentState.capability, currentState.detail, currentState.detailError, currentState.detailLoading, currentState.error, currentState.list, currentState.loadingCapability, currentState.loadingList, currentState.refreshRequired, currentState.selectedRef, enabled, refreshAll, refreshChangedContainer, refreshList, selectContainer, supported])

  return {
    ...currentState,
    supported,
    refreshAll,
    refreshCapability,
    refreshList,
    refreshStats,
    refreshLogs,
    updateQuery,
    resetQuery,
    selectContainer,
    clearSelection,
    runAction,
  }
}

function buildDockerQuery(query: SessionDockerQueryState): DockerContainerQuery {
  return {
    query: query.text,
    state: query.state,
    health: query.health,
    port: parsePositiveInt(query.port),
    limit: query.limit,
  }
}

function parsePositiveInt(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return undefined
  }
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function isRequestAborted(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  return (error as { code?: string }).code === 'REQUEST_ABORTED'
}

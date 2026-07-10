import { useCallback, useEffect, useRef, useState } from 'react'
import type { TermousApi } from '../../api/client'
import type {
  Session,
  SystemServiceAction,
  SystemServiceCapability,
  SystemServiceDetail,
  SystemServiceListResult,
  SystemServiceLogQuery,
  SystemServiceLogsResult,
  SystemServiceOperation,
  SystemServiceOperationPhase,
  SystemServiceQuery,
  SystemServiceRuntimeFilter,
  SystemServiceSort,
} from '../../types/domain'

export interface SessionServiceQueryState {
  text: string
  runtimeState: SystemServiceRuntimeFilter
  unitFileState: string
  sort: SystemServiceSort
  order: 'asc' | 'desc'
  limit: number
}

export interface SessionServiceLogQueryState {
  limit: number
  priority: string
  boot: 'current' | 'all'
}

export interface SessionServiceState {
  query: SessionServiceQueryState
  logQuery: SessionServiceLogQueryState
  capability: SystemServiceCapability | null
  list: SystemServiceListResult | null
  detail: SystemServiceDetail | null
  logs: SystemServiceLogsResult | null
  selectedUnitId: string
  logsUnitId: string
  operations: Record<string, SystemServiceOperation>
  operationErrors: Record<string, string>
  submittingUnits: Record<string, boolean>
  loadingCapability: boolean
  loadingList: boolean
  detailLoading: boolean
  logsLoading: boolean
  error: string
  detailError: string
  logsError: string
  lastUpdatedAt: string
}

interface UseSessionServicesOptions {
  api: TermousApi
  session: Session | null
  enabled: boolean
}

export const defaultServiceQuery: SessionServiceQueryState = {
  text: '',
  runtimeState: '',
  unitFileState: '',
  sort: 'name',
  order: 'asc',
  limit: 200,
}

export const defaultServiceLogQuery: SessionServiceLogQueryState = {
  limit: 200,
  priority: '',
  boot: 'current',
}

const emptyServiceState: SessionServiceState = {
  query: defaultServiceQuery,
  logQuery: defaultServiceLogQuery,
  capability: null,
  list: null,
  detail: null,
  logs: null,
  selectedUnitId: '',
  logsUnitId: '',
  operations: {},
  operationErrors: {},
  submittingUnits: {},
  loadingCapability: false,
  loadingList: false,
  detailLoading: false,
  logsLoading: false,
  error: '',
  detailError: '',
  logsError: '',
  lastUpdatedAt: '',
}

function createServiceState(): SessionServiceState {
  return {
    ...emptyServiceState,
    query: { ...defaultServiceQuery },
    logQuery: { ...defaultServiceLogQuery },
    operations: {},
    operationErrors: {},
    submittingUnits: {},
  }
}

export function useSessionServices({ api, session, enabled }: UseSessionServicesOptions) {
  const statesRef = useRef<Record<string, SessionServiceState>>({})
  const capabilityAbortRef = useRef<AbortController | null>(null)
  const listAbortRef = useRef<AbortController | null>(null)
  const detailAbortRef = useRef<AbortController | null>(null)
  const logsAbortRef = useRef<AbortController | null>(null)
  const operationAbortRef = useRef<AbortController | null>(null)
  const capabilityRevisionRef = useRef<Record<string, number>>({})
  const listRevisionRef = useRef<Record<string, number>>({})
  const detailRevisionRef = useRef<Record<string, number>>({})
  const logsRevisionRef = useRef<Record<string, number>>({})
  const [states, setStates] = useState<Record<string, SessionServiceState>>({})
  const sessionId = session?.id ?? ''
  const supported = Boolean(sessionId && session?.kind === 'ssh' && session.status === 'connected')
  const currentState = supported ? states[sessionId] ?? emptyServiceState : emptyServiceState
  const pendingOperationKey = Object.values(currentState.operations)
    .filter((operation) => !isTerminalOperation(operation.phase))
    .map((operation) => operation.id)
    .sort()
    .join('|')

  const updateSessionState = useCallback((id: string, updater: (current: SessionServiceState) => SessionServiceState) => {
    if (!id) {
      return
    }
    setStates((current) => {
      const previous = current[id] ?? createServiceState()
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
    logsAbortRef.current?.abort()
  }, [])

  useEffect(() => () => abortReadRequests(), [abortReadRequests, enabled, sessionId])

  useEffect(
    () => () => {
      abortReadRequests()
      operationAbortRef.current?.abort()
    },
    [abortReadRequests],
  )

  const updateQuery = useCallback(
    (patch: Partial<SessionServiceQueryState>) => {
      updateSessionState(sessionId, (current) => ({ ...current, query: { ...current.query, ...patch } }))
    },
    [sessionId, updateSessionState],
  )

  const resetQuery = useCallback(() => {
    updateSessionState(sessionId, (current) => ({ ...current, query: { ...defaultServiceQuery } }))
  }, [sessionId, updateSessionState])

  const updateLogQuery = useCallback(
    (patch: Partial<SessionServiceLogQueryState>) => {
      updateSessionState(sessionId, (current) => ({ ...current, logQuery: { ...current.logQuery, ...patch } }))
    },
    [sessionId, updateSessionState],
  )

  const refreshCapability = useCallback(async (): Promise<SystemServiceCapability | null> => {
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
      const capability = await api.sessionServiceCapability(sessionId, { signal: controller.signal })
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
      const message = errorMessage(error)
      updateSessionState(sessionId, (current) => ({ ...current, loadingCapability: false, error: message }))
      return null
    } finally {
      if (capabilityAbortRef.current === controller) {
        capabilityAbortRef.current = null
      }
    }
  }, [api, enabled, sessionId, supported, updateSessionState])

  const refreshList = useCallback(async (queryOverride?: SessionServiceQueryState) => {
    if (!supported || !enabled || !sessionId) {
      return
    }
    const revision = (listRevisionRef.current[sessionId] ?? 0) + 1
    listRevisionRef.current[sessionId] = revision
    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller
    const query = buildServiceQuery(queryOverride ?? statesRef.current[sessionId]?.query ?? defaultServiceQuery)
    updateSessionState(sessionId, (current) => ({ ...current, loadingList: true, error: '' }))
    try {
      const list = await api.sessionServices(sessionId, query, { signal: controller.signal })
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
      updateSessionState(sessionId, (current) => ({ ...current, loadingList: false, error: errorMessage(error) }))
    } finally {
      if (listAbortRef.current === controller) {
        listAbortRef.current = null
      }
    }
  }, [api, enabled, sessionId, supported, updateSessionState])

  const selectService = useCallback(async (unitId: string) => {
    if (!supported || !enabled || !sessionId || !unitId) {
      return
    }
    const revision = (detailRevisionRef.current[sessionId] ?? 0) + 1
    detailRevisionRef.current[sessionId] = revision
    detailAbortRef.current?.abort()
    const controller = new AbortController()
    detailAbortRef.current = controller
    updateSessionState(sessionId, (current) => ({
      ...current,
      selectedUnitId: unitId,
      detail: current.selectedUnitId === unitId ? current.detail : null,
      detailLoading: true,
      detailError: '',
    }))
    try {
      const detail = await api.sessionServiceDetail(sessionId, unitId, { signal: controller.signal })
      if (detailRevisionRef.current[sessionId] !== revision) {
        return
      }
      updateSessionState(sessionId, (current) => ({ ...current, detail, detailLoading: false, detailError: '' }))
    } catch (error) {
      if (detailRevisionRef.current[sessionId] !== revision) {
        return
      }
      if (isRequestAborted(error)) {
        updateSessionState(sessionId, (current) => ({ ...current, detailLoading: false }))
        return
      }
      updateSessionState(sessionId, (current) => ({ ...current, detailLoading: false, detailError: errorMessage(error) }))
    } finally {
      if (detailAbortRef.current === controller) {
        detailAbortRef.current = null
      }
    }
  }, [api, enabled, sessionId, supported, updateSessionState])

  const clearSelection = useCallback(() => {
    detailAbortRef.current?.abort()
    updateSessionState(sessionId, (current) => ({
      ...current,
      selectedUnitId: '',
      detail: null,
      detailError: '',
    }))
  }, [sessionId, updateSessionState])

  const refreshLogs = useCallback(async (
    unitIdOverride?: string,
    queryOverride?: SessionServiceLogQueryState,
    append = false,
  ) => {
    const state = statesRef.current[sessionId]
    const unitId = unitIdOverride || state?.logsUnitId || state?.selectedUnitId
    if (!supported || !enabled || !sessionId || !unitId) {
      return
    }
    const revision = (logsRevisionRef.current[sessionId] ?? 0) + 1
    logsRevisionRef.current[sessionId] = revision
    logsAbortRef.current?.abort()
    const controller = new AbortController()
    logsAbortRef.current = controller
    const queryState = queryOverride ?? state?.logQuery ?? defaultServiceLogQuery
    const query: SystemServiceLogQuery = {
      limit: queryState.limit,
      priority: queryState.priority,
      boot: queryState.boot,
      after_cursor: append && state?.logsUnitId === unitId ? state.logs?.cursor : undefined,
    }
    updateSessionState(sessionId, (current) => ({
      ...current,
      logsUnitId: unitId,
      logs: current.logsUnitId === unitId ? current.logs : null,
      logsLoading: true,
      logsError: '',
    }))
    try {
      const logs = await api.sessionServiceLogs(sessionId, unitId, query, { signal: controller.signal })
      if (logsRevisionRef.current[sessionId] !== revision) {
        return
      }
      updateSessionState(sessionId, (current) => ({
        ...current,
        logs: append && current.logsUnitId === unitId ? mergeServiceLogs(current.logs, logs) : logs,
        logsLoading: false,
        logsError: '',
      }))
    } catch (error) {
      if (logsRevisionRef.current[sessionId] !== revision) {
        return
      }
      if (isRequestAborted(error)) {
        updateSessionState(sessionId, (current) => ({ ...current, logsLoading: false }))
        return
      }
      updateSessionState(sessionId, (current) => ({ ...current, logsLoading: false, logsError: errorMessage(error) }))
    } finally {
      if (logsAbortRef.current === controller) {
        logsAbortRef.current = null
      }
    }
  }, [api, enabled, sessionId, supported, updateSessionState])

  const clearLogs = useCallback(() => {
    logsAbortRef.current?.abort()
    updateSessionState(sessionId, (current) => ({
      ...current,
      logs: null,
      logsUnitId: '',
      logsLoading: false,
      logsError: '',
    }))
  }, [sessionId, updateSessionState])

  const storeOperation = useCallback((id: string, incoming: SystemServiceOperation) => {
    updateSessionState(id, (current) => {
      const previous = current.operations[incoming.unit_id]
      if (previous?.id === incoming.id) {
        if (incoming.revision < previous.revision || isTerminalOperation(previous.phase) && !isTerminalOperation(incoming.phase)) {
          return current
        }
      }
      const operationErrors = { ...current.operationErrors }
      if (incoming.phase === 'succeeded') {
        delete operationErrors[incoming.unit_id]
      } else if (isTerminalOperation(incoming.phase) && incoming.message) {
        operationErrors[incoming.unit_id] = incoming.message
      }
      return {
        ...current,
        operations: { ...current.operations, [incoming.unit_id]: incoming },
        operationErrors,
      }
    })
  }, [updateSessionState])

  const runAction = useCallback(async (unitId: string, action: SystemServiceAction) => {
    if (!supported || !enabled || !sessionId || !unitId) {
      return null
    }
    updateSessionState(sessionId, (current) => ({
      ...current,
      submittingUnits: { ...current.submittingUnits, [unitId]: true },
      operationErrors: { ...current.operationErrors, [unitId]: '' },
    }))
    try {
      const operation = await api.runSessionServiceAction(sessionId, unitId, action)
      storeOperation(sessionId, operation)
      return operation
    } catch (error) {
      updateSessionState(sessionId, (current) => ({
        ...current,
        operationErrors: { ...current.operationErrors, [unitId]: errorMessage(error) },
      }))
      throw error
    } finally {
      updateSessionState(sessionId, (current) => ({
        ...current,
        submittingUnits: { ...current.submittingUnits, [unitId]: false },
      }))
    }
  }, [api, enabled, sessionId, storeOperation, supported, updateSessionState])

  const refreshAll = useCallback(async () => {
    const capability = await refreshCapability()
    if (capability?.available) {
      await refreshList()
    }
  }, [refreshCapability, refreshList])

  useEffect(() => {
    if (!enabled || !supported || currentState.capability || currentState.loadingCapability || currentState.loadingList) {
      return
    }
    void refreshAll()
  }, [currentState.capability, currentState.loadingCapability, currentState.loadingList, enabled, refreshAll, supported])

  useEffect(() => {
    if (!enabled || !supported || !sessionId || !pendingOperationKey) {
      return undefined
    }
    operationAbortRef.current?.abort()
    const controller = new AbortController()
    operationAbortRef.current = controller
    let polling = false

    const poll = async () => {
      if (polling || controller.signal.aborted) {
        return
      }
      polling = true
      let reachedTerminal = false
      const pendingIds = pendingOperationKey.split('|').filter(Boolean)
      try {
        for (const operationId of pendingIds) {
          const current = statesRef.current[sessionId]
          const operation = Object.values(current?.operations ?? {}).find((item) => item.id === operationId)
          if (!operation || isTerminalOperation(operation.phase)) {
            continue
          }
          try {
            const next = await api.sessionServiceOperation(sessionId, operationId, { signal: controller.signal })
            storeOperation(sessionId, next)
            reachedTerminal = reachedTerminal || isTerminalOperation(next.phase)
          } catch (error) {
            if (isRequestAborted(error)) {
              return
            }
            updateSessionState(sessionId, (state) => ({
              ...state,
              operationErrors: { ...state.operationErrors, [operation.unit_id]: errorMessage(error) },
            }))
          }
        }
        if (reachedTerminal && !controller.signal.aborted) {
          await refreshList()
          const selectedUnitId = statesRef.current[sessionId]?.selectedUnitId
          if (selectedUnitId) {
            await selectService(selectedUnitId)
          }
        }
      } finally {
        polling = false
      }
    }

    void poll()
    const timer = window.setInterval(() => void poll(), 1_200)
    return () => {
      window.clearInterval(timer)
      controller.abort()
      if (operationAbortRef.current === controller) {
        operationAbortRef.current = null
      }
    }
  }, [api, enabled, pendingOperationKey, refreshList, selectService, sessionId, storeOperation, supported, updateSessionState])

  return {
    ...currentState,
    supported,
    refreshAll,
    refreshCapability,
    refreshList,
    updateQuery,
    resetQuery,
    selectService,
    clearSelection,
    refreshLogs,
    clearLogs,
    updateLogQuery,
    runAction,
  }
}

function buildServiceQuery(query: SessionServiceQueryState): SystemServiceQuery {
  return {
    query: query.text,
    runtime_state: query.runtimeState,
    unit_file_state: query.unitFileState,
    sort: query.sort,
    order: query.order,
    limit: query.limit,
  }
}

function mergeServiceLogs(current: SystemServiceLogsResult | null, incoming: SystemServiceLogsResult): SystemServiceLogsResult {
  if (!current) {
    return incoming
  }
  const cursors = new Set(current.entries.map((entry) => entry.cursor).filter(Boolean))
  const entries = [...current.entries]
  for (const entry of incoming.entries) {
    if (entry.cursor && cursors.has(entry.cursor)) {
      continue
    }
    if (entry.cursor) {
      cursors.add(entry.cursor)
    }
    entries.push(entry)
  }
  return {
    ...incoming,
    entries,
    warnings: Array.from(new Set([...current.warnings, ...incoming.warnings])),
  }
}

function isTerminalOperation(phase: SystemServiceOperationPhase): boolean {
  return phase === 'succeeded' || phase === 'failed' || phase === 'uncertain' || phase === 'cancelled'
}

function isRequestAborted(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'REQUEST_ABORTED')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TermousApi } from '../../api/client'
import type {
  RemoteProcessDetail,
  RemoteProcessListResult,
  RemoteProcessQuery,
  RemoteProcessSort,
  RemoteProcessTerminateResult,
  RemoteProcessTerminateSignal,
  Session,
} from '../../types/domain'

export type ProcessAutoRefreshSeconds = 0 | 5 | 10 | 30

export interface SessionProcessQueryState {
  text: string
  pid: string
  port: string
  sort: RemoteProcessSort
  limit: number
  autoRefreshSeconds: ProcessAutoRefreshSeconds
}

export interface SessionProcessState {
  query: SessionProcessQueryState
  list: RemoteProcessListResult | null
  detail: RemoteProcessDetail | null
  selectedPid: number | null
  loading: boolean
  detailLoading: boolean
  terminatingPid: number | null
  error: string
  detailError: string
  lastUpdatedAt: string
}

interface UseSessionProcessesOptions {
  api: TermousApi
  session: Session | null
  enabled: boolean
}

const defaultProcessQuery: SessionProcessQueryState = {
  text: '',
  pid: '',
  port: '',
  sort: 'cpu',
  limit: 100,
  autoRefreshSeconds: 0,
}

const emptyProcessState: SessionProcessState = {
  query: defaultProcessQuery,
  list: null,
  detail: null,
  selectedPid: null,
  loading: false,
  detailLoading: false,
  terminatingPid: null,
  error: '',
  detailError: '',
  lastUpdatedAt: '',
}

function createProcessState(): SessionProcessState {
  return {
    ...emptyProcessState,
    query: { ...defaultProcessQuery },
  }
}

export function useSessionProcesses({ api, session, enabled }: UseSessionProcessesOptions) {
  const statesRef = useRef<Record<string, SessionProcessState>>({})
  const listAbortRef = useRef<AbortController | null>(null)
  const detailAbortRef = useRef<AbortController | null>(null)
  const listRevisionRef = useRef<Record<string, number>>({})
  const detailRevisionRef = useRef<Record<string, number>>({})
  const [states, setStates] = useState<Record<string, SessionProcessState>>({})
  const sessionId = session?.id ?? ''
  const supported = Boolean(sessionId && session?.kind === 'ssh' && session.status === 'connected')
  const currentState = supported ? states[sessionId] ?? emptyProcessState : emptyProcessState

  const updateSessionState = useCallback((id: string, updater: (current: SessionProcessState) => SessionProcessState) => {
    if (!id) {
      return
    }
    setStates((current) => {
      const previous = current[id] ?? createProcessState()
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

  useEffect(
    () => () => {
      listAbortRef.current?.abort()
      detailAbortRef.current?.abort()
    },
    [],
  )

  const updateQuery = useCallback(
    (patch: Partial<SessionProcessQueryState>) => {
      updateSessionState(sessionId, (current) => ({
        ...current,
        query: { ...current.query, ...patch },
      }))
    },
    [sessionId, updateSessionState],
  )

  const resetQuery = useCallback(() => {
    updateSessionState(sessionId, (current) => ({
      ...current,
      query: { ...defaultProcessQuery },
    }))
  }, [sessionId, updateSessionState])

  const refresh = useCallback(async () => {
    if (!supported || !enabled || !sessionId) {
      return
    }
    const revision = (listRevisionRef.current[sessionId] ?? 0) + 1
    listRevisionRef.current[sessionId] = revision
    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller
    const query = buildProcessQuery(statesRef.current[sessionId]?.query ?? defaultProcessQuery)
    updateSessionState(sessionId, (current) => ({ ...current, loading: true, error: '' }))
    try {
      const list = await api.sessionProcesses(sessionId, query, { signal: controller.signal })
      if (listRevisionRef.current[sessionId] !== revision) {
        return
      }
      updateSessionState(sessionId, (current) => ({
        ...current,
        list,
        loading: false,
        error: '',
        lastUpdatedAt: list.collected_at,
      }))
    } catch (error) {
      if (listRevisionRef.current[sessionId] !== revision) {
        return
      }
      const message = error instanceof Error ? error.message : ''
      if (isRequestAborted(error)) {
        updateSessionState(sessionId, (current) => ({ ...current, loading: false }))
        return
      }
      updateSessionState(sessionId, (current) => ({ ...current, loading: false, error: message }))
    } finally {
      if (listAbortRef.current === controller) {
        listAbortRef.current = null
      }
    }
  }, [api, enabled, sessionId, supported, updateSessionState])

  const selectProcess = useCallback(
    async (pid: number) => {
      if (!supported || !enabled || !sessionId) {
        return
      }
      const revision = (detailRevisionRef.current[sessionId] ?? 0) + 1
      detailRevisionRef.current[sessionId] = revision
      detailAbortRef.current?.abort()
      const controller = new AbortController()
      detailAbortRef.current = controller
      updateSessionState(sessionId, (current) => ({
        ...current,
        selectedPid: pid,
        detailLoading: true,
        detailError: '',
      }))
      try {
        const detail = await api.sessionProcessDetail(sessionId, pid, { signal: controller.signal })
        if (detailRevisionRef.current[sessionId] !== revision) {
          return
        }
        updateSessionState(sessionId, (current) => ({ ...current, detail, detailLoading: false, detailError: '' }))
      } catch (error) {
        if (detailRevisionRef.current[sessionId] !== revision) {
          return
        }
        const message = error instanceof Error ? error.message : ''
        if (isRequestAborted(error)) {
          updateSessionState(sessionId, (current) => ({ ...current, detailLoading: false }))
          return
        }
        updateSessionState(sessionId, (current) => ({ ...current, detailLoading: false, detailError: message }))
      } finally {
        if (detailAbortRef.current === controller) {
          detailAbortRef.current = null
        }
      }
    },
    [api, enabled, sessionId, supported, updateSessionState],
  )

  const clearSelection = useCallback(() => {
    updateSessionState(sessionId, (current) => ({
      ...current,
      selectedPid: null,
      detail: null,
      detailError: '',
    }))
  }, [sessionId, updateSessionState])

  const terminateProcess = useCallback(
    async (pid: number, signal: RemoteProcessTerminateSignal = 'term'): Promise<RemoteProcessTerminateResult | null> => {
      if (!supported || !enabled || !sessionId) {
        return null
      }
      updateSessionState(sessionId, (current) => ({ ...current, terminatingPid: pid }))
      try {
        const result = await api.terminateSessionProcess(sessionId, pid, signal)
        await refresh()
        return result
      } finally {
        updateSessionState(sessionId, (current) => ({ ...current, terminatingPid: null }))
      }
    },
    [api, enabled, refresh, sessionId, supported, updateSessionState],
  )

  useEffect(() => {
    if (!enabled || !supported || currentState.list || currentState.loading) {
      return
    }
    void refresh()
  }, [currentState.list, currentState.loading, enabled, refresh, supported])

  useEffect(() => {
    if (!enabled || !supported || currentState.query.autoRefreshSeconds === 0) {
      return undefined
    }
    const timer = window.setInterval(() => {
      void refresh()
    }, currentState.query.autoRefreshSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [currentState.query.autoRefreshSeconds, enabled, refresh, supported])

  return {
    ...currentState,
    supported,
    refresh,
    updateQuery,
    resetQuery,
    selectProcess,
    clearSelection,
    terminateProcess,
  }
}

function buildProcessQuery(query: SessionProcessQueryState): RemoteProcessQuery {
  return {
    query: query.text,
    pid: parsePositiveInt(query.pid),
    port: parsePositiveInt(query.port),
    sort: query.sort,
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

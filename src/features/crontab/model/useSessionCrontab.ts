import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CrontabCapability,
  CrontabJobInput,
  CrontabSnapshot,
} from '#entities/crontab'
import { TermousApiError } from '#shared/api'
import type { CrontabGateway, CrontabSessionContext } from './contracts'

export type CrontabMutationKind = 'create' | 'update' | 'delete' | 'toggle' | 'replace'

export interface SessionCrontabState {
  capability: CrontabCapability | null
  snapshot: CrontabSnapshot | null
  loading: boolean
  mutation: CrontabMutationKind | null
  errorCode: string
  errorMessage: string
}

interface UseSessionCrontabOptions {
  api: CrontabGateway
  session: CrontabSessionContext | null
  enabled: boolean
}

interface CrontabLoadRequest {
  sessionId: string
  sequence: number
  controller: AbortController
}

const emptyState: SessionCrontabState = {
  capability: null,
  snapshot: null,
  loading: false,
  mutation: null,
  errorCode: '',
  errorMessage: '',
}

function createState(): SessionCrontabState {
  return { ...emptyState }
}

export function useSessionCrontab({ api, session, enabled }: UseSessionCrontabOptions) {
  const sessionId = session?.id ?? ''
  const supported = Boolean(sessionId && session?.kind === 'ssh' && session.status === 'connected')
  const [states, setStates] = useState<Record<string, SessionCrontabState>>({})
  const statesRef = useRef<Record<string, SessionCrontabState>>({})
  const loadRequestRef = useRef<CrontabLoadRequest | null>(null)
  const loadSequenceRef = useRef<Record<string, number>>({})
  const mutationRequestsRef = useRef(new Map<string, symbol>())
  const mountedRef = useRef(true)

  useEffect(() => {
    statesRef.current = states
  }, [states])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadRequestRef.current?.controller.abort()
      loadRequestRef.current = null
    }
  }, [])

  const updateSessionState = useCallback((
    id: string,
    updater: (current: SessionCrontabState) => SessionCrontabState,
  ) => {
    if (!id || !mountedRef.current) {
      return
    }
    setStates((current) => {
      const previous = current[id] ?? createState()
      const next = updater(previous)
      if (next === previous) {
        return current
      }
      const updated = { ...current, [id]: next }
      statesRef.current = updated
      return updated
    })
  }, [])

  const abortLoad = useCallback(() => {
    const request = loadRequestRef.current
    if (!request) {
      return
    }
    request.controller.abort()
    loadRequestRef.current = null
    updateSessionState(request.sessionId, (current) => ({ ...current, loading: false }))
  }, [updateSessionState])

  const loadSnapshot = useCallback(async (
    quiet = false,
    includeContent = false,
    requireWritable = false,
  ): Promise<CrontabSnapshot | null> => {
    if (!enabled || !supported || !sessionId) {
      return null
    }
    if (mutationRequestsRef.current.has(sessionId)) {
      return statesRef.current[sessionId]?.snapshot ?? null
    }
    abortLoad()
    const sequence = (loadSequenceRef.current[sessionId] ?? 0) + 1
    loadSequenceRef.current[sessionId] = sequence
    const request: CrontabLoadRequest = {
      sessionId,
      sequence,
      controller: new AbortController(),
    }
    loadRequestRef.current = request
    updateSessionState(sessionId, (current) => ({
      ...current,
      loading: quiet && current.snapshot ? current.loading : true,
      errorCode: '',
      errorMessage: '',
    }))
    try {
      const capability = await api.sessionCrontabCapability(sessionId, {
        signal: request.controller.signal,
      })
      if (!isCurrentLoad(loadRequestRef.current, request)) {
        return null
      }
      updateSessionState(sessionId, (current) => ({ ...current, capability }))
      if (!capability.available || !capability.readable) {
        updateSessionState(sessionId, (current) => ({
          ...current,
          snapshot: null,
          loading: false,
          errorMessage: capability.available ? '' : capability.status,
        }))
        return null
      }
      if (requireWritable && !capability.writable) {
        updateSessionState(sessionId, (current) => ({ ...current, loading: false }))
        return null
      }
      const snapshot = await (includeContent
        ? api.sessionCrontabSource(sessionId, { signal: request.controller.signal })
        : api.sessionCrontab(sessionId, { signal: request.controller.signal }))
      if (!isCurrentLoad(loadRequestRef.current, request)) {
        return null
      }
      updateSessionState(sessionId, (current) => ({
        ...current,
        capability,
        snapshot: withoutCrontabContent(snapshot),
        loading: false,
        errorCode: '',
        errorMessage: '',
      }))
      return snapshot
    } catch (error) {
      if (!isCurrentLoad(loadRequestRef.current, request)) {
        return null
      }
      const requestError = crontabRequestError(error)
      updateSessionState(sessionId, (current) => ({
        ...current,
        ...(!includeContent ? { capability: null, snapshot: null } : {}),
        loading: false,
        errorCode: isRequestAborted(error) ? '' : requestError.code,
        errorMessage: isRequestAborted(error) ? '' : requestError.message,
      }))
      if (!isRequestAborted(error)) {
        throw error
      }
      return null
    } finally {
      if (isCurrentLoad(loadRequestRef.current, request)) {
        loadRequestRef.current = null
      }
    }
  }, [abortLoad, api, enabled, sessionId, supported, updateSessionState])

  const refresh = useCallback((quiet = false) => loadSnapshot(quiet, false), [loadSnapshot])

  const loadSource = useCallback((requireWritable = false) => (
    loadSnapshot(false, true, requireWritable)
  ), [loadSnapshot])

  useEffect(() => {
    if (!enabled || !supported || !sessionId) {
      abortLoad()
      return
    }
    void refresh(Boolean(statesRef.current[sessionId]?.snapshot)).catch(() => undefined)
    return abortLoad
  }, [abortLoad, enabled, refresh, sessionId, supported])

  const runMutation = useCallback(async (
    kind: CrontabMutationKind,
    operation: (snapshot: CrontabSnapshot) => Promise<CrontabSnapshot>,
  ) => {
    const state = statesRef.current[sessionId]
    const snapshot = state?.snapshot
    if (!enabled || !supported || !sessionId || !snapshot) {
      throw new TermousApiError('当前 SSH 会话的定时任务不可用', 'SESSION_NOT_READY', 409)
    }
    if (!state.capability?.writable) {
      throw new TermousApiError('当前 SSH 用户的 crontab 不支持写入', 'CRONTAB_UNSUPPORTED', 400)
    }
    if (mutationRequestsRef.current.has(sessionId)) {
      throw new TermousApiError('已有定时任务操作正在进行', 'REQUEST_IN_PROGRESS', 409)
    }
    abortLoad()
    const requestIdentity = Symbol(kind)
    mutationRequestsRef.current.set(sessionId, requestIdentity)
    updateSessionState(sessionId, (current) => ({
      ...current,
      mutation: kind,
      errorCode: '',
      errorMessage: '',
    }))
    try {
      const nextSnapshot = await operation(snapshot)
      if (mutationRequestsRef.current.get(sessionId) !== requestIdentity) {
        throw new TermousApiError('定时任务操作已失效', 'REQUEST_ABORTED', 0)
      }
      updateSessionState(sessionId, (current) => ({
        ...current,
        snapshot: withoutCrontabContent(nextSnapshot),
        mutation: null,
        errorCode: '',
        errorMessage: '',
      }))
      return nextSnapshot
    } catch (error) {
      if (mutationRequestsRef.current.get(sessionId) !== requestIdentity) {
        throw error
      }
      const requestError = crontabRequestError(error)
      updateSessionState(sessionId, (current) => ({
        ...current,
        mutation: null,
        errorCode: requestError.code,
        errorMessage: requestError.message,
      }))
      throw error
    } finally {
      if (mutationRequestsRef.current.get(sessionId) === requestIdentity) {
        mutationRequestsRef.current.delete(sessionId)
      }
    }
  }, [abortLoad, enabled, sessionId, supported, updateSessionState])

  const createJob = useCallback((input: Omit<CrontabJobInput, 'expected_revision'>) => (
    runMutation('create', (snapshot) => api.createSessionCrontabJob(sessionId, {
      ...input,
      expected_revision: snapshot.revision,
    }))
  ), [api, runMutation, sessionId])

  const updateJob = useCallback((
    jobId: string,
    input: Omit<CrontabJobInput, 'expected_revision'>,
    kind: CrontabMutationKind = 'update',
  ) => (
    runMutation(kind, (snapshot) => api.updateSessionCrontabJob(sessionId, jobId, {
      ...input,
      expected_revision: snapshot.revision,
    }))
  ), [api, runMutation, sessionId])

  const deleteJob = useCallback((jobId: string) => (
    runMutation('delete', (snapshot) => (
      api.deleteSessionCrontabJob(sessionId, jobId, snapshot.revision)
    ))
  ), [api, runMutation, sessionId])

  const replaceContent = useCallback((content: string, expectedRevision: string) => (
    runMutation('replace', () => api.replaceSessionCrontab(sessionId, {
      content,
      expected_revision: expectedRevision,
    }))
  ), [api, runMutation, sessionId])

  const currentState = supported
    ? states[sessionId] ?? { ...emptyState, loading: enabled }
    : emptyState

  return {
    ...currentState,
    supported,
    refresh,
    loadSource,
    createJob,
    updateJob,
    deleteJob,
    replaceContent,
  }
}

function isCurrentLoad(current: CrontabLoadRequest | null, expected: CrontabLoadRequest) {
  return Boolean(
    current
    && current === expected
    && current.sessionId === expected.sessionId
    && current.sequence === expected.sequence
    && !current.controller.signal.aborted,
  )
}

function isRequestAborted(error: unknown) {
  return error instanceof TermousApiError && error.code === 'REQUEST_ABORTED'
}

function crontabRequestError(error: unknown) {
  if (error instanceof TermousApiError) {
    return { code: error.code, message: error.message }
  }
  return {
    code: '',
    message: error instanceof Error ? error.message : '',
  }
}

function withoutCrontabContent(snapshot: CrontabSnapshot): CrontabSnapshot {
  const metadata = { ...snapshot }
  delete metadata.content
  return metadata
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AliasMutationResult,
  ShellAliasInput,
  ShellAliasPatch,
} from '#entities/alias'
import { TermousApiError } from '#shared/api'
import type { AliasGateway, AliasSessionContext } from './contracts'
import {
  aliasSessionViewReducer,
  createAliasSessionViewState,
  isCurrentAliasOperation,
  parseAliasReconnectSessionIds,
  retainAliasSessionStates,
  serializeAliasReconnectSessionIds,
  type AliasMutationKind,
  type AliasSessionViewAction,
  type AliasSessionViewStates,
} from './aliasWorkspaceState'

const aliasReconnectStorageKey = 'termous.runtime.aliasReconnectRequired'
let aliasReconnectSessionIds: Set<string> | null = null

interface UseSessionAliasesOptions {
  api: AliasGateway
  session: AliasSessionContext | null
  sessionIds: readonly string[]
  enabled: boolean
}

interface AliasRequestIdentity {
  sessionId: string
  sequence: number
  controller: AbortController
}

export function useSessionAliases({
  api,
  session,
  sessionIds,
  enabled,
}: UseSessionAliasesOptions) {
  const sessionId = session?.id ?? ''
  const supported = Boolean(sessionId && session?.kind === 'ssh' && session.status === 'connected')
  const [states, setStates] = useState<AliasSessionViewStates>({})
  const statesRef = useRef<AliasSessionViewStates>({})
  const sequenceRef = useRef<Record<string, number>>({})
  const sessionIdsRef = useRef<ReadonlySet<string>>(new Set(sessionIds))
  const activeSessionIdRef = useRef(sessionId)
  const previousSessionIdsRef = useRef<ReadonlySet<string> | null>(null)
  const loadRequestRef = useRef<AliasRequestIdentity | null>(null)
  const mutationRequestsRef = useRef(new Map<string, AliasRequestIdentity>())

  sessionIdsRef.current = new Set(sessionIds)
  activeSessionIdRef.current = sessionId

  useEffect(() => {
    const retainedSessionIds = new Set(sessionIdsRef.current)
    if (sessionId) {
      retainedSessionIds.add(sessionId)
    }
    for (const pendingSessionId of mutationRequestsRef.current.keys()) {
      retainedSessionIds.add(pendingSessionId)
    }
    setStates((current) => {
      const next = retainAliasSessionStates(current, retainedSessionIds)
      statesRef.current = next
      return next
    })
    for (const cachedSessionId of Object.keys(sequenceRef.current)) {
      if (!retainedSessionIds.has(cachedSessionId)) {
        delete sequenceRef.current[cachedSessionId]
      }
    }
    if (sessionIds.length > 0 || (previousSessionIdsRef.current?.size ?? 0) > 0) {
      retainAliasReconnectSessionIds(retainedSessionIds)
    }
    previousSessionIdsRef.current = new Set(sessionIds)
  }, [sessionId, sessionIds])

  const dispatchState = useCallback((action: AliasSessionViewAction) => {
    setStates((current) => {
      const next = aliasSessionViewReducer(current, action)
      statesRef.current = next
      return next
    })
  }, [])

  const nextSequence = useCallback((id: string) => {
    const current = Math.max(
      sequenceRef.current[id] ?? 0,
      statesRef.current[id]?.requestSequence ?? 0,
    )
    const next = current + 1
    sequenceRef.current[id] = next
    return next
  }, [])

  const retireRequest = useCallback((
    identity: AliasRequestIdentity,
    requestRef: { current: AliasRequestIdentity | null },
  ) => {
    identity.controller.abort()
    if (isCurrentAliasOperation(requestRef.current, identity)) {
      requestRef.current = null
    }
    dispatchState({
      type: 'retire',
      sessionId: identity.sessionId,
      sequence: nextSequence(identity.sessionId),
    })
  }, [dispatchState, nextSequence])

  useEffect(
    () => () => {
      loadRequestRef.current?.controller.abort()
      loadRequestRef.current = null
    },
    [],
  )

  const refresh = useCallback(async (quiet = false) => {
    if (!supported || !enabled || !sessionId) {
      return null
    }
    if (mutationRequestsRef.current.has(sessionId)) {
      return statesRef.current[sessionId]?.workspace ?? null
    }
    if (loadRequestRef.current) {
      retireRequest(loadRequestRef.current, loadRequestRef)
    }

    const identity: AliasRequestIdentity = {
      sessionId,
      sequence: nextSequence(sessionId),
      controller: new AbortController(),
    }
    loadRequestRef.current = identity
    dispatchState({
      type: 'load-start',
      sessionId,
      sequence: identity.sequence,
      quiet,
    })
    try {
      const workspace = await api.sessionAliases(sessionId, {
        signal: identity.controller.signal,
      })
      if (
        !isCurrentAliasOperation(loadRequestRef.current, identity) ||
        sequenceRef.current[sessionId] !== identity.sequence
      ) {
        return null
      }
      dispatchState({
        type: 'load-success',
        sessionId,
        sequence: identity.sequence,
        workspace,
        loadedAt: Date.now(),
      })
      return workspace
    } catch (error) {
      if (
        !isCurrentAliasOperation(loadRequestRef.current, identity) ||
        sequenceRef.current[sessionId] !== identity.sequence
      ) {
        return null
      }
      const requestError = aliasRequestError(error)
      dispatchState({
        type: 'load-error',
        sessionId,
        sequence: identity.sequence,
        errorCode: isRequestAborted(error) ? '' : requestError.code,
        errorMessage: isRequestAborted(error) ? '' : requestError.message,
      })
      if (!isRequestAborted(error)) {
        throw error
      }
      return null
    } finally {
      if (isCurrentAliasOperation(loadRequestRef.current, identity)) {
        loadRequestRef.current = null
      }
    }
  }, [api, dispatchState, enabled, nextSequence, retireRequest, sessionId, supported])

  useEffect(() => {
    const active = enabled && supported && Boolean(sessionId)
    const loadRequest = loadRequestRef.current
    if (loadRequest && (!active || loadRequest.sessionId !== sessionId)) {
      retireRequest(loadRequest, loadRequestRef)
    }
    if (!active) {
      return
    }
    void refresh(Boolean(statesRef.current[sessionId]?.workspace)).catch(() => undefined)
  }, [enabled, refresh, retireRequest, sessionId, supported])

  const runMutation = useCallback(async (
    kind: AliasMutationKind,
    aliasId: string,
    operation: (signal: AbortSignal) => Promise<AliasMutationResult>,
  ) => {
    if (!supported || !enabled || !sessionId) {
      throw new TermousApiError('当前 SSH 会话不可用', 'SESSION_NOT_READY', 409)
    }
    if (mutationRequestsRef.current.has(sessionId)) {
      throw new TermousApiError('已有别名操作正在进行', 'REQUEST_IN_PROGRESS', 409)
    }
    if (loadRequestRef.current) {
      retireRequest(loadRequestRef.current, loadRequestRef)
    }

    const identity: AliasRequestIdentity = {
      sessionId,
      sequence: nextSequence(sessionId),
      controller: new AbortController(),
    }
    mutationRequestsRef.current.set(sessionId, identity)
    dispatchState({
      type: 'mutation-start',
      sessionId,
      sequence: identity.sequence,
      mutation: kind,
      aliasId,
    })
    try {
      const result = await operation(identity.controller.signal)
      if (
        !isCurrentAliasOperation(mutationRequestsRef.current.get(sessionId) ?? null, identity) ||
        sequenceRef.current[sessionId] !== identity.sequence
      ) {
        throw aliasRequestAbortedError()
      }
      if (result.apply_status === 'reconnect_required') {
        rememberAliasReconnectSessionId(sessionId)
      }
      dispatchState({
        type: 'mutation-success',
        sessionId,
        sequence: identity.sequence,
        workspace: result.workspace,
        applyStatus: result.apply_status,
      })
      return result
    } catch (error) {
      const current =
        isCurrentAliasOperation(
          mutationRequestsRef.current.get(sessionId) ?? null,
          identity,
        ) &&
        sequenceRef.current[sessionId] === identity.sequence
      if (!current) {
        throw aliasRequestAbortedError()
      }
      const requestError = aliasRequestError(error)
      dispatchState({
        type: 'mutation-error',
        sessionId,
        sequence: identity.sequence,
        errorCode: isRequestAborted(error) ? '' : requestError.code,
        errorMessage: isRequestAborted(error) ? '' : requestError.message,
      })
      throw error
    } finally {
      if (isCurrentAliasOperation(
        mutationRequestsRef.current.get(sessionId) ?? null,
        identity,
      )) {
        mutationRequestsRef.current.delete(sessionId)
      }
      if (!sessionIdsRef.current.has(sessionId) && activeSessionIdRef.current !== sessionId) {
        const retainedSessionIds = new Set(sessionIdsRef.current)
        if (activeSessionIdRef.current) {
          retainedSessionIds.add(activeSessionIdRef.current)
        }
        for (const pendingSessionId of mutationRequestsRef.current.keys()) {
          retainedSessionIds.add(pendingSessionId)
        }
        setStates((current) => {
          const next = retainAliasSessionStates(current, retainedSessionIds)
          statesRef.current = next
          return next
        })
        retainAliasReconnectSessionIds(retainedSessionIds)
      }
    }
  }, [dispatchState, enabled, nextSequence, retireRequest, sessionId, supported])

  const createAlias = useCallback(
    (input: ShellAliasInput) =>
      runMutation('create', '', (signal) =>
        api.createSessionAlias(sessionId, input, { signal })),
    [api, runMutation, sessionId],
  )

  const updateAlias = useCallback(
    (aliasId: string, input: ShellAliasPatch) =>
      runMutation('update', aliasId, (signal) =>
        api.updateSessionAlias(sessionId, aliasId, input, { signal })),
    [api, runMutation, sessionId],
  )

  const deleteAlias = useCallback(
    (aliasId: string) =>
      runMutation('delete', aliasId, (signal) =>
        api.deleteSessionAlias(sessionId, aliasId, { signal })),
    [api, runMutation, sessionId],
  )

  const repairBridge = useCallback(
    () =>
      runMutation('repair', '', (signal) =>
        api.repairSessionAliasBridge(sessionId, { signal })),
    [api, runMutation, sessionId],
  )

  const refreshTemplate = useCallback(
    () =>
      runMutation('refresh-template', '', (signal) =>
        api.refreshSessionAliasTemplate(sessionId, { signal })),
    [api, runMutation, sessionId],
  )

  const currentState = states[sessionId] ?? {
    ...createAliasSessionViewState(),
    loading: enabled && supported,
  }
  const reconnectRequired =
    currentState.reconnectRequired ||
    Boolean(sessionId && getAliasReconnectSessionIds().has(sessionId))

  return {
    ...currentState,
    reconnectRequired,
    supported,
    refresh,
    createAlias,
    updateAlias,
    deleteAlias,
    repairBridge,
    refreshTemplate,
  }
}

function isRequestAborted(error: unknown) {
  return error instanceof TermousApiError && error.code === 'REQUEST_ABORTED'
}

function aliasRequestAbortedError() {
  return new TermousApiError('别名操作已失效', 'REQUEST_ABORTED', 0)
}

function aliasRequestError(error: unknown) {
  if (error instanceof TermousApiError) {
    return { code: error.code, message: error.message }
  }
  return {
    code: '',
    message: error instanceof Error ? error.message : '',
  }
}

function getAliasReconnectSessionIds() {
  if (aliasReconnectSessionIds) {
    return aliasReconnectSessionIds
  }
  let stored: string | null
  try {
    stored = typeof window === 'undefined'
      ? null
      : window.sessionStorage.getItem(aliasReconnectStorageKey)
  } catch {
    stored = null
  }
  aliasReconnectSessionIds = new Set(parseAliasReconnectSessionIds(stored))
  return aliasReconnectSessionIds
}

function rememberAliasReconnectSessionId(sessionId: string) {
  if (!sessionId) {
    return
  }
  const sessionIds = getAliasReconnectSessionIds()
  sessionIds.add(sessionId)
  persistAliasReconnectSessionIds(sessionIds)
}

function retainAliasReconnectSessionIds(retainedSessionIds: ReadonlySet<string>) {
  const sessionIds = getAliasReconnectSessionIds()
  let changed = false
  for (const sessionId of sessionIds) {
    if (!retainedSessionIds.has(sessionId)) {
      sessionIds.delete(sessionId)
      changed = true
    }
  }
  if (changed) {
    persistAliasReconnectSessionIds(sessionIds)
  }
}

function persistAliasReconnectSessionIds(sessionIds: Iterable<string>) {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(
        aliasReconnectStorageKey,
        serializeAliasReconnectSessionIds(sessionIds),
      )
    }
  } catch {
    // sessionStorage 不可用时退化为当前渲染进程内状态。
  }
}

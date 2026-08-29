import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentModelProfile,
  AgentModelProfileInput,
  AgentReadiness,
  AgentReasoningLevel,
} from '#entities/agent'
import { TermousApiError } from '#shared/api'
import type { AgentSetupGateway } from '../api/agentSetupGateway.ts'
import { loadAllAgentModelProfiles } from './loadAgentModelProfiles.ts'

export type AgentSetupMutation = 'setup' | 'settings' | 'policy' | `model:${string}` | null

export type AgentSetupConflict =
  | { kind: 'settings' | 'policy' }
  | { kind: 'profile'; operation: 'edit' | 'api_key' | 'delete' | 'test'; profileId: string }

interface AgentSetupSnapshot {
  readiness: AgentReadiness
  profiles: AgentModelProfile[]
}

export function useAgentSetupController(gateway: AgentSetupGateway) {
  const [readiness, setReadiness] = useState<AgentReadiness | null>(null)
  const [profiles, setProfiles] = useState<AgentModelProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [mutation, setMutation] = useState<AgentSetupMutation>(null)
  const [error, setError] = useState<Error | null>(null)
  const [conflict, setConflict] = useState<AgentSetupConflict | null>(null)
  const mounted = useRef(false)
  const requestGeneration = useRef(0)
  const loadAbort = useRef<AbortController | null>(null)
  const mutationAbort = useRef<AbortController | null>(null)
  const mutationRef = useRef<AgentSetupMutation>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    if (mutationRef.current) return null
    const generation = ++requestGeneration.current
    loadAbort.current?.abort()
    const controller = new AbortController()
    loadAbort.current = controller
    const detachSignal = forwardAbort(signal, controller)
    setLoading(true)
    setError(null)
    try {
      const [nextReadiness, nextProfiles] = await Promise.all([
        gateway.readiness(controller.signal),
        loadAllAgentModelProfiles(gateway, controller.signal),
      ])
      if (!isCurrentRequest(mounted, requestGeneration, generation, controller)) return null
      setReadiness(nextReadiness)
      setProfiles(nextProfiles)
      return { readiness: nextReadiness, profiles: nextProfiles } satisfies AgentSetupSnapshot
    } catch (loadError) {
      if (!isCurrentRequest(mounted, requestGeneration, generation, controller) || isAborted(loadError)) return null
      setError(asError(loadError))
      return null
    } finally {
      detachSignal()
      if (loadAbort.current === controller) loadAbort.current = null
      if (mounted.current && generation === requestGeneration.current) setLoading(false)
    }
  }, [gateway])

  useEffect(() => {
    mounted.current = true
    mutationRef.current = null
    setMutation(null)
    const controller = new AbortController()
    void load(controller.signal)
    return () => {
      mounted.current = false
      requestGeneration.current += 1
      controller.abort()
      loadAbort.current?.abort()
      loadAbort.current = null
      mutationAbort.current?.abort()
      mutationAbort.current = null
      mutationRef.current = null
    }
  }, [load])

  const execute = useCallback(async <T,>(
    key: Exclude<AgentSetupMutation, null>,
    conflictContext: AgentSetupConflict | null,
    reconcileAfterSuccess: boolean,
    action: (signal: AbortSignal, isCurrent: () => boolean) => Promise<T>,
  ) => {
    if (mutationRef.current) throw new Error('Agent 设置操作正在进行')
    const generation = ++requestGeneration.current
    loadAbort.current?.abort()
    loadAbort.current = null
    const controller = new AbortController()
    mutationAbort.current = controller
    mutationRef.current = key
    setLoading(false)
    setMutation(key)
    setError(null)
    let succeeded = false
    const isCurrent = () => isCurrentRequest(mounted, requestGeneration, generation, controller)
    try {
      const result = await action(controller.signal, isCurrent)
      if (!isCurrent()) throw requestAbortedError()
      succeeded = true
      setConflict(null)
      return result
    } catch (actionError) {
      if (isCurrent() && !isAborted(actionError)) {
        setError(asError(actionError))
        if (conflictContext && isRevisionConflict(actionError)) setConflict(conflictContext)
      }
      throw actionError
    } finally {
      if (mutationAbort.current === controller) {
        mutationAbort.current = null
        mutationRef.current = null
        if (mounted.current) {
          setMutation(null)
          if (succeeded && reconcileAfterSuccess) void load()
        }
      }
    }
  }, [load])

  const setup = useCallback(() => execute('setup', null, false, async (signal, isCurrent) => {
    const next = await gateway.setup(signal)
    if (isCurrent()) setReadiness(next)
    return next
  }), [execute, gateway])

  const updateSettings = useCallback((defaultModelProfileId: string, reasoning: AgentReasoningLevel) => {
    if (!readiness) return Promise.reject(new Error('Agent settings are unavailable'))
    return execute('settings', { kind: 'settings' }, true, async (signal, isCurrent) => {
      const settings = await gateway.updateSettings({
        default_model_profile_id: defaultModelProfileId,
        default_reasoning_level: reasoning,
        expected_revision: readiness.settings.revision,
      }, signal)
      if (isCurrent()) setReadiness((current) => current ? { ...current, settings } : current)
      return settings
    })
  }, [execute, gateway, readiness])

  const updatePolicy = useCallback((approvalBypass: boolean, syncScopes = false) => {
    const policy = readiness?.mcp_policy
    if (!policy) return Promise.reject(new Error('Agent MCP policy is unavailable'))
    return execute('policy', { kind: 'policy' }, true, async (signal, isCurrent) => {
      const next = await gateway.updateMcpPolicy({
        approval_bypass: approvalBypass,
        sync_scopes: syncScopes,
        expected_revision: policy.revision,
      }, signal)
      if (isCurrent()) setReadiness((current) => current ? { ...current, mcp_policy: next } : current)
      return next
    })
  }, [execute, gateway, readiness?.mcp_policy])

  const saveProfile = useCallback((input: AgentModelProfileInput, current?: AgentModelProfile) => (
    execute(
      `model:${current?.id ?? 'create'}`,
      current ? { kind: 'profile', operation: 'edit', profileId: current.id } : null,
      true,
      async (signal, isCurrent) => {
        const saved = current
          ? await gateway.updateModelProfile(current.id, { ...input, expected_revision: current.revision }, signal)
          : await gateway.createModelProfile(input, signal)
        if (isCurrent()) setProfiles((items) => upsertProfile(items, saved))
        return saved
      },
    )
  ), [execute, gateway])

  const deleteProfile = useCallback((profile: AgentModelProfile) => (
    execute(`model:${profile.id}`, { kind: 'profile', operation: 'delete', profileId: profile.id }, true, async (signal, isCurrent) => {
      await gateway.deleteModelProfile(profile.id, profile.revision, signal)
      if (isCurrent()) setProfiles((items) => items.filter((item) => item.id !== profile.id))
    })
  ), [execute, gateway])

  const testProfile = useCallback((profile: AgentModelProfile) => (
    execute(
      `model:${profile.id}`,
      { kind: 'profile', operation: 'test', profileId: profile.id },
      false,
      (signal) => gateway.testModelProfile(profile.id, profile.revision, signal),
    )
  ), [execute, gateway])

  const replaceApiKey = useCallback((profile: AgentModelProfile, apiKey: string) => (
    execute(`model:${profile.id}`, { kind: 'profile', operation: 'api_key', profileId: profile.id }, true, async (signal, isCurrent) => {
      const saved = await gateway.replaceModelApiKey(profile.id, apiKey, profile.revision, signal)
      if (isCurrent()) setProfiles((items) => upsertProfile(items, saved))
      return saved
    })
  ), [execute, gateway])

  const deleteApiKey = useCallback((profile: AgentModelProfile) => (
    execute(`model:${profile.id}`, { kind: 'profile', operation: 'api_key', profileId: profile.id }, true, async (signal, isCurrent) => {
      const saved = await gateway.deleteModelApiKey(profile.id, profile.revision, signal)
      if (isCurrent()) setProfiles((items) => upsertProfile(items, saved))
      return saved
    })
  ), [execute, gateway])

  const resolveConflict = useCallback(async () => {
    const snapshot = await load()
    if (snapshot && mounted.current) {
      setConflict(null)
      setError(null)
    }
    return snapshot
  }, [load])

  return useMemo(() => ({
    readiness, profiles, loading, mutation, error, conflict, load, resolveConflict, setup, updateSettings, updatePolicy,
    saveProfile, deleteProfile, testProfile, replaceApiKey, deleteApiKey,
  }), [
    conflict, deleteApiKey, deleteProfile, error, load, loading, mutation, profiles, readiness, resolveConflict,
    replaceApiKey, saveProfile, setup, testProfile, updatePolicy, updateSettings,
  ])
}

function upsertProfile(items: AgentModelProfile[], saved: AgentModelProfile) {
  const index = items.findIndex((item) => item.id === saved.id)
  if (index < 0) return [...items, saved]
  return items.map((item) => item.id === saved.id ? saved : item)
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error('Agent operation failed')
}

function isAborted(value: unknown) {
  return value instanceof TermousApiError && value.code === 'REQUEST_ABORTED'
}

function isRevisionConflict(value: unknown) {
  return value instanceof TermousApiError
    && value.status === 409
    && value.code === 'AGENT_REVISION_CONFLICT'
}

function isCurrentRequest(
  mounted: { current: boolean },
  generationRef: { current: number },
  generation: number,
  controller: AbortController,
) {
  return mounted.current && generationRef.current === generation && !controller.signal.aborted
}

function requestAbortedError() {
  return new TermousApiError('请求已取消', 'REQUEST_ABORTED', 0)
}

function forwardAbort(signal: AbortSignal | undefined, controller: AbortController) {
  if (!signal) return () => undefined
  const abort = () => controller.abort()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

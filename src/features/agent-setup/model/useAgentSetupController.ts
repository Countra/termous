import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentModel,
  AgentModelProvider,
  AgentModelProviderInput,
  AgentModelUpdateInput,
  AgentReadiness,
  AgentReasoningLevel,
} from '#entities/agent'
import { TermousApiError } from '#shared/api'
import type { AgentSetupGateway } from '../api/agentSetupGateway.ts'
import { loadAgentModelCatalog } from './loadAgentModelCatalog.ts'

export type AgentSetupMutation =
  | 'setup'
  | 'settings'
  | 'policy'
  | `provider:${string}`
  | `model:${string}`
  | null

export type AgentSetupConflict =
  | { kind: 'settings' | 'policy' }
  | {
      kind: 'provider'
      operation: 'edit' | 'delete' | 'test' | 'refresh'
      providerId: string
    }
  | { kind: 'model'; operation: 'edit' | 'test'; modelId: string }

export class AgentProviderProvisionError extends Error {
  constructor(
    readonly providerId: string,
    readonly stage: 'refresh',
    readonly cause: unknown,
  ) {
    super('Agent Provider 模型同步失败')
    this.name = 'AgentProviderProvisionError'
  }
}

interface AgentSetupSnapshot {
  readiness: AgentReadiness
  providers: AgentModelProvider[]
  models: AgentModel[]
}

interface ExecuteOptions {
  conflict: AgentSetupConflict | null
  reconcileAfterSuccess?: boolean
  reconcileAfterFailure?: boolean
}

export function useAgentSetupController(gateway: AgentSetupGateway) {
  const [readiness, setReadiness] = useState<AgentReadiness | null>(null)
  const [providers, setProviders] = useState<AgentModelProvider[]>([])
  const [models, setModels] = useState<AgentModel[]>([])
  const [loading, setLoading] = useState(true)
  const [mutation, setMutation] = useState<AgentSetupMutation>(null)
  const [error, setError] = useState<Error | null>(null)
  const [conflict, setConflict] = useState<AgentSetupConflict | null>(null)
  const mounted = useRef(false)
  const requestGeneration = useRef(0)
  const loadAbort = useRef<AbortController | null>(null)
  const mutationAbort = useRef<AbortController | null>(null)
  const mutationRef = useRef<AgentSetupMutation>(null)

  const load = useCallback(async (signal?: AbortSignal, preserveError = false) => {
    if (mutationRef.current) return null
    const generation = ++requestGeneration.current
    loadAbort.current?.abort()
    const controller = new AbortController()
    loadAbort.current = controller
    const detachSignal = forwardAbort(signal, controller)
    setLoading(true)
    if (!preserveError) setError(null)
    try {
      const [nextReadiness, catalog] = await Promise.all([
        gateway.readiness(controller.signal),
        loadAgentModelCatalog(gateway, controller.signal),
      ])
      if (!isCurrentRequest(mounted, requestGeneration, generation, controller)) return null
      setReadiness(nextReadiness)
      setProviders(catalog.providers)
      setModels(catalog.models)
      return { readiness: nextReadiness, ...catalog } satisfies AgentSetupSnapshot
    } catch (loadError) {
      if (!isCurrentRequest(mounted, requestGeneration, generation, controller) || isAborted(loadError)) return null
      if (!preserveError) setError(asError(loadError))
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
      mutationAbort.current?.abort()
      loadAbort.current = null
      mutationAbort.current = null
      mutationRef.current = null
    }
  }, [load])

  const execute = useCallback(async <T,>(
    key: Exclude<AgentSetupMutation, null>,
    options: ExecuteOptions,
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
    let failure: unknown
    const isCurrent = () => isCurrentRequest(mounted, requestGeneration, generation, controller)
    try {
      const result = await action(controller.signal, isCurrent)
      if (!isCurrent()) throw requestAbortedError()
      succeeded = true
      setConflict(null)
      return result
    } catch (actionError) {
      failure = actionError
      if (isCurrent() && !isAborted(actionError)) {
        setError(asError(actionError))
        if (options.conflict && isRevisionConflict(actionError)) setConflict(options.conflict)
      }
      throw actionError
    } finally {
      if (mutationAbort.current === controller) {
        mutationAbort.current = null
        mutationRef.current = null
        if (mounted.current) {
          setMutation(null)
          if (succeeded && options.reconcileAfterSuccess) void load()
          if (!succeeded && options.reconcileAfterFailure) {
            void load(undefined, shouldPreserveMutationError(failure))
          }
        }
      }
    }
  }, [load])

  const setup = useCallback(() => execute(
    'setup',
    { conflict: null, reconcileAfterSuccess: true },
    async (signal, isCurrent) => {
      const next = await gateway.setup(signal)
      if (isCurrent()) setReadiness(next)
      return next
    },
  ), [execute, gateway])

  const updateSettings = useCallback((patch: {
    default_model_id?: string
    default_reasoning_level?: AgentReasoningLevel
    show_turn_token_usage?: boolean
  }) => {
    if (!readiness) return Promise.reject(new Error('Agent settings are unavailable'))
    const currentSettings = readiness.settings
    return execute(
      'settings',
      { conflict: { kind: 'settings' }, reconcileAfterSuccess: true },
      async (signal, isCurrent) => {
        const settings = await gateway.updateSettings({
          default_model_id: patch.default_model_id ?? currentSettings.default_model_id ?? '',
          default_reasoning_level: patch.default_reasoning_level ?? currentSettings.default_reasoning_level,
          show_turn_token_usage: patch.show_turn_token_usage ?? currentSettings.show_turn_token_usage,
          expected_revision: currentSettings.revision,
        }, signal)
        if (isCurrent()) setReadiness((current) => current ? { ...current, settings } : current)
        return settings
      },
    )
  }, [execute, gateway, readiness])

  const updatePolicy = useCallback((approvalBypass: boolean, syncScopes = false) => {
    const policy = readiness?.mcp_policy
    if (!policy) return Promise.reject(new Error('Agent MCP policy is unavailable'))
    return execute(
      'policy',
      { conflict: { kind: 'policy' }, reconcileAfterSuccess: true },
      async (signal, isCurrent) => {
        const next = await gateway.updateMcpPolicy({
          approval_bypass: approvalBypass,
          sync_scopes: syncScopes,
          expected_revision: policy.revision,
        }, signal)
        if (isCurrent()) setReadiness((current) => current ? { ...current, mcp_policy: next } : current)
        return next
      },
    )
  }, [execute, gateway, readiness?.mcp_policy])

  const saveProvider = useCallback((
    input: AgentModelProviderInput,
    current?: AgentModelProvider,
  ) => execute(
    `provider:${current?.id ?? 'create'}`,
    {
      conflict: current ? { kind: 'provider', operation: 'edit', providerId: current.id } : null,
      reconcileAfterSuccess: true,
      reconcileAfterFailure: true,
    },
    async (signal, isCurrent) => {
      let saved = current
        ? await gateway.updateModelProvider(current.id, { ...input, expected_revision: current.revision }, signal)
        : await gateway.createModelProvider(input, signal)
      if (isCurrent()) setProviders((items) => upsert(items, saved))

      const catalogChanged = !current
        || current.api_mode !== input.api_mode
        || current.base_url !== input.base_url
        || (!current.enabled && input.enabled)
        || input.api_key !== undefined
        || input.remove_api_key === true
      if (saved.enabled && catalogChanged) {
        try {
          saved = await gateway.refreshProviderModels(saved.id, saved.revision, signal)
          if (isCurrent()) setProviders((items) => upsert(items, saved))
          if (hasCatalogRefreshFailure(saved)) {
            throw new AgentProviderProvisionError(saved.id, 'refresh', saved.last_refresh_error_code)
          }
        } catch (refreshError) {
          if (refreshError instanceof AgentProviderProvisionError || isAborted(refreshError)) throw refreshError
          throw new AgentProviderProvisionError(saved.id, 'refresh', refreshError)
        }
      }
      return saved
    },
  ), [execute, gateway])

  const deleteProvider = useCallback((provider: AgentModelProvider) => execute(
    `provider:${provider.id}`,
    {
      conflict: { kind: 'provider', operation: 'delete', providerId: provider.id },
      reconcileAfterSuccess: true,
    },
    async (signal, isCurrent) => {
      await gateway.deleteModelProvider(provider.id, provider.revision, signal)
      if (isCurrent()) {
        setProviders((items) => items.filter(({ id }) => id !== provider.id))
        setModels((items) => items.filter(({ provider_id }) => provider_id !== provider.id))
      }
    },
  ), [execute, gateway])

  const testProvider = useCallback((provider: AgentModelProvider) => execute(
    `provider:${provider.id}`,
    { conflict: { kind: 'provider', operation: 'test', providerId: provider.id } },
    (signal) => gateway.testModelProvider(provider.id, provider.revision, signal),
  ), [execute, gateway])

  const refreshProvider = useCallback((provider: AgentModelProvider) => execute(
    `provider:${provider.id}`,
    {
      conflict: { kind: 'provider', operation: 'refresh', providerId: provider.id },
      reconcileAfterSuccess: true,
      reconcileAfterFailure: true,
    },
    async (signal, isCurrent) => {
      const saved = await gateway.refreshProviderModels(provider.id, provider.revision, signal)
      if (isCurrent()) setProviders((items) => upsert(items, saved))
      return saved
    },
  ), [execute, gateway])

  const saveModel = useCallback((
    model: AgentModel,
    input: Omit<AgentModelUpdateInput, 'expected_revision'>,
  ) => execute(
    `model:${model.id}`,
    {
      conflict: { kind: 'model', operation: 'edit', modelId: model.id },
      reconcileAfterSuccess: true,
    },
    async (signal, isCurrent) => {
      const saved = await gateway.updateModel(model.id, { ...input, expected_revision: model.revision }, signal)
      if (isCurrent()) setModels((items) => upsert(items, saved))
      return saved
    },
  ), [execute, gateway])

  const testModel = useCallback((model: AgentModel) => execute(
    `model:${model.id}`,
    { conflict: { kind: 'model', operation: 'test', modelId: model.id } },
    (signal) => gateway.testModel(model.id, model.revision, signal),
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
    readiness, providers, models, loading, mutation, error, conflict,
    load, resolveConflict, setup, updateSettings, updatePolicy,
    saveProvider, deleteProvider, testProvider, refreshProvider,
    saveModel, testModel,
  }), [
    conflict, deleteProvider, error, load, loading, models, mutation, providers,
    readiness, refreshProvider, resolveConflict, saveModel, saveProvider, setup,
    testModel, testProvider, updatePolicy, updateSettings,
  ])
}

export type AgentSetupController = ReturnType<typeof useAgentSetupController>

function upsert<Item extends { id: string }>(items: Item[], saved: Item) {
  return items.some(({ id }) => id === saved.id)
    ? items.map((item) => item.id === saved.id ? saved : item)
    : [...items, saved]
}

function hasCatalogRefreshFailure(provider: AgentModelProvider) {
  return provider.refresh_status !== 'ready' || Boolean(provider.last_refresh_error_code)
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error('Agent operation failed')
}

function isAborted(value: unknown) {
  return value instanceof TermousApiError && value.code === 'REQUEST_ABORTED'
}

function isRevisionConflict(value: unknown): boolean {
  return value instanceof TermousApiError
    && value.status === 409
    && value.code === 'AGENT_REVISION_CONFLICT'
}

function shouldPreserveMutationError(value: unknown) {
  return !isAborted(value)
    && !isRevisionConflict(value)
    && !(value instanceof AgentProviderProvisionError)
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

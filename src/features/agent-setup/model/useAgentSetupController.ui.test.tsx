import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  AgentModel,
  AgentModelProvider,
  AgentReadiness,
  AgentSettings,
} from '#entities/agent'
import { TermousApiError } from '#shared/api'
import type { AgentSetupGateway } from '../api/agentSetupGateway.ts'
import { useAgentSetupController } from './useAgentSetupController.ts'

describe('useAgentSetupController', () => {
  it('按最新 revision 保存显式默认模型并重新读取 readiness', async () => {
    const first = readinessFixture(2, 'apm-1', 'high')
    const refreshed = readinessFixture(3, '', 'off')
    const gateway = gatewayFixture({ readiness: first })
    vi.mocked(gateway.readiness).mockResolvedValueOnce(first).mockResolvedValue(refreshed)
    vi.mocked(gateway.updateSettings).mockResolvedValue(refreshed.settings)
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    await act(async () => { await view.result.current.updateSettings('', 'off') })

    expect(gateway.updateSettings).toHaveBeenCalledWith({
      default_model_id: '', default_reasoning_level: 'off', expected_revision: 2,
    }, expect.any(AbortSignal))
    expect(view.result.current.readiness?.settings).toEqual(refreshed.settings)
  })

  it('创建 Provider 时原子保存密钥并使用服务端 revision 刷新目录', async () => {
    const created = providerFixture(1, true, 'stale')
    const refreshed = providerFixture(2, true, 'ready')
    const gateway = gatewayFixture()
    vi.mocked(gateway.createModelProvider).mockResolvedValue(created)
    vi.mocked(gateway.refreshProviderModels).mockResolvedValue(refreshed)
    vi.mocked(gateway.modelProviders).mockResolvedValueOnce({ items: [] }).mockResolvedValue({ items: [refreshed] })
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    await act(async () => {
      await view.result.current.saveProvider({ ...providerInput(), api_key: 'one-time-secret' })
    })

    expect(gateway.createModelProvider).toHaveBeenCalledWith(
      { ...providerInput(), api_key: 'one-time-secret' }, expect.any(AbortSignal),
    )
    expect(gateway.refreshProviderModels).toHaveBeenCalledWith(created.id, 1, expect.any(AbortSignal))
    await waitFor(() => expect(view.result.current.providers).toEqual([refreshed]))
  })

  it('Provider 与密钥已保存但目录刷新失败时保留权威结果并返回分阶段错误', async () => {
    const original = providerFixture(4, false, 'ready')
    const keyed = providerFixture(5, true, 'stale')
    const failed = { ...providerFixture(6, true, 'stale'), last_refresh_error_code: 'authentication_failed' }
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.updateModelProvider).mockResolvedValue(keyed)
    vi.mocked(gateway.refreshProviderModels).mockResolvedValue(failed)
    vi.mocked(gateway.modelProviders).mockResolvedValueOnce({ items: [original] }).mockResolvedValue({ items: [failed] })
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    await act(async () => {
      await expect(view.result.current.saveProvider({
        ...providerInput(), api_key: 'one-time-secret',
      }, original))
        .rejects.toMatchObject({ name: 'AgentProviderProvisionError', stage: 'refresh' })
    })

    await waitFor(() => expect(view.result.current.providers).toEqual([failed]))
    expect(view.result.current.error).toBeNull()
  })

  it('配置已提交后的目录 revision 冲突不归类为编辑冲突', async () => {
    const original = providerFixture(4)
    const saved = {
      ...providerFixture(5, false, 'stale'),
      base_url: 'https://new.example.test/v1',
    }
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.updateModelProvider).mockResolvedValue(saved)
    vi.mocked(gateway.refreshProviderModels).mockRejectedValue(
      new TermousApiError('conflict', 'AGENT_REVISION_CONFLICT', 409),
    )
    vi.mocked(gateway.modelProviders).mockResolvedValueOnce({ items: [original] }).mockResolvedValue({ items: [saved] })
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    await act(async () => {
      await expect(view.result.current.saveProvider({
        ...providerInput(), base_url: saved.base_url,
      }, original)).rejects.toMatchObject({
        name: 'AgentProviderProvisionError', stage: 'refresh',
      })
    })

    expect(view.result.current.conflict).toBeNull()
    await waitFor(() => expect(view.result.current.providers).toEqual([saved]))
  })

  it('revision 冲突保留 Provider 投影并公开可恢复的冲突状态', async () => {
    const original = providerFixture(4)
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.updateModelProvider).mockRejectedValue(new TermousApiError('conflict', 'AGENT_REVISION_CONFLICT', 409))
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    await act(async () => {
      await expect(view.result.current.saveProvider({ ...providerInput(), name: 'Draft' }, original)).rejects.toThrow('conflict')
    })

    expect(view.result.current.providers).toEqual([original])
    expect(view.result.current.conflict).toEqual({
      kind: 'provider', operation: 'edit', providerId: original.id,
    })
  })

  it('Provider 普通保存失败后对账不清除原始错误', async () => {
    const original = providerFixture(4)
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.updateModelProvider).mockRejectedValue(new Error('network failed'))
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    await act(async () => {
      await expect(view.result.current.saveProvider({
        ...providerInput(), name: 'Draft',
      }, original)).rejects.toThrow('network failed')
    })

    await waitFor(() => expect(gateway.modelProviders).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    expect(view.result.current.error?.message).toBe('network failed')
    expect(view.result.current.providers).toEqual([original])
  })

  it('Provider 保存与后续对账都失败时仍保留原始保存错误', async () => {
    const original = providerFixture(4)
    const gateway = gatewayFixture({ providers: [original] })
    vi.mocked(gateway.updateModelProvider).mockRejectedValue(new Error('mutation failed'))
    vi.mocked(gateway.readiness)
      .mockResolvedValueOnce(readinessFixture())
      .mockRejectedValue(new Error('reconcile failed'))
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    await act(async () => {
      await expect(view.result.current.saveProvider({
        ...providerInput(), name: 'Draft',
      }, original)).rejects.toThrow('mutation failed')
    })

    await waitFor(() => expect(gateway.readiness).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    expect(view.result.current.error?.message).toBe('mutation failed')
    expect(view.result.current.providers).toEqual([original])
  })

  it('卸载时取消在途 mutation 且不再写入状态', async () => {
    const gateway = gatewayFixture()
    const pending = deferred<AgentSettings>()
    let receivedSignal: AbortSignal | undefined
    vi.mocked(gateway.updateSettings).mockImplementation((_input, signal) => {
      receivedSignal = signal
      return pending.promise
    })
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    const mutation = view.result.current.updateSettings('', 'off')
    await waitFor(() => expect(receivedSignal).toBeDefined())
    view.unmount()
    expect(receivedSignal?.aborted).toBe(true)
    pending.resolve(readinessFixture(99).settings)
    await expect(mutation).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
  })

  it('卸载时取消 Provider 目录刷新且不把取消包装为同步失败', async () => {
    const created = providerFixture(1, true, 'stale')
    const gateway = gatewayFixture()
    const pending = deferred<AgentModelProvider>()
    let receivedSignal: AbortSignal | undefined
    vi.mocked(gateway.createModelProvider).mockResolvedValue(created)
    vi.mocked(gateway.refreshProviderModels).mockImplementation((_id, _revision, signal) => {
      receivedSignal = signal
      return pending.promise
    })
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    const mutation = view.result.current.saveProvider({
      ...providerInput(), api_key: 'one-time-secret',
    })
    await waitFor(() => expect(receivedSignal).toBeDefined())
    view.unmount()
    expect(receivedSignal?.aborted).toBe(true)
    pending.reject(new TermousApiError('请求已取消', 'REQUEST_ABORTED', 0))

    await expect(mutation).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
  })
})

function gatewayFixture(options: {
  readiness?: AgentReadiness
  providers?: AgentModelProvider[]
  models?: AgentModel[]
} = {}): AgentSetupGateway {
  const readiness = options.readiness ?? readinessFixture()
  const providers = options.providers ?? []
  const models = options.models ?? []
  return {
    settings: vi.fn(async () => readiness.settings),
    updateSettings: vi.fn(async () => readiness.settings),
    readiness: vi.fn(async () => readiness),
    setup: vi.fn(async () => readiness),
    updateMcpPolicy: vi.fn(async () => readiness.mcp_policy!),
    modelProviders: vi.fn(async () => ({ items: providers })),
    createModelProvider: vi.fn(async (input) => ({ ...providerFixture(), ...input })),
    updateModelProvider: vi.fn(async (_id, input) => ({ ...providerFixture(input.expected_revision + 1), ...input })),
    deleteModelProvider: vi.fn(async () => undefined),
    testModelProvider: vi.fn(async () => ({ status: 'ready' as const, latency_ms: 20, model_count: models.length, message: '' })),
    refreshProviderModels: vi.fn(async () => providerFixture(2, false, 'ready')),
    models: vi.fn(async () => ({ items: models })),
    model: vi.fn(async () => models[0] ?? modelFixture()),
    updateModel: vi.fn(async (_id, input) => ({ ...modelFixture(input.expected_revision + 1), ...input })),
    testModel: vi.fn(async () => ({ status: 'ready' as const, latency_ms: 20, model_id: 'gpt-test', message: '' })),
  }
}

function readinessFixture(revision = 1, defaultModelId = '', reasoning: 'off' | 'high' = 'off'): AgentReadiness {
  return {
    status: defaultModelId ? 'ready' : 'needs_setup',
    mcp_runtime: { status: 'ready', message: '' },
    mcp_client: { status: 'ready', message: '' },
    skills_bundle: { status: 'ready', message: '' },
    default_model: { status: defaultModelId ? 'ready' : 'missing', message: '' },
    mcp_policy: { client_id: 'client-1', approval_bypass: false, scope_count: 29, required_scope_count: 29, scope_sync_required: false, revision: 1 },
    settings: {
      ...(defaultModelId ? { default_model_id: defaultModelId } : {}),
      default_reasoning_level: reasoning, revision,
      created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
    },
  }
}

function providerInput() {
  return {
    name: 'Provider', api_mode: 'responses' as const, base_url: 'https://example.test/v1',
    enabled: true, confirm_insecure_http: false,
  }
}

function providerFixture(
  revision = 1,
  apiKeyConfigured = false,
  refreshStatus: AgentModelProvider['refresh_status'] = 'ready',
): AgentModelProvider {
  return {
    id: 'apv-1', name: 'Provider', api_mode: 'responses', base_url: 'https://example.test/v1',
    enabled: true, api_key_configured: apiKeyConfigured, refresh_status: refreshStatus, revision,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
  }
}

function modelFixture(revision = 1): AgentModel {
  return {
    id: 'apm-1', provider_id: 'apv-1', remote_model_id: 'gpt-test', display_name: 'GPT Test',
    availability: 'available', context_window_tokens: 8192, max_output_tokens: 1024,
    supports_images: false, supports_reasoning: true, capabilities_confirmed: false, revision,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

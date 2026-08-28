import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentReadiness, AgentSettings } from '#entities/agent'
import { TermousApiError } from '#shared/api'
import type { AgentSetupGateway } from '../api/agentSetupGateway.ts'
import { useAgentSetupController } from './useAgentSetupController.ts'

describe('useAgentSetupController', () => {
  it('按最新 revision 保存设置并重新读取完整 readiness', async () => {
    const first = readinessFixture(2, 'amp-1', 'high')
    const refreshed = readinessFixture(3, '', 'off')
    const gateway = gatewayFixture()
    vi.mocked(gateway.readiness)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(refreshed)
    vi.mocked(gateway.updateSettings).mockResolvedValue(refreshed.settings)
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    await act(async () => {
      await view.result.current.updateSettings('', 'off')
    })

    expect(gateway.updateSettings).toHaveBeenCalledWith({
      default_model_profile_id: '',
      default_reasoning_level: 'off',
      expected_revision: 2,
    }, expect.any(AbortSignal))
    expect(view.result.current.readiness?.settings).toEqual(refreshed.settings)
  })

  it('API Key 更新后采用响应中的新 revision', async () => {
    const gateway = gatewayFixture()
    const original = profileFixture(4, false)
    const saved = profileFixture(5, true)
    vi.mocked(gateway.modelProfiles)
      .mockResolvedValueOnce({ items: [original] })
      .mockResolvedValue({ items: [saved] })
    vi.mocked(gateway.replaceModelApiKey).mockResolvedValue(saved)
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    await act(async () => {
      await view.result.current.replaceApiKey(original, 'one-time-secret')
    })

    expect(gateway.replaceModelApiKey).toHaveBeenCalledWith('amp-1', 'one-time-secret', 4, expect.any(AbortSignal))
    await waitFor(() => expect(view.result.current.profiles[0]).toEqual(saved))
  })

  it('revision 冲突时保留当前模型列表和错误状态', async () => {
    const gateway = gatewayFixture()
    const original = profileFixture(4, false)
    vi.mocked(gateway.modelProfiles).mockResolvedValue({ items: [original] })
    vi.mocked(gateway.updateModelProfile).mockRejectedValue(new TermousApiError('conflict', 'AGENT_REVISION_CONFLICT', 409))
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    await act(async () => {
      await expect(view.result.current.saveProfile({
        name: 'Draft name', api_mode: 'responses', base_url: 'https://example.test/v1', model_id: 'gpt-test',
        context_window_tokens: 8192, max_output_tokens: 1024, supports_images: false,
        supports_reasoning: true, confirm_insecure_http: false,
      }, original)).rejects.toThrow('conflict')
    })

    expect(view.result.current.profiles).toEqual([original])
    expect(view.result.current.error?.message).toBe('conflict')
    expect(view.result.current.conflict).toEqual({ kind: 'profile', operation: 'edit', profileId: 'amp-1' })
  })

  it('接受合法多页列表并拒绝累计超过 32 项', async () => {
    const gateway = gatewayFixture()
    vi.mocked(gateway.modelProfiles)
      .mockResolvedValueOnce({ items: profilesFixture(0, 16), next_cursor: 'next' })
      .mockResolvedValueOnce({ items: profilesFixture(16, 16) })
    const view = renderHook(() => useAgentSetupController(gateway))
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    expect(view.result.current.profiles).toHaveLength(32)

    vi.mocked(gateway.modelProfiles)
      .mockReset()
      .mockResolvedValueOnce({ items: profilesFixture(0, 32), next_cursor: 'overflow' })
      .mockResolvedValueOnce({ items: [{ ...profileFixture(), id: 'amp-overflow' }] })
    await act(async () => { await view.result.current.load() })
    expect(view.result.current.error?.message).toContain('pagination')
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

  it('gateway 切换后旧 mutation 不覆盖新快照', async () => {
    const oldGateway = gatewayFixture()
    const nextGateway = gatewayFixture()
    const pending = deferred<AgentSettings>()
    let receivedSignal: AbortSignal | undefined
    vi.mocked(oldGateway.updateSettings).mockImplementation((_input, signal) => {
      receivedSignal = signal
      return pending.promise
    })
    vi.mocked(nextGateway.readiness).mockResolvedValue(readinessFixture(7, 'amp-next', 'high'))
    const view = renderHook(
      ({ gateway }) => useAgentSetupController(gateway),
      { initialProps: { gateway: oldGateway } },
    )
    await waitFor(() => expect(view.result.current.loading).toBe(false))

    const mutation = view.result.current.updateSettings('', 'off')
    await waitFor(() => expect(receivedSignal).toBeDefined())
    view.rerender({ gateway: nextGateway })
    await waitFor(() => expect(view.result.current.readiness?.settings.revision).toBe(7))
    expect(receivedSignal?.aborted).toBe(true)
    pending.resolve(readinessFixture(99).settings)
    await expect(mutation).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
    expect(view.result.current.readiness?.settings.revision).toBe(7)
  })
})

function gatewayFixture(): AgentSetupGateway {
  return {
    settings: vi.fn(async () => readinessFixture().settings),
    updateSettings: vi.fn(async () => readinessFixture().settings),
    readiness: vi.fn(async () => readinessFixture()),
    setup: vi.fn(async () => readinessFixture()),
    updateMcpPolicy: vi.fn(async () => readinessFixture().mcp_policy!),
    modelProfiles: vi.fn(async () => ({ items: [] })),
    createModelProfile: vi.fn(async (input) => ({ ...profileFixture(), ...input })),
    updateModelProfile: vi.fn(async (_id, input) => ({ ...profileFixture(input.expected_revision + 1), ...input })),
    deleteModelProfile: vi.fn(async () => undefined),
    testModelProfile: vi.fn(async () => ({ status: 'ready' as const, latency_ms: 20, model_id: 'gpt-test', message: '' })),
    replaceModelApiKey: vi.fn(async () => profileFixture(2, true)),
    deleteModelApiKey: vi.fn(async () => profileFixture(2, false)),
  }
}

function readinessFixture(revision = 1, defaultModelProfileId = '', reasoning: 'off' | 'high' = 'off'): AgentReadiness {
  return {
    status: defaultModelProfileId ? 'ready' : 'needs_setup',
    mcp_runtime: { status: 'ready', message: '' },
    mcp_client: { status: 'ready', message: '' },
    skills_bundle: { status: 'ready', message: '' },
    default_model: { status: defaultModelProfileId ? 'ready' : 'missing', message: '' },
    mcp_policy: { client_id: 'client-1', approval_bypass: false, scope_count: 29, required_scope_count: 29, scope_sync_required: false, revision: 1 },
    settings: {
      ...(defaultModelProfileId ? { default_model_profile_id: defaultModelProfileId } : {}),
      default_reasoning_level: reasoning, revision,
      created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
    },
  }
}

function profileFixture(revision = 1, apiKeyConfigured = false) {
  return {
    id: 'amp-1', name: 'Model', api_mode: 'responses' as const, base_url: 'https://example.test/v1', model_id: 'gpt-test',
    context_window_tokens: 8192, max_output_tokens: 1024, supports_images: false, supports_reasoning: true,
    api_key_configured: apiKeyConfigured, revision,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
  }
}

function profilesFixture(offset: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({ ...profileFixture(), id: `amp-${offset + index}` }))
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

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentReadiness } from '#entities/agent'
import { useAgentSetupState } from './useAgentSetupState.ts'

const bridge = vi.hoisted(() => ({ prepare: vi.fn(), releasePreparation: vi.fn() }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ agentIntegrations: bridge }) }))

type Context = Parameters<typeof useAgentSetupState>[0]

function fixture(initial: Partial<Context> = {}) {
  const ready = { status: 'ready' as const, message: '' }
  const readiness: AgentReadiness = {
    status: 'ready', mcp_runtime: ready, mcp_client: ready, skills_bundle: ready, default_model: ready,
    mcp_policy: { client_id: 'client', approval_bypass: false, scope_count: 0, required_scope_count: 0, scope_sync_required: false, revision: 1 },
    settings: {
      default_model_id: '', default_reasoning_level: 'off', global_context_window_tokens: 16_384,
      global_max_output_tokens: 4096, max_concurrent_runs: 4, context_compaction_threshold_percent: 80,
      show_turn_token_usage: true, connect_ssh_profile_on_bind: false, revision: 1,
    },
  }
  const controller = {
    subscribe: () => () => undefined,
    getSnapshot: () => ({ selected_session_id: 'session-one' }),
    reloadContext: vi.fn().mockResolvedValue(undefined), reloadUsage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context['controller']
  const options: Context = {
    controller, enabled: true, active: true, remote: false, guided: false,
    setupGateway: {
      readiness: vi.fn().mockResolvedValue(readiness),
      modelProviders: vi.fn().mockResolvedValue({ items: [] }), models: vi.fn().mockResolvedValue({ items: [] }),
    },
    notificationRef: { current: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } },
    tRef: { current: vi.fn(key => key) as unknown as Context['tRef']['current'] },
    ...initial,
  }
  return { options, ...renderHook(value => useAgentSetupState(value), { initialProps: options }) }
}

beforeEach(() => {
  vi.useFakeTimers()
  bridge.prepare.mockReset().mockResolvedValue(undefined)
  bridge.releasePreparation.mockReset().mockResolvedValue(undefined)
})

afterEach(() => { vi.useRealTimers() })

it('向导离开助手时保留在途准备，结束后按当前页面释放所有权', async () => {
  let finish!: () => void
  bridge.prepare.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
  const view = fixture()
  expect(bridge.prepare).toHaveBeenCalledExactlyOnceWith('session-one')
  view.rerender({ ...view.options, guided: true })
  view.rerender({ ...view.options, guided: true, active: false })
  expect(bridge.releasePreparation).not.toHaveBeenCalled()
  await act(async () => { finish(); await vi.advanceTimersByTimeAsync(30_000) })
  expect(bridge.prepare).toHaveBeenCalledOnce()
  view.rerender({ ...view.options, active: false })
  expect(bridge.releasePreparation).toHaveBeenCalledExactlyOnceWith('session-one')
})

it('首次在向导中进入或离开助手不启动准备，正常进入后恢复原离页清理', async () => {
  const view = fixture({ active: false, guided: true })
  view.rerender({ ...view.options, active: true })
  view.rerender({ ...view.options, active: false })
  await act(async () => vi.advanceTimersByTimeAsync(30_000))
  expect(bridge.prepare).not.toHaveBeenCalled()
  expect(bridge.releasePreparation).not.toHaveBeenCalled()
  view.rerender({ ...view.options, active: true, guided: false })
  await act(async () => undefined)
  expect(bridge.prepare).toHaveBeenCalledExactlyOnceWith('session-one')
  view.rerender({ ...view.options, active: false, guided: false })
  expect(bridge.releasePreparation).toHaveBeenCalledExactlyOnceWith('session-one')
})

it('Core 未就绪和宿主卸载仍立即释放已有所有权', async () => {
  const view = fixture()
  await act(async () => undefined)
  view.rerender({ ...view.options, active: false, guided: true })
  expect(bridge.releasePreparation).not.toHaveBeenCalled()
  view.rerender({ ...view.options, active: false, guided: true, enabled: false })
  expect(bridge.releasePreparation).toHaveBeenCalledExactlyOnceWith('session-one')
  view.rerender({ ...view.options, guided: false })
  await act(async () => undefined)
  view.unmount()
  expect(bridge.releasePreparation).toHaveBeenCalledTimes(2)
})

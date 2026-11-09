import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentWorkspaceController } from '#features/agent-runtime'
import { useIntegrationPreparation } from './useIntegrationPreparation.ts'

const bridge = vi.hoisted(() => ({ prepare: vi.fn(), releasePreparation: vi.fn() }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ agentIntegrations: bridge }) }))

function fixture() {
  let session = 'session-one'
  const listeners = new Set<() => void>()
  const controller = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot: () => ({ selected_session_id: session }),
  } as unknown as AgentWorkspaceController
  const report = vi.fn()
  const view = renderHook(({ paused, enabled }) => useIntegrationPreparation(controller, enabled, report, paused), {
    initialProps: { paused: true, enabled: true },
  })
  return { ...view, report, select: (id: string) => act(() => { session = id; listeners.forEach(listener => listener()) }) }
}

beforeEach(() => {
  vi.useFakeTimers()
  bridge.prepare.mockReset().mockResolvedValue(undefined)
  bridge.releasePreparation.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { vi.useRealTimers() })

it('首步准备前不启动 MCP，退出向导后合并为一次准备', async () => {
  const view = fixture()
  await act(async () => vi.advanceTimersByTimeAsync(30_000))
  expect(bridge.prepare).not.toHaveBeenCalled()
  expect(bridge.releasePreparation).not.toHaveBeenCalled()
  view.rerender({ paused: false, enabled: true })
  await act(async () => undefined)
  expect(bridge.prepare).toHaveBeenCalledExactlyOnceWith('session-one')
  view.rerender({ paused: true, enabled: true })
  await act(async () => vi.advanceTimersByTimeAsync(30_000))
  expect(bridge.prepare).toHaveBeenCalledOnce()
  expect(bridge.releasePreparation).not.toHaveBeenCalled()
  view.rerender({ paused: false, enabled: true })
  await act(async () => undefined)
  expect(bridge.prepare).toHaveBeenCalledTimes(2)
  view.unmount()
  expect(bridge.releasePreparation).toHaveBeenCalledExactlyOnceWith('session-one')
})

it('在途准备继续收尾，暂停期间不释放所有权、不循环准备', async () => {
  let finish!: () => void
  bridge.prepare.mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
  const view = fixture()
  view.rerender({ paused: false, enabled: true })
  view.rerender({ paused: true, enabled: true })
  await act(async () => { finish(); await vi.advanceTimersByTimeAsync(30_000) })
  expect(bridge.prepare).toHaveBeenCalledOnce()
  expect(bridge.releasePreparation).not.toHaveBeenCalled()
  view.rerender({ paused: false, enabled: true })
  await act(async () => undefined)
  expect(bridge.prepare).toHaveBeenCalledTimes(2)
})

it('暂停中切换会话只释放原所有权，新会话在退出后准备；Core 未就绪后不迟到重启', async () => {
  const view = fixture()
  view.rerender({ paused: false, enabled: true })
  await act(async () => undefined)
  view.rerender({ paused: true, enabled: true })
  view.select('session-two')
  expect(bridge.releasePreparation).toHaveBeenCalledExactlyOnceWith('session-one')
  expect(bridge.prepare).toHaveBeenCalledOnce()
  view.rerender({ paused: false, enabled: true })
  await act(async () => undefined)
  expect(bridge.prepare).toHaveBeenLastCalledWith('session-two')
  view.rerender({ paused: false, enabled: false })
  await act(async () => vi.advanceTimersByTimeAsync(30_000))
  expect(bridge.prepare).toHaveBeenCalledTimes(2)
  expect(bridge.releasePreparation).toHaveBeenLastCalledWith('session-two')
})

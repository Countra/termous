import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useAgentSyncWarning } from './useAgentSyncWarning'

afterEach(() => vi.useRealTimers())

test('短暂的同步失败不闪出警告，持续失败及恢复如实显示', () => {
  vi.useFakeTimers()
  const view = renderHook(({ issue, deferred }) => useAgentSyncWarning(issue, deferred), { initialProps: { issue: undefined as string | undefined, deferred: true } })
  view.rerender({ issue: 'remote_recovering', deferred: true })
  act(() => vi.advanceTimersByTime(1000))
  expect(view.result.current).toBe(false)
  view.rerender({ issue: undefined, deferred: true })
  act(() => vi.advanceTimersByTime(2000))
  expect(view.result.current).toBe(false)
  view.rerender({ issue: 'remote_recovering', deferred: true })
  act(() => vi.advanceTimersByTime(2000))
  expect(view.result.current).toBe(true)
  view.rerender({ issue: undefined, deferred: true })
  expect(view.result.current).toBe(false)
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

test('本机行为和确定性拒绝保留即时提示', () => {
  const view = renderHook(() => useAgentSyncWarning('remote_agent_disabled', false))
  expect(view.result.current).toBe(true)
})

test('持续故障切换错误码不会重置宽限期或再次隐藏提示', () => {
  vi.useFakeTimers()
  const view = renderHook(({ issue }) => useAgentSyncWarning(issue, true), { initialProps: { issue: 'remote_recovering' } })
  act(() => vi.advanceTimersByTime(1500))
  view.rerender({ issue: 'remote_request_timeout' })
  act(() => vi.advanceTimersByTime(500))
  expect(view.result.current).toBe(true)
  view.rerender({ issue: 'remote_capacity_exceeded' })
  expect(view.result.current).toBe(true)
})

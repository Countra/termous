import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useVisibleQuery } from './useVisibleQuery'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

test('可见任务在读取暂时失败后继续轮询，隐藏停止并在恢复时补读', async () => {
  vi.useFakeTimers()
  let visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
  const load = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ state: 'running' })
  const view = renderHook(() => useVisibleQuery('task', load, true, () => true))
  await act(async () => { await Promise.resolve() })
  expect(view.result.current.error).toBeInstanceOf(Error)
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(load).toHaveBeenCalledTimes(2)
  expect(view.result.current.data).toEqual({ state: 'running' })
  expect(view.result.current.error).toBeUndefined()
  act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(load).toHaveBeenCalledTimes(2)
  await act(async () => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) })
  expect(load).toHaveBeenCalledTimes(3)
  view.unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(load).toHaveBeenCalledTimes(3)
})

test('隐藏或停用会取消在途读取并结束加载标记，迟到数据不发布', async () => {
  let visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
  let finish!: (value: string) => void
  const load = vi.fn<(signal: AbortSignal) => Promise<string>>(() => new Promise(resolve => { finish = resolve }))
  const view = renderHook(({ active }) => useVisibleQuery('task', load, active), { initialProps: { active: true } })
  expect(view.result.current.loading).toBe(true)
  act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) })
  expect(load.mock.calls[0][0].aborted).toBe(true)
  expect(view.result.current.loading).toBe(false)
  await act(async () => finish('late'))
  expect(view.result.current.data).toBeUndefined()
  act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) })
  expect(view.result.current.loading).toBe(true)
  view.rerender({ active: false })
  expect(view.result.current.loading).toBe(false)
  expect(load.mock.calls[1][0].aborted).toBe(true)
})

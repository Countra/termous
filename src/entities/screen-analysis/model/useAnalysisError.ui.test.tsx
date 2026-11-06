import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useAnalysisError } from './useAnalysisError'
import { useVisibleQuery } from './useVisibleQuery'

it('连续失败不重复提示，恢复后可再次提示，重试使用最新回调且卸载后失效', () => {
  const report = vi.fn()
  const first = vi.fn(); const next = vi.fn()
  const initialProps: { error?: Error; retry: () => void } = { error: new Error('network unavailable'), retry: first }
  const view = renderHook(({ error, retry }: { error?: Error; retry: () => void }) => useAnalysisError(error, report, retry), {
    initialProps,
  })
  expect(report).toHaveBeenCalledOnce()
  const retry = report.mock.calls[0][1] as () => void
  view.rerender({ error: new Error('network unavailable'), retry: next })
  expect(report).toHaveBeenCalledOnce()
  retry()
  expect(next).toHaveBeenCalledOnce()
  expect(first).not.toHaveBeenCalled()
  view.rerender({ error: undefined, retry: next })
  retry()
  expect(next).toHaveBeenCalledOnce()
  view.rerender({ error: new Error('network unavailable'), retry: next })
  expect(report).toHaveBeenCalledTimes(2)
  retry()
  expect(next).toHaveBeenCalledOnce()
  const currentRetry = report.mock.calls[1][1] as () => void
  currentRetry()
  expect(next).toHaveBeenCalledTimes(2)
  view.unmount()
  retry(); currentRetry()
  expect(next).toHaveBeenCalledTimes(2)
})

it('显式重试后同一错误再次返回时重新提示', async () => {
  const error = new Error('unavailable')
  const load = vi.fn().mockRejectedValue(error)
  const report = vi.fn()
  renderHook(() => {
    const query = useVisibleQuery('record', load)
    useAnalysisError(query.error, report, query.reload)
  })
  await waitFor(() => expect(report).toHaveBeenCalledOnce())
  act(() => report.mock.calls[0][1]())
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(report).toHaveBeenCalledTimes(2))
})

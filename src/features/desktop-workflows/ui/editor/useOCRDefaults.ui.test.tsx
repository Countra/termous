import { act, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { OCRParameters } from '#entities/desktop-workflow'
import { useOCRDefaults } from './useOCRDefaults'

function deferred() {
  let resolve!: (value: OCRParameters) => void
  let reject!: (error: Error) => void
  const promise = new Promise<OCRParameters>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const defaults = { text_confidence: .5, ocr_max_side: 1600 }

it('连续聚焦只接受最新默认值，忽略旧请求的迟到成功和失败', async () => {
  const first = deferred(), second = deferred(), latest = deferred()
  const gateway = { ocrDefaults: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(latest.promise) }
  const { result, unmount } = renderHook(() => useOCRDefaults(gateway))
  fireEvent.focus(window)
  fireEvent.focus(window)
  expect(gateway.ocrDefaults).toHaveBeenCalledTimes(3)
  expect((gateway.ocrDefaults.mock.calls[0]![0] as AbortSignal).aborted).toBe(true)
  expect((gateway.ocrDefaults.mock.calls[1]![0] as AbortSignal).aborted).toBe(true)
  await act(async () => latest.resolve(defaults))
  await act(async () => { first.resolve({ ...defaults, text_confidence: .1 }); second.reject(new Error('旧请求失败')) })
  expect(result.current.value).toEqual(defaults)
  expect(result.current.error).toBeUndefined()
  unmount()
  expect((gateway.ocrDefaults.mock.calls[2]![0] as AbortSignal).aborted).toBe(true)
})

it('重试及切换数据来源时不沿用旧默认值，失败可再次读取', async () => {
  const retry = deferred(), switched = deferred()
  const gateway = { ocrDefaults: vi.fn().mockResolvedValueOnce(defaults).mockReturnValueOnce(retry.promise).mockResolvedValueOnce(defaults) }
  const next = { ocrDefaults: vi.fn().mockReturnValueOnce(switched.promise) }
  const { result, rerender } = renderHook(({ source }) => useOCRDefaults(source), { initialProps: { source: gateway } })
  await waitFor(() => expect(result.current.value).toEqual(defaults))
  act(() => result.current.refresh())
  expect(result.current.value).toBeUndefined()
  await act(async () => retry.reject(new Error('读取失败')))
  expect(result.current.error).toBeInstanceOf(Error)
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.value).toEqual(defaults))
  expect(result.current.error).toBeUndefined()
  rerender({ source: next })
  expect(result.current.value).toBeUndefined()
  await act(async () => switched.resolve({ ...defaults, ocr_max_side: 1280 }))
  expect(result.current.value?.ocr_max_side).toBe(1280)
})

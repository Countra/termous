import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useRemoteDesktopFullscreen } from './useRemoteDesktopFullscreen.ts'

const fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'exitFullscreen')
const requestFullscreenDescriptor = Object.getOwnPropertyDescriptor(document.documentElement, 'requestFullscreen')

let fullscreenElement: Element | null = null
let requestFullscreen: ReturnType<typeof vi.fn>
let exitFullscreen: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fullscreenElement = null
  requestFullscreen = vi.fn(async () => {
    fullscreenElement = document.documentElement
    document.dispatchEvent(new Event('fullscreenchange'))
  })
  exitFullscreen = vi.fn(async () => {
    fullscreenElement = null
    document.dispatchEvent(new Event('fullscreenchange'))
  })
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenElement,
  })
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: exitFullscreen,
  })
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: requestFullscreen,
  })
})

afterEach(() => {
  restoreProperty(document, 'fullscreenElement', fullscreenElementDescriptor)
  restoreProperty(document, 'exitFullscreen', exitFullscreenDescriptor)
  restoreProperty(document.documentElement, 'requestFullscreen', requestFullscreenDescriptor)
  vi.useRealTimers()
})

test('让文档根节点进入全屏并在空闲后收起顶部栏', async () => {
  const { result } = renderHook(() => useRemoteDesktopFullscreen())

  await act(async () => result.current.toggleFullscreen())
  expect(requestFullscreen).toHaveBeenCalledTimes(1)
  expect(result.current.isFullscreen).toBe(true)
  expect(result.current.toolbarVisible).toBe(true)

  act(() => vi.advanceTimersByTime(1800))
  expect(result.current.toolbarVisible).toBe(false)

  act(() => result.current.revealToolbar())
  expect(result.current.toolbarVisible).toBe(true)
  act(() => result.current.releaseToolbar())
  act(() => vi.advanceTimersByTime(1800))
  expect(result.current.toolbarVisible).toBe(false)

  await act(async () => result.current.toggleFullscreen())
  expect(exitFullscreen).toHaveBeenCalledTimes(1)
  expect(result.current.isFullscreen).toBe(false)
})

test('钉住后保持顶部栏显示，取消钉住后恢复自动收起', async () => {
  const { result } = renderHook(() => useRemoteDesktopFullscreen())
  await act(async () => result.current.toggleFullscreen())

  act(() => result.current.toggleToolbarPinned())
  expect(result.current.toolbarPinned).toBe(true)
  act(() => vi.advanceTimersByTime(5000))
  expect(result.current.toolbarVisible).toBe(true)

  act(() => result.current.toggleToolbarPinned())
  expect(result.current.toolbarPinned).toBe(false)
  act(() => vi.advanceTimersByTime(1800))
  expect(result.current.toolbarVisible).toBe(false)

  await act(async () => result.current.toggleFullscreen())
})

test('全屏请求失败时不保留本地全屏状态', async () => {
  requestFullscreen.mockRejectedValueOnce(new Error('denied'))
  const { result } = renderHook(() => useRemoteDesktopFullscreen())

  await expect(act(async () => result.current.toggleFullscreen())).rejects.toThrow('denied')
  expect(result.current.isFullscreen).toBe(false)
  expect(result.current.toolbarPinned).toBe(false)
})

test('浏览器通过 Escape 退出全屏时重置顶部栏状态', async () => {
  const { result } = renderHook(() => useRemoteDesktopFullscreen())
  await act(async () => result.current.toggleFullscreen())
  act(() => result.current.toggleToolbarPinned())

  act(() => {
    fullscreenElement = null
    document.dispatchEvent(new Event('fullscreenchange'))
  })

  expect(result.current.isFullscreen).toBe(false)
  expect(result.current.toolbarPinned).toBe(false)
  expect(result.current.toolbarVisible).toBe(true)
})

test('全屏切换未完成时忽略重复请求', async () => {
  let completeRequest = () => undefined
  requestFullscreen.mockImplementationOnce(() => new Promise<void>((resolve) => {
    completeRequest = () => {
      fullscreenElement = document.documentElement
      document.dispatchEvent(new Event('fullscreenchange'))
      resolve()
    }
  }))
  const { result } = renderHook(() => useRemoteDesktopFullscreen())

  const firstRequest = result.current.toggleFullscreen()
  const repeatedRequest = result.current.toggleFullscreen()
  expect(requestFullscreen).toHaveBeenCalledTimes(1)

  await act(async () => {
    completeRequest()
    await Promise.all([firstRequest, repeatedRequest])
  })
  expect(result.current.isFullscreen).toBe(true)
})

function restoreProperty(target: object, key: PropertyKey, descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
  } else {
    Reflect.deleteProperty(target, key)
  }
}

import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { ACCOUNT_WELCOME_KEY, useAccountWelcome } from './useAccountWelcome'

beforeEach(() => { window.localStorage.clear() })

test('首次进入展示登录选择，离线选择保存在本机并在下次启动生效', () => {
  const first = renderHook(() => useAccountWelcome(false))
  expect(first.result.current.pending).toBe(true)
  act(() => first.result.current.complete())
  expect(first.result.current.pending).toBe(false)
  first.unmount()
  const next = renderHook(() => useAccountWelcome(false))
  expect(next.result.current.pending).toBe(false)
  expect(window.localStorage.getItem(ACCOUNT_WELCOME_KEY)).toBe('true')
})

test('已登录会话不重复引导，退出后也不重新弹出首次选择', () => {
  const view = renderHook(({ authenticated }) => useAccountWelcome(authenticated), { initialProps: { authenticated: true } })
  expect(view.result.current.pending).toBe(false)
  view.rerender({ authenticated: false })
  expect(view.result.current.pending).toBe(false)
})

test('偏好存储失败不阻止本次离线使用', () => {
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
  try {
    const view = renderHook(() => useAccountWelcome(false))
    act(() => view.result.current.complete())
    expect(view.result.current.pending).toBe(false)
  } finally { write.mockRestore() }
})

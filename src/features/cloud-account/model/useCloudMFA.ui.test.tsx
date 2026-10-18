import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { CloudMFAStatus, CloudStatus } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { useCloudMFA } from './useCloudMFA'

const account: CloudStatus = { generation: 'fixture', revision: 1, configured: true, authenticated: true, phase: 'ready', device_status: 'active', confirmed: true, auto_sync: false, pending: 0, conflicts: 0 }
const status: CloudMFAStatus = { enabled: false, revision: '0', backup_codes_remaining: 0 }

function gateway(read = vi.fn<(generation: string, signal?: AbortSignal) => Promise<CloudMFAStatus>>(async () => status)) {
  const state = new CloudState()
  state.accept(account)
  const api = { getStatus: state.snapshot, subscribeStatus: state.subscribe, mfaStatus: read } as unknown as CloudGateway
  return { api, state, read }
}

test('开发模式重放挂载只发出一次 MFA 读取，不先发送再取消', async () => {
  const { api, read } = gateway()
  const { result } = renderHook(() => useCloudMFA(api, account.generation), { wrapper: StrictMode })
  await waitFor(() => expect(result.current.value).toEqual(status))
  expect(read).toHaveBeenCalledTimes(1)
  expect(read.mock.calls[0][1]?.aborted).toBe(false)
})

test('立即离开页面时不发送已经失效的 MFA 读取', async () => {
  const { api, read } = gateway()
  const { unmount } = renderHook(() => useCloudMFA(api, account.generation))
  unmount()
  await act(async () => { await Promise.resolve() })
  expect(read).not.toHaveBeenCalled()
})

test('真实的在途读取仍在卸载时取消，不把取消误报成读取失败', async () => {
  let signal: AbortSignal | undefined
  const read = vi.fn((_generation: string, nextSignal?: AbortSignal) => new Promise<CloudMFAStatus>((_resolve, reject) => {
    signal = nextSignal
    signal?.addEventListener('abort', () => reject(new DOMException('页面已离开', 'AbortError')), { once: true })
  }))
  const { api } = gateway(read)
  const { result, unmount } = renderHook(() => useCloudMFA(api, account.generation))
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  expect(signal?.aborted).toBe(false)
  unmount()
  await act(async () => { await Promise.resolve() })
  expect(signal?.aborted).toBe(true)
  expect(result.current.error).toBe(false)
})

test('切换账号代次后取消旧读取，旧返回不能覆盖新账号状态', async () => {
  let completeOld!: (value: CloudMFAStatus) => void
  const read = vi.fn<(generation: string, signal?: AbortSignal) => Promise<CloudMFAStatus>>(async () => status)
  read.mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve }))
  const { api, state } = gateway(read)
  const { result, rerender } = renderHook(({ generation }) => useCloudMFA(api, generation), { initialProps: { generation: account.generation } })
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  const oldSignal = read.mock.calls[0][1]
  state.accept({ ...account, revision: 2, generation: 'next-account' })
  rerender({ generation: 'next-account' })
  await waitFor(() => expect(result.current.value).toEqual(status))
  expect(oldSignal?.aborted).toBe(true)
  await act(async () => { completeOld({ enabled: true, revision: '8', backup_codes_remaining: 10, enabled_at: new Date().toISOString() }) })
  expect(result.current.value).toEqual(status)
  expect(read).toHaveBeenCalledTimes(2)
})

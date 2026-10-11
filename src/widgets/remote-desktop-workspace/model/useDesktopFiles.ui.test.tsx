import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import { desktopFileError, useDesktopFiles } from './useDesktopFiles.ts'

test.each([
  ['rdp_file_clipboard_empty', 'desktop_file_clipboard_empty'],
  ['rdp_clipboard_stale', 'desktop_files_stale'],
  ['rdp_clipboard_busy', 'desktop_busy'],
  ['rdp_clipboard_desynchronized', 'desktop_file_clipboard_desynchronized'],
  ['rdp_file_clipboard_failed', 'desktop_file_clipboard_failed'],
  ['未识别的内部错误', 'desktop_files_storage_failed'],
])('文件操作错误 %s 使用明确的用户提示', (code, expected) => {
  expect(desktopFileError(new Error(code))).toBe(expected)
})

test('操作期间连接换代，旧操作结束后恢复按钮且不回写旧错误和状态', async () => {
  const describe = vi.fn<DesktopFilesGateway['describe']>().mockResolvedValue({
    capabilities: { directory_mapping: true, exchange: true, file_clipboard: true }, mappings: [], exchanges: [],
  })
  const api = { describe, retained: vi.fn().mockResolvedValue([]), tasks: vi.fn().mockResolvedValue([]) } as unknown as DesktopFilesGateway
  const { result, rerender } = renderHook(({ generation }) => useDesktopFiles(api, 'session', generation), { initialProps: { generation: 1 } })
  await waitFor(() => expect(result.current.state).toBeDefined())
  let fail!: (error: Error) => void
  const action = new Promise<unknown>((_, reject) => { fail = reject })
  let running!: Promise<boolean>
  act(() => { running = result.current.run(() => action) })
  expect(result.current.busy).toBe(true)
  rerender({ generation: 2 })
  await waitFor(() => expect(describe).toHaveBeenCalledWith('session', 2, expect.any(AbortSignal)))
  await act(async () => { fail(new Error('旧代次操作失败')); await running })
  expect(result.current.busy).toBe(false)
  expect(result.current.error).toBe('')
  let accepted = false
  await act(async () => { accepted = await result.current.run(async () => undefined) })
  expect(accepted).toBe(true)
  expect(describe).toHaveBeenLastCalledWith('session', 2, expect.any(AbortSignal))
})

test('手动刷新与轮询重叠时，迟到的旧快照和旧错误不覆盖新结果', async () => {
  const current = { capabilities: { directory_mapping: true, exchange: true, file_clipboard: true }, mappings: [], exchanges: [] }
  let rejectOld!: (error: Error) => void
  const describe = vi.fn<DesktopFilesGateway['describe']>()
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject }))
    .mockResolvedValue(current)
  const api = { describe, retained: vi.fn().mockResolvedValue([]), tasks: vi.fn().mockResolvedValue([]) } as unknown as DesktopFilesGateway
  const { result } = renderHook(() => useDesktopFiles(api, 'session', 1))
  await act(async () => { await result.current.refresh() })
  await act(async () => { rejectOld(new Error('旧轮询失败')) })
  expect(result.current.state).toEqual(current)
  expect(result.current.error).toBe('')
})

test('未显式传入 signal 的刷新绑定当前会话，换代后拒绝旧结果', async () => {
  const initial = { capabilities: { directory_mapping: false, exchange: false, file_clipboard: false }, mappings: [], exchanges: [] }
  const current = { ...initial, capabilities: { directory_mapping: true, exchange: true, file_clipboard: true } }
  let resolveOld!: (value: typeof initial) => void
  const describe = vi.fn<DesktopFilesGateway['describe']>().mockResolvedValue(initial)
  const api = { describe, retained: vi.fn().mockResolvedValue([]), tasks: vi.fn().mockResolvedValue([]) } as unknown as DesktopFilesGateway
  const { result, rerender } = renderHook(({ generation }) => useDesktopFiles(api, 'session', generation), { initialProps: { generation: 1 } })
  await waitFor(() => expect(result.current.state).toEqual(initial))
  describe.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValue(current)
  let refresh!: Promise<void>
  act(() => { refresh = result.current.refresh() })
  const signal = describe.mock.calls[describe.mock.calls.length - 1]![2]
  rerender({ generation: 2 })
  await waitFor(() => expect(result.current.state).toEqual(current))
  await act(async () => { resolveOld(initial); await refresh })
  expect(signal?.aborted).toBe(true)
  expect(result.current.state).toEqual(current)
})

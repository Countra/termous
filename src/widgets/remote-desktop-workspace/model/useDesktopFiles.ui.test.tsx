import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { TransferTask } from '#entities/file'
import { TransferRuntimeContext, type TransferRuntimeValue } from '#features/transfers'
import type { DesktopFilesGateway } from '#features/remote-desktop'
import { desktopFileError, useDesktopFiles } from './useDesktopFiles.ts'

test('侧栏复用全局实时任务，隐藏时仍接收更新，断流才补查快照', async () => {
  const api = { describe: vi.fn().mockResolvedValue({ capabilities: {}, mappings: [], exchanges: [] }),
    retained: vi.fn().mockResolvedValue([]), tasks: vi.fn() } as unknown as DesktopFilesGateway
  const refresh = vi.fn(async () => {})
  const first = { id: 'one', desktop_session_id: 'session', status: 'running', transferred_bytes: 10 } as TransferTask
  let source: TransferRuntimeValue = { transfers: [first, { ...first, id: 'other', desktop_session_id: 'other' }], connected: true, refresh,
    activeTransfers: [first], initialized: true, remoteCopyRefreshVersion: 0, upsertTransfer: vi.fn(), removeTransfer: vi.fn(), consumeRemoteCopyRefreshEvents: () => [] }
  const wrapper = ({ children }: { children: ReactNode }) => <TransferRuntimeContext.Provider value={source}>{children}</TransferRuntimeContext.Provider>
  const { result, rerender } = renderHook(({ enabled }) => useDesktopFiles(api, 'session', 1, enabled), { wrapper, initialProps: { enabled: true } })
  await waitFor(() => expect(result.current.state).toBeDefined())
  expect(result.current.tasks).toEqual([first])
  expect(api.tasks).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
  const signal = vi.mocked(api.describe).mock.calls[0]![2]!
  source = { ...source, transfers: [{ ...first, transferred_bytes: 60 }] }
  rerender({ enabled: true })
  expect(result.current.tasks[0]?.transferred_bytes).toBe(60)
  expect(signal.aborted).toBe(false)
  expect(api.describe).toHaveBeenCalledTimes(1)
  rerender({ enabled: false })
  source = { ...source, transfers: [{ ...first, status: 'completed' }] }
  rerender({ enabled: false })
  expect(result.current.tasks[0]?.status).toBe('completed')
  source = { ...source, connected: false }
  rerender({ enabled: true })
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(result.current.liveConnected).toBe(false)
  expect(api.tasks).not.toHaveBeenCalled()
  await act(async () => { await result.current.refresh() })
  expect(refresh).toHaveBeenCalledTimes(2)
  refresh.mockRejectedValueOnce(new Error('刷新失败'))
  await act(async () => { expect(await result.current.run(async () => {})).toBe(false) })
  expect(result.current.error).toBe('desktop_files_storage_failed')
  let fail!: (error: Error) => void
  let pending!: Promise<boolean>
  act(() => { pending = result.current.run(() => new Promise((_, reject) => { fail = reject })) })
  const calls = vi.mocked(api.describe).mock.calls
  const activeSignal = calls[calls.length - 1]![2]!
  source = { ...source, connected: true }
  rerender({ enabled: true })
  expect(activeSignal.aborted).toBe(false)
  await act(async () => { fail(new Error('rdp_clipboard_busy')); await pending })
  expect(result.current.error).toBe('desktop_busy')
})

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

test('侧栏隐藏期间操作完成后释放忙碌状态，再次打开仍能执行新操作', async () => {
  const describe = vi.fn<DesktopFilesGateway['describe']>().mockResolvedValue({
    capabilities: { directory_mapping: true, exchange: true, file_clipboard: true }, mappings: [], exchanges: [],
  })
  const api = { describe, retained: vi.fn().mockResolvedValue([]), tasks: vi.fn().mockResolvedValue([]) } as unknown as DesktopFilesGateway
  const { result, rerender } = renderHook(({ enabled }) => useDesktopFiles(api, 'session', 1, enabled), { initialProps: { enabled: true } })
  await waitFor(() => expect(result.current.state).toBeDefined())
  let finish!: () => void
  const action = new Promise<void>(resolve => { finish = resolve })
  let pending!: Promise<boolean>
  act(() => { pending = result.current.run(() => action) })
  expect(result.current.busy).toBe(true)
  rerender({ enabled: false })
  expect(describe.mock.calls[0]![2]!.aborted).toBe(true)
  await act(async () => { finish(); await pending })
  expect(result.current.busy).toBe(false)
  rerender({ enabled: true })
  await waitFor(() => expect(describe).toHaveBeenCalledTimes(2))
  let accepted = false
  await act(async () => { accepted = await result.current.run(async () => undefined) })
  expect(accepted).toBe(true)
  expect(result.current.busy).toBe(false)
})

test('文件选择将授权元数据交给调用方，操作失败仍释放授权并保留原错误', async () => {
  const picker = vi.fn().mockResolvedValue(['C:/fixture/资料.txt'])
  vi.stubGlobal('termous', { files: { pickPaths: picker } })
  const grant = { id: 'selected-grant', source: 'picker' as const, items: [{ id: 'file', name: '资料.txt', kind: 'file' as const, size: 2048 }], created_at: '', expires_at: '' }
  const api = { describe: vi.fn().mockResolvedValue({}), retained: vi.fn().mockResolvedValue([]), tasks: vi.fn().mockResolvedValue([]),
    grant: vi.fn().mockResolvedValue(grant), releaseGrant: vi.fn().mockResolvedValue(undefined) } as unknown as DesktopFilesGateway
  const view = renderHook(() => useDesktopFiles(api, 'session', 1))
  try {
    await waitFor(() => expect(view.result.current.state).toBeDefined())
    const action = vi.fn().mockRejectedValue(new Error('传输准备失败'))
    await expect(view.result.current.withGrant('files', true, action)).rejects.toThrow('传输准备失败')
    expect(picker).toHaveBeenCalledWith({ mode: 'files', multiple: true })
    expect(action).toHaveBeenCalledWith(grant.id, grant.items)
    expect(api.releaseGrant).toHaveBeenCalledWith(grant.id)
  } finally { view.unmount(); vi.unstubAllGlobals() }
})

test('授权申请期间连接换代，迟到的授权仍释放且不执行旧会话操作', async () => {
  vi.stubGlobal('termous', { files: { pickPaths: vi.fn().mockResolvedValue(['C:/fixture/资料']) } })
  let finish!: (value: Awaited<ReturnType<DesktopFilesGateway['grant']>>) => void
  const api = { describe: vi.fn().mockResolvedValue({}), retained: vi.fn().mockResolvedValue([]), tasks: vi.fn().mockResolvedValue([]),
    grant: vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve })), releaseGrant: vi.fn().mockResolvedValue(undefined) } as unknown as DesktopFilesGateway
  const view = renderHook(({ generation }) => useDesktopFiles(api, 'session', generation), { initialProps: { generation: 1 } })
  try {
    await waitFor(() => expect(view.result.current.state).toBeDefined())
    const action = vi.fn()
    const pending = view.result.current.withGrant('directories', false, action)
    await waitFor(() => expect(finish).toBeDefined())
    view.rerender({ generation: 2 })
    finish({ id: 'late-grant', source: 'picker', items: [], created_at: '', expires_at: '' })
    await pending
    expect(action).not.toHaveBeenCalled()
    expect(api.releaseGrant).toHaveBeenCalledWith('late-grant')
  } finally { view.unmount(); vi.unstubAllGlobals() }
})

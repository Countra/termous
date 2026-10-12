import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileSystemClipboardBridge, FileSystemClipboardState } from '#common/contracts'
import { useFileSystemClipboard } from './useFileSystemClipboard'

const fixture = vi.hoisted(() => ({ bridge: undefined as FileSystemClipboardBridge | undefined }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ fileSystemClipboard: fixture.bridge }) }))
afterEach(() => { fixture.bridge = undefined })

describe('文件系统复制共享状态', () => {
  it('发布成功才清除应用内记录；重复快捷键与迟到查询不能覆盖新操作', async () => {
    const idle: FileSystemClipboardState = { supported: true, phase: 'idle', names: [], count: 0, total_bytes: 0 }
    let current = idle
    let resolveCopy!: (result: Awaited<ReturnType<FileSystemClipboardBridge['copy']>>) => void
    const copy = vi.fn(() => new Promise<Awaited<ReturnType<FileSystemClipboardBridge['copy']>>>(resolve => { resolveCopy = resolve }))
    const status = vi.fn(async () => ({ ok: true as const, value: current }))
    fixture.bridge = { importClipboard: vi.fn(), status, copy, revoke: vi.fn(async () => ({ ok: true as const, value: undefined })) }
    const clear = vi.fn()
    const view = renderHook(() => useFileSystemClipboard(clear))
    await waitFor(() => expect(view.result.current.available).toBe(true))
    let resolveStatus!: (result: { ok: true; value: FileSystemClipboardState }) => void
    status.mockImplementationOnce(() => new Promise(resolve => { resolveStatus = resolve }))
    await waitFor(() => expect(resolveStatus).toBeTypeOf('function'), { timeout: 2000 })
    const session = { id: 'session', connection_generation: 1 }
    let pending!: Promise<void>
    act(() => { pending = view.result.current.copy(session, ['/报告']) })
    await act(async () => { await view.result.current.copy(session, ['/报告']) })
    expect(copy).toHaveBeenCalledTimes(1)
    expect(clear).not.toHaveBeenCalled()
    current = { ...idle, phase: 'ready', published: true, publication_id: 'pub', names: ['报告'], count: 1 }
    await act(async () => { resolveCopy({ ok: true as const, value: current }); await pending })
    expect(clear).toHaveBeenCalledTimes(1)
    await act(async () => { resolveStatus({ ok: true, value: idle }) })
    expect(view.result.current.state.publication_id).toBe('pub')
    act(() => { pending = view.result.current.copy(session, ['/失败']) })
    await act(async () => { resolveCopy({ ok: false, code: 'FILE_CLIPBOARD_FAILED', uncertain: false }); await pending })
    expect(clear).toHaveBeenCalledTimes(1)
    expect(view.result.current.state.error_code).toBe('FILE_CLIPBOARD_FAILED')
    view.unmount()
    expect(fixture.bridge?.revoke).not.toHaveBeenCalled()
  })

  it('取消有等待状态和重复保护，失败可以重试，成功不等待下一次轮询', async () => {
    const ready: FileSystemClipboardState = { supported: true, phase: 'ready', published: true, publication_id: 'cancel-target', names: ['报告'], count: 1, total_bytes: 17 }
    let finish!: (value: Awaited<ReturnType<FileSystemClipboardBridge['revoke']>>) => void
    const revoke = vi.fn(() => new Promise<Awaited<ReturnType<FileSystemClipboardBridge['revoke']>>>(resolve => { finish = resolve }))
    fixture.bridge = { importClipboard: vi.fn(),
      status: vi.fn(async () => ({ ok: true as const, value: ready })),
      copy: vi.fn(), revoke,
    }
    const view = renderHook(() => useFileSystemClipboard())
    await waitFor(() => expect(view.result.current.state.publication_id).toBe('cancel-target'))
    let pending!: Promise<void>
    act(() => { pending = view.result.current.revoke('cancel-target') })
    expect(view.result.current.cancelling).toBe(true)
    await act(async () => { await view.result.current.revoke('cancel-target') })
    expect(revoke).toHaveBeenCalledOnce()
    await act(async () => {
      finish({ ok: false, code: 'FILE_CLIPBOARD_CANCEL_FAILED', uncertain: false })
      await pending
    })
    expect(view.result.current.cancelling).toBe(false)
    expect(view.result.current.state.phase).toBe('cleanup_pending')
    act(() => { pending = view.result.current.revoke('cancel-target') })
    await act(async () => { finish({ ok: true, value: undefined }); await pending })
    expect(view.result.current.state.phase).toBe('stopped')
    expect(view.result.current.state.error_code).toBeUndefined()
    await act(async () => { await view.result.current.revoke('cancel-target') })
    await act(async () => { await view.result.current.revoke('old-target') })
    expect(revoke).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('创建回执丢失后通过相同操作标识恢复状态，不重放复制', async () => {
    const idle: FileSystemClipboardState = { supported: true, phase: 'idle', names: [], count: 0, total_bytes: 0 }
    let current = idle
    fixture.bridge = {
      importClipboard: vi.fn(), revoke: vi.fn(),
      status: vi.fn(async () => ({ ok: true as const, value: current })),
      copy: vi.fn(async request => {
        current = { ...idle, phase: 'ready', published: true, operation_id: request.operation_id, publication_id: 'accepted', names: ['文件'], count: 1 }
        return { ok: false as const, code: 'REMOTE_REQUEST_FAILED', uncertain: true }
      }),
    }
    const view = renderHook(() => useFileSystemClipboard())
    await waitFor(() => expect(view.result.current.state.phase).toBe('idle'))
    await act(async () => { await view.result.current.copy({ id: 'session', connection_generation: 1 }, ['/文件']) })
    expect(view.result.current.state.phase).toBe('failed')
    await waitFor(() => expect(view.result.current.state.phase).toBe('ready'), { timeout: 2000 })
    expect(view.result.current.state.error_code).toBeUndefined()
    expect(fixture.bridge.copy).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentAttachment } from '#entities/agent'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import { useAgentDraftAttachments } from './useAgentDraftAttachments.ts'

describe('useAgentDraftAttachments', () => {
  const ensureSession = vi.fn(async () => 'session-one')
  const onError = vi.fn()

  beforeEach(() => {
    ensureSession.mockClear()
    onError.mockClear()
  })

  it('在创建会话前完成本地校验', async () => {
    const gateway = attachmentGateway()
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))

    await act(async () => {
      await view.result.current.add([new File([new Uint8Array([0x61, 0, 0x62])], 'invalid.txt')])
    })

    expect(ensureSession).not.toHaveBeenCalled()
    expect(gateway.uploadAttachment).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('AGENT_ATTACHMENT_TEXT_ENCODING')
  })

  it('移除上传中附件时立即取消请求并清理草稿', async () => {
    let uploadSignal: AbortSignal | undefined
    const gateway = attachmentGateway({
      uploadAttachment: vi.fn((_sessionId, _file, signal) => new Promise<AgentAttachment>((_resolve, reject) => {
        uploadSignal = signal
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })),
    })
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    let adding!: Promise<void>
    act(() => { adding = view.result.current.add([textFile()]) })
    await waitFor(() => expect(view.result.current.records['session-one']).toHaveLength(1))

    await act(async () => {
      await view.result.current.remove(view.result.current.records['session-one']![0]!.client_id)
      await adding
    })

    expect(uploadSignal?.aborted).toBe(true)
    expect(view.result.current.records['session-one']).toBeUndefined()
  })

  it('删除失败时保留已上传附件，允许用户再次操作', async () => {
    const gateway = attachmentGateway({
      deleteAttachment: vi.fn(async () => { throw { code: 'AGENT_ATTACHMENT_DELETE_FAILED' } }),
    })
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    await act(async () => { await view.result.current.add([textFile()]) })
    const clientId = view.result.current.records['session-one']![0]!.client_id

    await act(async () => { await view.result.current.remove(clientId) })

    expect(view.result.current.records['session-one']).toHaveLength(1)
    expect(onError).toHaveBeenCalledWith('AGENT_ATTACHMENT_DELETE_FAILED')
  })

  it('删除请求进行中时公开 deleting 状态并阻止重复操作', async () => {
    const pending = deferred<void>()
    const gateway = attachmentGateway({ deleteAttachment: vi.fn(() => pending.promise) })
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    await act(async () => { await view.result.current.add([textFile()]) })
    const clientId = view.result.current.records['session-one']![0]!.client_id

    let removing!: Promise<void>
    act(() => { removing = view.result.current.remove(clientId) })
    await waitFor(() => expect(view.result.current.records['session-one']?.[0]?.phase).toBe('deleting'))
    await act(async () => { await view.result.current.remove(clientId) })
    expect(gateway.deleteAttachment).toHaveBeenCalledTimes(1)
    pending.resolve()
    await act(async () => { await removing })
    expect(view.result.current.records['session-one']).toBeUndefined()
  })

  it('失败附件可重试，且同一文件并发选择只上传一次', async () => {
    const gateway = attachmentGateway()
    vi.mocked(gateway.uploadAttachment)
      .mockRejectedValueOnce({ code: 'NETWORK_FAILED' })
      .mockResolvedValueOnce(attachment())
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    await act(async () => { await view.result.current.add([textFile()]) })
    expect(view.result.current.records['session-one']?.[0]?.phase).toBe('failed')

    await act(async () => {
      await view.result.current.retry(view.result.current.records['session-one']![0]!.client_id)
    })
    expect(view.result.current.records['session-one']?.[0]?.phase).toBe('ready')

    const duplicateGateway = attachmentGateway()
    const duplicateView = renderHook(() => useAgentDraftAttachments({
      gateway: duplicateGateway,
      ensureSession,
      onError,
    }))
    const duplicate = textFile()
    await act(async () => {
      await Promise.all([
        duplicateView.result.current.add([duplicate]),
        duplicateView.result.current.add([duplicate]),
      ])
    })
    expect(duplicateGateway.uploadAttachment).toHaveBeenCalledTimes(1)
    expect(duplicateView.result.current.records['session-one']).toHaveLength(1)
  })

  it('丢弃会话草稿时删除已上传附件并释放本地 File 引用', async () => {
    const gateway = attachmentGateway()
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    await act(async () => { await view.result.current.add([textFile()]) })

    await act(async () => { await view.result.current.discard('session-one') })

    expect(gateway.deleteAttachment).toHaveBeenCalledWith('attachment-one', 1)
    expect(view.result.current.records['session-one']).toBeUndefined()
  })
})

function attachmentGateway(overrides: Partial<AgentWorkspaceGateway> = {}) {
  return {
    uploadAttachment: vi.fn(async () => attachment()),
    deleteAttachment: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as AgentWorkspaceGateway
}

function attachment(): AgentAttachment {
  return {
    id: 'attachment-one',
    session_id: 'session-one',
    original_name: 'note.txt',
    mime_type: 'text/plain',
    kind: 'text',
    size_bytes: 5,
    state: 'ready',
    expires_at: '2026-08-29T00:10:00Z',
    revision: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  }
}

function textFile() {
  return new File(['hello'], 'note.txt', { type: 'text/plain', lastModified: 1 })
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((done) => { resolve = done })
  return { promise, resolve }
}

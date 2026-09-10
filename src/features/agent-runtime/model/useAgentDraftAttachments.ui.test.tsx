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

  it('终端引用明确投递目标会话，不调用 ensureSession 且不按同名文件去重来源', async () => {
    const gateway = attachmentGateway()
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    const first = terminalReference()
    const second = { ...first, origin: { ...first.origin, source_session_id: 'ssh_other' } }
    await act(async () => {
      expect(await view.result.current.addTerminalReference('session-target', first)).toBe(true)
      expect(await view.result.current.addTerminalReference('session-target', second)).toBe(true)
    })
    expect(ensureSession).not.toHaveBeenCalled()
    expect(gateway.uploadAttachment).toHaveBeenCalledTimes(2)
    expect(gateway.uploadAttachment).toHaveBeenCalledWith('session-target', expect.any(File), expect.any(AbortSignal), first.origin)
    expect(view.result.current.records['session-target']).toHaveLength(2)
  })

  it('终端引用上传失败保留可重试卡片和来源，重试不重新建立会话', async () => {
    const gateway = attachmentGateway()
    vi.mocked(gateway.uploadAttachment).mockRejectedValueOnce({ code: 'NETWORK_ERROR' })
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    await act(async () => { expect(await view.result.current.addTerminalReference('session-target', terminalReference())).toBe(true) })
    const failed = view.result.current.records['session-target']![0]!
    expect(failed.phase).toBe('failed')
    expect(await failed.file.text()).toBe('first\nsecond')
    await act(async () => { await view.result.current.retry(failed.client_id) })
    expect(view.result.current.records['session-target']![0]!.phase).toBe('ready')
    expect(vi.mocked(gateway.uploadAttachment).mock.calls[1]![3]).toEqual(terminalReference().origin)
  })

  it('旧排队编辑的上传完成不能写入重开的编辑，失效引用不得再重试', async () => {
    let owner = 'edit-first'
    const pending = deferred<AgentAttachment>()
    const gateway = attachmentGateway({ uploadAttachment: vi.fn(() => pending.promise) })
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError, getOwnerId: () => owner }))
    let adding!: Promise<boolean>
    act(() => { adding = view.result.current.addTerminalReference('session-target', terminalReference(), owner) })
    await waitFor(() => expect(gateway.uploadAttachment).toHaveBeenCalledOnce())
    owner = 'edit-reopened'
    act(() => view.result.current.clear('session-target'))
    pending.resolve(attachment())
    await act(async () => { expect(await adding).toBe(false) })
    expect(view.result.current.records['session-target']).toBeUndefined()
    await act(async () => { expect(await view.result.current.addTerminalReference('session-target', terminalReference(), 'edit-first')).toBe(false) })
    expect(gateway.uploadAttachment).toHaveBeenCalledOnce()
  })

  it('并发终端引用遵守八附件总量上限并保留每条上传结果', async () => {
    const gateway = attachmentGateway()
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    await act(async () => {
      const results = await Promise.all(Array.from({ length: 9 }, () => view.result.current.addTerminalReference('session-target', terminalReference())))
      expect(results.filter(Boolean)).toHaveLength(8)
    })
    expect(gateway.uploadAttachment).toHaveBeenCalledTimes(8)
    expect(view.result.current.records['session-target']?.every(({ phase }) => phase === 'ready')).toBe(true)
    expect(onError).toHaveBeenCalledWith('AGENT_ATTACHMENT_LIMIT_COUNT')
  })

  it('清理旧编辑仅释放旧 owner，已提交附件不删除，新编辑的引用不受影响', async () => {
    let owner = 'edit-old'
    const gateway = attachmentGateway()
    vi.mocked(gateway.uploadAttachment)
      .mockResolvedValueOnce({ ...attachment(), id: 'old-upload' })
      .mockResolvedValueOnce({ ...attachment(), id: 'new-upload' })
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError, getOwnerId: () => owner }))
    await act(async () => { await view.result.current.addTerminalReference('session-target', terminalReference(), owner) })
    owner = 'edit-new'
    await act(async () => { await view.result.current.addTerminalReference('session-target', terminalReference(), owner) })
    await act(async () => { await view.result.current.discardOwner('session-target', 'edit-old', true) })
    expect(gateway.deleteAttachment).not.toHaveBeenCalled()
    expect(view.result.current.records['session-target']).toHaveLength(1)
    expect(view.result.current.records['session-target']![0]!.owner_id).toBe('edit-new')
    await act(async () => { await view.result.current.discardOwner('session-target', 'edit-new') })
    expect(gateway.deleteAttachment).toHaveBeenCalledExactlyOnceWith('new-upload', 1)
    expect(view.result.current.records['session-target']).toBeUndefined()
  })

  it('普通附件上传中追加终端引用不重复计算已展示附件的预留量', async () => {
    const pending = deferred<AgentAttachment>()
    const gateway = attachmentGateway()
    vi.mocked(gateway.uploadAttachment).mockImplementationOnce(() => pending.promise)
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    let adding!: Promise<void>
    act(() => { adding = view.result.current.add([textFile()]) })
    await waitFor(() => expect(gateway.uploadAttachment).toHaveBeenCalledOnce())
    await act(async () => {
      expect(await Promise.all(Array.from({ length: 7 }, () => view.result.current.addTerminalReference('session-one', terminalReference())))).toEqual(Array(7).fill(true))
    })
    expect(view.result.current.records['session-one']).toHaveLength(8)
    pending.resolve(attachment())
    await act(async () => { await adding })
    expect(view.result.current.records['session-one']?.every(({ phase }) => phase === 'ready')).toBe(true)
  })

  it('取消后迟到的已落盘上传回执立即删除孤立附件，不恢复已移除卡片', async () => {
    const pending = deferred<AgentAttachment>()
    const gateway = attachmentGateway({ uploadAttachment: vi.fn(() => pending.promise) })
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    let adding!: Promise<boolean>
    act(() => { adding = view.result.current.addTerminalReference('session-one', terminalReference()) })
    await waitFor(() => expect(gateway.uploadAttachment).toHaveBeenCalledOnce())
    const id = view.result.current.records['session-one']![0]!.client_id
    await act(async () => { await view.result.current.remove(id) })
    await act(async () => { pending.resolve(attachment()); await adding })
    expect(view.result.current.records['session-one']).toBeUndefined()
    expect(gateway.deleteAttachment).toHaveBeenCalledExactlyOnceWith('attachment-one', 1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('清理旧 owner 与在途手动删除共享同一次删除，不重复触发附件不存在错误', async () => {
    const pending = deferred<void>()
    const gateway = attachmentGateway({ deleteAttachment: vi.fn(() => pending.promise) })
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError, getOwnerId: () => 'edit-owner' }))
    await act(async () => { await view.result.current.addTerminalReference('session-one', terminalReference(), 'edit-owner') })
    const id = view.result.current.records['session-one']![0]!.client_id
    let removing!: Promise<void>
    let discarding!: Promise<void>
    act(() => { removing = view.result.current.remove(id) })
    await waitFor(() => expect(gateway.deleteAttachment).toHaveBeenCalledOnce())
    act(() => { discarding = view.result.current.discardOwner('session-one', 'edit-owner') })
    expect(gateway.deleteAttachment).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(); await Promise.all([removing, discarding]) })
    expect(view.result.current.records['session-one']).toBeUndefined()
    expect(onError).not.toHaveBeenCalled()
  })

  it('普通附件首次读取期间编辑被取消重开，固定 owner 拒绝旧文件进入新编辑', async () => {
    const file = textFile()
    const data = await file.arrayBuffer()
    const reading = deferred<ArrayBuffer>()
    const read = vi.spyOn(file, 'arrayBuffer').mockReturnValueOnce(reading.promise)
    let owner = 'edit-original'
    const gateway = attachmentGateway()
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError, getOwnerId: () => owner }))
    let adding!: Promise<void>
    act(() => { adding = view.result.current.add([file], { sessionId: 'session-one', ownerId: owner }) })
    await waitFor(() => expect(read).toHaveBeenCalledOnce())
    owner = 'edit-reopened'
    await act(async () => { reading.resolve(data); await adding })
    expect(gateway.uploadAttachment).not.toHaveBeenCalled()
    expect(ensureSession).not.toHaveBeenCalled()
    expect(view.result.current.records).toEqual({})
    expect(onError).not.toHaveBeenCalled()
  })

  it('普通附件固定目标后切换其他会话，仍上传到原会话而不调用新选择的 ensureSession', async () => {
    const gateway = attachmentGateway()
    const ensureOtherSession = vi.fn(async () => 'session-other')
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession: ensureOtherSession, onError, getOwnerId: () => 'draft' }))
    await act(async () => { await view.result.current.add([textFile()], { sessionId: 'session-one', ownerId: 'draft' }) })
    expect(ensureOtherSession).not.toHaveBeenCalled()
    expect(view.result.current.records['session-one']).toHaveLength(1)
    expect(view.result.current.records['session-other']).toBeUndefined()
  })

  it('移除后重选同一文件，旧上传的 finally 不得释放新校验的数量预留', async () => {
    const file = textFile()
    const data = await file.arrayBuffer()
    const validation = deferred<ArrayBuffer>()
    const read = vi.spyOn(file, 'arrayBuffer')
      .mockResolvedValueOnce(data).mockResolvedValueOnce(data)
      .mockResolvedValueOnce(data).mockReturnValueOnce(validation.promise)
    const uploading = deferred<AgentAttachment>()
    const gateway = attachmentGateway()
    vi.mocked(gateway.uploadAttachment).mockReturnValueOnce(uploading.promise)
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    let first!: Promise<void>
    let second!: Promise<void>
    act(() => { first = view.result.current.add([file]) })
    await waitFor(() => expect(gateway.uploadAttachment).toHaveBeenCalledOnce())
    await act(async () => { await view.result.current.remove(view.result.current.records['session-one']![0]!.client_id) })
    act(() => { second = view.result.current.add([file]) })
    await waitFor(() => expect(read).toHaveBeenCalledTimes(4))
    await act(async () => { uploading.resolve(attachment()); await first })
    await act(async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => view.result.current.addTerminalReference('session-one', terminalReference())))
      expect(results.filter(Boolean)).toHaveLength(7)
    })
    await act(async () => { validation.resolve(data); await second })
    expect(view.result.current.records['session-one']).toHaveLength(8)
  })

  it('迟到上传的清理失败明确报告，不恢复取消的卡片或再次上传', async () => {
    const pending = deferred<AgentAttachment>()
    const gateway = attachmentGateway({ uploadAttachment: vi.fn(() => pending.promise), deleteAttachment: vi.fn(async () => { throw new Error('offline') }) })
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    let adding!: Promise<void>
    act(() => { adding = view.result.current.add([textFile()]) })
    await waitFor(() => expect(gateway.uploadAttachment).toHaveBeenCalledOnce())
    await act(async () => { await view.result.current.discard('session-one') })
    await act(async () => { pending.resolve(attachment()); await adding })
    expect(onError).toHaveBeenCalledExactlyOnceWith('AGENT_ATTACHMENT_DELETE_FAILED')
    expect(view.result.current.records).toEqual({})
    expect(gateway.uploadAttachment).toHaveBeenCalledOnce()
  })

  it.each([false, true])('新草稿初次校验期间选择失效，不创建会话或向新草稿报告旧错误（非法文件：%s）', async (invalid) => {
    const file = new File([invalid ? 'a\0b' : 'hello'], 'note.txt', { type: 'text/plain' })
    const data = await file.arrayBuffer()
    const reading = deferred<ArrayBuffer>()
    const read = vi.spyOn(file, 'arrayBuffer').mockReturnValueOnce(reading.promise)
    let selectionCurrent = true
    const gateway = attachmentGateway()
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    let adding!: Promise<void>
    act(() => { adding = view.result.current.add([file], undefined, () => selectionCurrent) })
    await waitFor(() => expect(read).toHaveBeenCalledOnce())
    selectionCurrent = false
    await act(async () => { reading.resolve(data); await adding })
    expect(ensureSession).not.toHaveBeenCalled()
    expect(gateway.uploadAttachment).not.toHaveBeenCalled()
    expect(view.result.current.records).toEqual({})
    expect(onError).not.toHaveBeenCalled()
  })

  it('新草稿创建会话后合法切换选择，不使已经解析的附件目标失效', async () => {
    let selectionCurrent = true
    const ensureCreatedSession = vi.fn(async () => {
      selectionCurrent = false
      return 'session-created'
    })
    const gateway = attachmentGateway()
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession: ensureCreatedSession, onError }))
    await act(async () => { await view.result.current.add([textFile()], undefined, () => selectionCurrent) })
    expect(ensureCreatedSession).toHaveBeenCalledOnce()
    expect(view.result.current.records['session-created']?.[0]?.phase).toBe('ready')
    expect(onError).not.toHaveBeenCalled()
  })

  it('提交成功仅清理已提交附件，保留等待期间追加的已上传引用和在途上传', async () => {
    const uploading = deferred<AgentAttachment>()
    let uploadSignal: AbortSignal | undefined
    const gateway = attachmentGateway()
    vi.mocked(gateway.uploadAttachment)
      .mockResolvedValueOnce({ ...attachment(), id: 'submitted' })
      .mockResolvedValueOnce({ ...attachment(), id: 'added-ready' })
      .mockImplementationOnce((_sessionId, _file, signal) => { uploadSignal = signal; return uploading.promise })
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError }))
    await act(async () => { await view.result.current.add([textFile()]) })
    await act(async () => { await view.result.current.addTerminalReference('session-one', terminalReference()) })
    let adding!: Promise<boolean>
    act(() => { adding = view.result.current.addTerminalReference('session-one', terminalReference()) })
    await waitFor(() => expect(gateway.uploadAttachment).toHaveBeenCalledTimes(3))
    act(() => view.result.current.clearCommitted('session-one', ['submitted']))
    expect(view.result.current.records['session-one']).toHaveLength(2)
    expect(view.result.current.records['session-one']?.[0]?.attachment?.id).toBe('added-ready')
    expect(uploadSignal?.aborted).toBe(false)
    await act(async () => {
      uploading.resolve({ ...attachment(), id: 'added-later' })
      expect(await adding).toBe(true)
    })
    expect(view.result.current.records['session-one']?.map(({ attachment: item }) => item?.id)).toEqual(['added-ready', 'added-later'])
    expect(gateway.deleteAttachment).not.toHaveBeenCalled()
  })

  it('清理提交附件不会使期间开始的普通文件校验失效', async () => {
    const gateway = attachmentGateway()
    vi.mocked(gateway.uploadAttachment)
      .mockResolvedValueOnce({ ...attachment(), id: 'submitted' })
      .mockResolvedValueOnce({ ...attachment(), id: 'validated-later' })
    const view = renderHook(() => useAgentDraftAttachments({ gateway, ensureSession, onError, getOwnerId: () => 'draft' }))
    await act(async () => { await view.result.current.add([textFile()]) })
    const file = new File(['new'], 'new.txt', { type: 'text/plain' })
    const data = await file.arrayBuffer()
    const reading = deferred<ArrayBuffer>()
    const read = vi.spyOn(file, 'arrayBuffer').mockReturnValueOnce(reading.promise)
    let adding!: Promise<void>
    act(() => { adding = view.result.current.add([file], { sessionId: 'session-one', ownerId: 'draft' }) })
    await waitFor(() => expect(read).toHaveBeenCalledOnce())
    act(() => view.result.current.clearCommitted('session-one', ['submitted']))
    await act(async () => { reading.resolve(data); await adding })
    expect(view.result.current.records['session-one']?.map(({ attachment: item }) => item?.id)).toEqual(['validated-later'])
    expect(gateway.deleteAttachment).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})

function terminalReference() {
  return { text: 'first\nsecond', origin: {
    kind: 'terminal_selection' as const, source_session_id: 'ssh_source', host_name: '主机',
    captured_at: '2026-09-08T06:00:00Z', line_count: 2,
  } }
}

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

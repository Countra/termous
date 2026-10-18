import { describe, expect, it, vi } from 'vitest'
import { AgentSurfaceAdapter } from './agentSurfaceAdapter.ts'
import { AgentFeedbackStore } from './agentFeedback.ts'
import type { AgentSurfaceModel } from './agentSurfaceModel.ts'
import { projectAgentSurface, restoreAgentSurface } from './agentSurfaceProjection.ts'
import { DetachedClient, DetachedStatePublisher, DetachedStateReceiver } from '#shared/detached-window'
import { AgentRemoteAdapter } from './agentRemoteAdapter.ts'

const connection = { module: 'agent', instance: 'workspace', generation: 'one' }
const command = (args: string[], inputSequence: number, owner = 'one:draft') => ({
  connection, kind: 'request' as const, operation: 'command' as const,
  payload: { name: 'workspace.onDraftChange', args, owner, inputSequence },
})

describe('助手宿主适配器', () => {
  it('无效附件在发送前反馈失败，不留下阻塞收回的待确认文件', async () => {
    const bootstrap = { ...connection, appearance: { theme: 'dark' as const, language: 'zh-CN' as const } }
    const send = vi.fn()
    const report = vi.fn()
    const client = new DetachedClient(bootstrap, { bootstrap: async () => bootstrap, send, subscribe: () => () => undefined })
    const adapter = new AgentRemoteAdapter(client, report)
    const model = adapter.connect({ workspace: { draft_attachments: [], messages: [] } } as unknown as AgentSurfaceModel, [], 0)
    try {
      await model.workspace!.onAttachFiles([new File([], 'empty.txt', { type: 'text/plain' })])
      await model.workspace!.onAttachFiles([new File(['x'], 'a'.repeat(257))])
      expect(report).toHaveBeenCalledTimes(2)
      expect(send).not.toHaveBeenCalled()
      await expect(adapter.flush()).resolves.toBeUndefined()
    } finally { client.dispose() }
  })

  it('远端状态更新保留图片读取能力，流式变化不会重置预览或缩略图', () => {
    const bootstrap = { ...connection, appearance: { theme: 'dark' as const, language: 'zh-CN' as const } }
    const client = new DetachedClient(bootstrap, { bootstrap: async () => bootstrap, send: () => undefined, subscribe: () => () => undefined })
    const adapter = new AgentRemoteAdapter(client, vi.fn())
    const createModel = () => ({ workspace: { draft_attachments: [], messages: [] }, archive: {} }) as unknown as AgentSurfaceModel
    try {
      const before = adapter.connect(createModel(), [], 0)
      const after = adapter.connect(createModel(), [], 0)
      expect(after.workspace!.onLoadLocalAttachment).toBe(before.workspace!.onLoadLocalAttachment)
      expect(after.workspace!.onLoadAttachmentContent).toBe(before.workspace!.onLoadAttachmentContent)
      expect(after.workspace!.onLoadToolImage).toBe(before.workspace!.onLoadToolImage)
      expect(after.archive!.onLoadAttachmentContent).toBe(before.archive!.onLoadAttachmentContent)
    } finally { client.dispose() }
  })

  it('拒绝旧编辑所有者，迟到输入不覆盖已确认的新输入', async () => {
    const onDraftChange = vi.fn()
    const adapter = new AgentSurfaceAdapter(new AgentFeedbackStore(), () => '附件失败')
    adapter.model = { workspace: { selected_session_id: 'one', onDraftChange } } as unknown as AgentSurfaceModel
    await adapter.handle(command(['新输入'], 2))
    await adapter.handle(command(['旧输入'], 1))
    await expect(adapter.handle(command(['错误会话'], 3, 'two:draft'))).rejects.toThrow('editor_changed')
    expect(onDraftChange).toHaveBeenCalledTimes(1)
    expect(onDraftChange).toHaveBeenCalledWith('新输入')
  })

  it('输入已保存但回执丢失后切换会话，重试仍可确认且不会改写新会话', async () => {
    const onDraftChange = vi.fn()
    const adapter = new AgentSurfaceAdapter(new AgentFeedbackStore(), () => '附件失败')
    adapter.model = { workspace: { selected_session_id: 'one', onDraftChange } } as unknown as AgentSurfaceModel
    await adapter.handle(command(['保存的输入'], 1))
    adapter.model = { workspace: { selected_session_id: 'two', onDraftChange } } as unknown as AgentSurfaceModel
    await expect(adapter.handle(command(['保存的输入'], 1))).resolves.toBeUndefined()
    await expect(adapter.handle(command(['未送达的输入'], 2))).rejects.toThrow('editor_changed')
    expect(onDraftChange).toHaveBeenCalledExactlyOnceWith('保存的输入')
  })

  it('文件接收确认不等待上传，且内容加载不能越过宿主目录', async () => {
    let finish!: () => void
    const onAttachFiles = vi.fn<(files: File[]) => Promise<void>>(() => new Promise<void>(resolve => { finish = resolve }))
    const onLoadAttachmentContent = vi.fn()
    const adapter = new AgentSurfaceAdapter(new AgentFeedbackStore(), () => '附件失败')
    adapter.model = { workspace: { selected_session_id: 'one', onAttachFiles, onLoadAttachmentContent,
      draft_attachments: [], queued_turns: [], messages: [] } } as unknown as AgentSurfaceModel
    expect(await adapter.handle({ connection, kind: 'request', operation: 'binary', payload: {
      kind: 'attach', owner: 'one:draft', files: [{ name: 'one.txt', type: 'text/plain', lastModified: 1, bytes: new ArrayBuffer(3) }],
    } })).toEqual({ received: true })
    expect(onAttachFiles.mock.calls[0][0][0]).toBeInstanceOf(File)
    await expect(adapter.handle({ connection, kind: 'request', operation: 'binary', payload: {
      kind: 'attachment', source: { id: 'unpublished' },
    } })).rejects.toThrow('attachment_missing')
    expect(onLoadAttachmentContent).not.toHaveBeenCalled()
    finish()
  })

  it('流式分区只更新变化的 Part，恢复时维持消息顺序', () => {
    const publisher = new DetachedStatePublisher()
    const model = (text: string) => ({ workspace: { draft_attachments: [], messages: [
      { id: 'history', parts: [{ id: 'first', text: '历史' }] }, { id: 'stream', parts: [{ id: 'last', text }] },
    ] } }) as unknown as AgentSurfaceModel
    publisher.update(projectAgentSurface(model('第一段')))
    const update = publisher.update(projectAgentSurface(model('第一段和第二段')))
    expect(Object.keys(update!.partitions)).toEqual(['part:workspace:stream:last'])
    const restored = restoreAgentSurface(publisher.snapshot().partitions)
    expect(restored.workspace!.messages.map(message => message.id)).toEqual(['history', 'stream'])
    expect(restored.workspace!.messages[1]!.parts[0]).toEqual({ id: 'last', text: '第一段和第二段' })
  })

  it('恢复集合和注入小窗操作不改写接收缓存，多次恢复相互独立', () => {
    const bootstrap = { ...connection, appearance: { theme: 'dark' as const, language: 'zh-CN' as const } }
    const client = new DetachedClient(bootstrap, { bootstrap: async () => bootstrap, send: vi.fn(), subscribe: () => () => undefined })
    const adapter = new AgentRemoteAdapter(client, vi.fn())
    const partitions = projectAgentSurface({ workspace: { messages: [], draft_attachments: [],
      session_management: { pendingIds: new Set(['session-one']) } },
      archive: { pendingIds: new Set(['session-two']) },
    } as unknown as AgentSurfaceModel)
    const before = structuredClone(partitions)
    try {
      const restored = adapter.connect(restoreAgentSurface(partitions), ['management.onPin'], 0)
      expect(restored.workspace!.session_management!.pendingIds).toEqual(new Set(['session-one']))
      expect(restored.archive!.pendingIds).toEqual(new Set(['session-two']))
      expect(restored.workspace!.session_management!.onPin).toBeTypeOf('function')
      expect(partitions).toEqual(before)
      const again = restoreAgentSurface(partitions)
      expect(again.workspace!.session_management).not.toBe(restored.workspace!.session_management)
      expect(again.workspace!.session_management!.onPin).toBeUndefined()
    } finally { client.dispose() }
  })

  it('长消息增删 Part 与会话切换后，小窗增量和重新同步均完整恢复', () => {
    const publisher = new DetachedStatePublisher()
    const receiver = new DetachedStateReceiver()
    const model = (session: string, parts: { id: string; text: string }[]) => ({ workspace: {
      selected_session_id: session, draft_attachments: [], messages: [{ id: `message-${session}`, parts }],
    } }) as unknown as AgentSurfaceModel
    const first = { id: 'first', text: '已保存的工具详情'.repeat(10000) }
    const second = { id: 'second', text: '后续输出' }
    publisher.update(projectAgentSurface(model('one', [first])))
    receiver.accept(publisher.snapshot())
    const append = publisher.update(projectAgentSurface(model('one', [first, second])))!
    expect(append.partitions['part:workspace:message-one:first']).toBeUndefined()
    receiver.accept(append)
    expect(restoreAgentSurface(receiver.snapshot()).workspace!.messages[0]!.parts).toEqual([first, second])
    const remove = publisher.update(projectAgentSurface(model('one', [second])))!
    expect(remove.partitions['part:workspace:message-one:first']).toBeNull()
    receiver.accept(remove)
    expect(restoreAgentSurface(receiver.snapshot()).workspace!.messages[0]!.parts).toEqual([second])
    receiver.accept(publisher.update(projectAgentSurface(model('two', [first])))!)
    expect(Object.keys(receiver.snapshot()).some(key => key.includes('message-one'))).toBe(false)
    const reconnected = new DetachedStateReceiver()
    reconnected.accept(publisher.snapshot())
    expect(restoreAgentSurface(reconnected.snapshot())).toEqual(restoreAgentSurface(receiver.snapshot()))
    expect(restoreAgentSurface(receiver.snapshot()).workspace!.messages[0]!.parts).toEqual([first])
  })
})

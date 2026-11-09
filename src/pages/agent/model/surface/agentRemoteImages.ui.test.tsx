import { expect, it, vi } from 'vitest'
import { DetachedClient } from '#shared/detached-window'
import { AgentRemoteAdapter } from './agentRemoteAdapter.ts'
import { AgentSurfaceAdapter } from './agentSurfaceAdapter.ts'
import { AgentFeedbackStore } from './agentFeedback.ts'
import type { AgentSurfaceModel } from './agentSurfaceModel.ts'

const connection = { module: 'agent', instance: 'workspace', generation: 'images' }

it('独立窗口合并相同读取，最多两项传输，取消的等待项不发给宿主', async () => {
  const bootstrap = { ...connection, appearance: { theme: 'dark' as const, language: 'zh-CN' as const } }
  const client = new DetachedClient(bootstrap, { bootstrap: async () => bootstrap, send: vi.fn(), subscribe: () => () => undefined })
  const pending: Array<(value: unknown) => void> = []
  const request = vi.spyOn(client.peer, 'request').mockImplementation(() => new Promise(resolve => pending.push(resolve)))
  const adapter = new AgentRemoteAdapter(client, vi.fn())
  const model = adapter.connect({ workspace: { messages: [], draft_attachments: [] } } as unknown as AgentSurfaceModel, [], 0)
  const load = model.workspace!.onLoadLocalAttachment!
  const a = new AbortController(), b = new AbortController(), c = new AbortController()
  try {
    const first = load('first', a.signal)
    const shared = load('first', b.signal)
    const second = load('second')
    const cancelled = load('cancelled', c.signal)
    c.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).toHaveBeenCalledTimes(2)
    const result = { bytes: new Uint8Array([1, 2, 3]).buffer, type: 'image/png' }
    pending.forEach(resolve => resolve(result))
    const [image, copy] = await Promise.all([first, shared, second])
    expect(image).toBe(copy)
    expect(request).toHaveBeenCalledTimes(2)
    a.abort()
    const retained = await load('first', b.signal)
    expect(retained).toBe(image)
    expect(request).toHaveBeenCalledTimes(2)
  } finally { a.abort(); b.abort(); c.abort(); client.dispose() }
})

it('复制正文不缓存跨窗口大响应，写入命令仍保留去重回执', () => {
  const adapter = new AgentSurfaceAdapter(new AgentFeedbackStore(), () => '附件失败')
  for (const name of ['workspace.onLoadMessageText', 'archive.onLoadMessageText']) {
    expect(adapter.retainResponse({ connection, kind: 'request', operation: 'command',
      payload: { name, args: ['message'], owner: 'session:draft' } })).toBe(false)
  }
  expect(adapter.retainResponse({ connection, kind: 'request', operation: 'command',
    payload: { name: 'workspace.onDeleteSession', args: ['session'], owner: 'session:draft' } })).toBe(true)
})

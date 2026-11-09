import { App as AntdApp } from 'antd'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { DetachedClient, DetachedStatePublisher } from '#shared/detached-window'
import type { DetachedPacket } from '#common/contracts'
import { projectAgentSurface } from '../model/surface/agentSurfaceProjection.ts'
import type { AgentSurfaceModel } from '../model/surface/agentSurfaceModel.ts'
import { DetachedAgentSurface } from './DetachedAgentSurface.tsx'

const conversationRender = vi.hoisted(() => vi.fn())
const sessionRender = vi.hoisted(() => vi.fn())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../widgets/agent-workspace/ui/AgentConversation.tsx', async () => {
  const { memo } = await import('react')
  return { AgentConversation: memo((props: unknown) => { conversationRender(props); return <div role="log" /> }) }
})
vi.mock('../../../widgets/agent-workspace/ui/AgentSessionRow.tsx', () => ({
  AgentSessionRow: () => { sessionRender(); return <li>合成会话</li> },
}))

function inputFixture() {
  const connection = { module: 'agent', instance: 'workspace', generation: 'input-test' }
  const bootstrap = { ...connection, appearance: { theme: 'dark' as const, language: 'zh-CN' as const } }
  const publisher = new DetachedStatePublisher()
  const source = { workspace: {
    selected_session_id: 'one', sessions: [{ id: 'one', title: '合成会话', run_status: 'idle' }],
    messages: [{ id: 'history', role: 'assistant', status: 'completed', attachments: [], parts:
      Array.from({ length: 200 }, (_, i) => ({ id: `part-${i}`, kind: 'text', text: `历史正文 ${i}` })) }],
    models: [], draft: '', draft_attachments: [], queued_turns: [], queued_turn_counts: {},
    selected_reasoning_level: 'off', approval_policy: { status: 'ready', mode: 'review' },
    inspector: { context: { phase: 'loading' }, usage: { phase: 'loading' }, skills: [], mcp: { connection: 'connected', tool_count: 0, scope_count: 0 } },
    session_management: { pendingIds: new Set() }, onDraftChange: vi.fn(), onSend: vi.fn(),
    composerActive: true, model_runnable: true,
  } } as unknown as AgentSurfaceModel
  publisher.update(projectAgentSurface(source))
  const sent: DetachedPacket[] = []
  const client = new DetachedClient(bootstrap, {
    bootstrap: async () => bootstrap, subscribe: () => () => undefined,
    send: packet => {
      sent.push(packet)
      if (packet.operation === 'snapshot') queueMicrotask(() => client.accept({ connection, kind: 'response', id: packet.id,
        payload: structuredClone(publisher.snapshot()) }))
      if (packet.kind === 'ready') queueMicrotask(() => client.accept({ connection, kind: 'ready' }))
    },
  })
  return { client, sent, connection }
}

it('小窗连续输入和宿主确认不重绘历史，实际正文更新仍传递到消息区', async () => {
  const { client, sent, connection } = inputFixture()
  try {
    const view = render(<AntdApp><DetachedAgentSurface client={client} /></AntdApp>)
    await waitFor(() => expect(view.container.querySelector('[data-motion="entering"]')).not.toBeNull())
    await act(async () => {})
    const input = view.getByPlaceholderText('agent.composer.placeholder')
    const before = conversationRender.mock.calls.length
    const sidebarBefore = sessionRender.mock.calls.length
    for (let i = 1; i <= 12; i++) {
      fireEvent.change(input, { target: { value: `输入${i}` } })
      expect(input).toHaveValue(`输入${i}`)
      await act(async () => {})
      const command = [...sent].reverse().find(packet => packet.operation === 'command')!
      const { inputSequence } = command.payload as { inputSequence: number }
      await act(async () => {
        client.accept({ connection, kind: 'state', payload: { full: false, sequence: i + 1,
          partitions: { 'workspace.draft': `输入${i}`, inputSequence } } })
        client.accept({ connection, kind: 'response', id: command.id })
      })
    }
    expect(conversationRender.mock.calls.length - before).toBe(0)
    expect(sessionRender.mock.calls.length - sidebarBefore).toBe(0)
    act(() => client.accept({ connection, kind: 'state', payload: { full: false, sequence: 14,
      partitions: { 'part:workspace:history:part-199': { id: 'part-199', kind: 'text', text: '新输出' } } } }))
    expect(conversationRender.mock.calls.length - before).toBe(1)
    expect(input).toHaveValue('输入12')
  } finally { client.dispose() }
})

it('组合输入期间流式正文和旧确认不覆盖文字或光标，发送等待最新输入回执', async () => {
  const { client, sent, connection } = inputFixture()
  const command = (name: string) => sent.filter(packet => packet.operation === 'command'
    && (packet.payload as { name: string }).name === name)
  try {
    const view = render(<AntdApp><DetachedAgentSurface client={client} /></AntdApp>)
    await waitFor(() => expect(view.container.querySelector('[data-motion="entering"]')).not.toBeNull())
    await act(async () => {})
    const input = view.getByPlaceholderText('agent.composer.placeholder') as HTMLTextAreaElement
    input.focus()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'ni' } })
    await act(async () => {})
    fireEvent.change(input, { target: { value: '你好 world' } })
    input.setSelectionRange(2, 2)
    await act(async () => {})
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true })
    expect(command('workspace.onSend')).toHaveLength(0)
    const [first, latest] = command('workspace.onDraftChange')
    expect(first).toBeDefined()
    expect(latest).toBeDefined()
    await act(async () => {
      client.accept({ connection, kind: 'state', payload: { full: false, sequence: 2,
        partitions: { 'part:workspace:history:part-199': { id: 'part-199', kind: 'text', text: '同时到达的新正文' } } } })
      client.accept({ connection, kind: 'state', payload: { full: false, sequence: 3,
        partitions: { 'workspace.draft': 'ni', inputSequence: 1 } } })
      client.accept({ connection, kind: 'response', id: first.id })
    })
    expect(input).toHaveValue('你好 world')
    expect(input.selectionStart).toBe(2)
    expect(input.dataset.agentComposing).toBe('true')
    fireEvent.compositionEnd(input)
    await act(async () => {})
    // TextArea 在组合结束时另发最终 change，发送必须等这一次提交的回执。
    const composed = command('workspace.onDraftChange')[2]
    expect(composed).toBeDefined()
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(async () => {})
    expect(command('workspace.onSend')).toHaveLength(0)
    await act(async () => {
      client.accept({ connection, kind: 'state', payload: { full: false, sequence: 4,
        partitions: { 'workspace.draft': '你好 world', inputSequence: 2 } } })
      client.accept({ connection, kind: 'response', id: latest.id })
    })
    expect(command('workspace.onSend')).toHaveLength(0)
    await act(async () => {
      client.accept({ connection, kind: 'state', payload: { full: false, sequence: 5,
        partitions: { 'workspace.draft': '你好 world', inputSequence: 3 } } })
      client.accept({ connection, kind: 'response', id: composed.id })
    })
    const submitted = command('workspace.onSend')
    expect(submitted).toHaveLength(1)
    expect(submitted[0].payload).toMatchObject({ args: ['你好 world', []], owner: 'one:draft' })
    await act(async () => client.accept({ connection, kind: 'response', id: submitted[0].id }))
    expect(view.queryByRole('alert')).not.toBeInTheDocument()
  } finally { client.dispose() }
})

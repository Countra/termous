import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentWorkspaceMessage } from '../model/types.ts'
import { AgentConversation } from './AgentConversation.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./AgentMarkdown.tsx', () => ({
  AgentMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
}))

describe('AgentConversation', () => {
  it('流式内容增长时跟随尾部，用户上滚后停止自动跟随', () => {
    const view = render(
      <AgentConversation messages={[message('short')]} runStatus="running" loading={false} sessionKey="session-one" />,
    )
    const viewport = view.container.firstElementChild as HTMLDivElement
    const scrollTo = vi.fn()
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: 700 },
      scrollTo: { configurable: true, value: scrollTo },
    })

    view.rerender(
      <AgentConversation messages={[message('streaming content')]} runStatus="running" loading={false} sessionKey="session-one" />,
    )
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000 })

    viewport.scrollTop = 100
    fireEvent.scroll(viewport)
    const callCount = scrollTo.mock.calls.length
    view.rerender(
      <AgentConversation messages={[message('streaming content continues')]} runStatus="running" loading={false} sessionKey="session-one" />,
    )
    expect(scrollTo).toHaveBeenCalledTimes(callCount)
  })

  it('展示来源上下文与附件，并将预览动作交给工作区', () => {
    const onPreviewAttachment = vi.fn()
    const value = message('检查连接')
    value.source_context = {
      kind: 'workbench', entity_id: 'host-one', title: '生产主机', summary: '连接断开',
    }
    value.attachments = [{
      id: 'attachment-one', session_id: 'session-one', original_name: 'diagnostic.txt',
      mime_type: 'text/plain', kind: 'text', size_bytes: 16, state: 'bound', revision: 1,
      created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z',
    }]
    render(
      <AgentConversation
        messages={[value]}
        runStatus="completed"
        loading={false}
        sessionKey="session-one"
        onPreviewAttachment={onPreviewAttachment}
      />,
    )

    expect(screen.getByText('生产主机')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'diagnostic.txt' }))
    expect(onPreviewAttachment).toHaveBeenCalledWith(expect.objectContaining({ id: 'attachment-one' }))
  })
})

function message(text: string): AgentWorkspaceMessage {
  return {
    id: 'message-one',
    role: 'assistant',
    status: 'streaming',
    created_at: '2026-08-29T00:00:00Z',
    parts: [{ id: 'part-one', kind: 'text', text }],
    attachments: [],
  }
}

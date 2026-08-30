import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentWorkspaceMessage } from '../model/types.ts'
import { AgentConversation } from './AgentConversation.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'agent.message.turnUsage') return '本轮用量'
      if (key === 'agent.message.turnTotal') return '总量'
      return key
    },
    i18n: { resolvedLanguage: 'zh-CN' },
  }),
}))

vi.mock('./AgentMarkdown.tsx', () => ({
  AgentMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
}))

describe('AgentConversation', () => {
  it('流式内容增长时跟随尾部，用户上滚后停止自动跟随', () => {
    const view = render(
      <AgentConversation messages={[message('short')]} runStatus="running" loading={false} sessionKey="session-one" />,
    )
    const viewport = view.container.querySelector('[role="log"]') as HTMLDivElement
    const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      viewport.scrollTop = Number(top) - viewport.clientHeight
    })
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
    expect(screen.getByRole('button', { name: 'agent.conversation.jumpToLatest' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'agent.conversation.jumpToLatest' }))
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1_000 })
    fireEvent.scroll(viewport)
    const resumedCallCount = scrollTo.mock.calls.length
    view.rerender(
      <AgentConversation messages={[message('new token after jumping to tail')]} runStatus="running" loading={false} sessionKey="session-one" />,
    )
    expect(scrollTo).toHaveBeenCalledTimes(resumedCallCount + 1)
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

  it('在终态 Agent 回复末尾展示本轮 Token 明细与缓存详情', async () => {
    const value = message('已完成')
    value.status = 'completed'
    value.usage = {
      input_tokens: 1_200,
      cache_read_tokens: 125,
      cache_write_tokens: 25,
      output_tokens: 800,
      reasoning_tokens: 100,
      total_tokens: 2_150,
      estimated: false,
    }
    const view = render(
      <AgentConversation messages={[value]} runStatus="completed" loading={false} sessionKey="session-one" />,
    )

    const usage = screen.getByLabelText('本轮用量')
    expect(within(usage).getByText('本轮用量')).toBeInTheDocument()
    expect(within(usage).getByText('总量')).toBeInTheDocument()
    expect(within(usage).getByText('2,150')).toBeInTheDocument()
    expect(within(usage).getByText('1,200')).toBeInTheDocument()
    expect(within(usage).getByText('800')).toBeInTheDocument()
    expect(within(usage).getByText('125')).toBeInTheDocument()

    fireEvent.mouseEnter(within(usage).getByRole('button', { name: 'agent.inspector.cacheDetails' }))
    const details = await screen.findByRole('group', { name: 'agent.inspector.cacheDetailsTitle' })
    expect(within(details).getByText('agent.inspector.cacheWriteTokens')).toBeInTheDocument()
    expect(within(details).getByText('25')).toBeInTheDocument()
    expect(within(details).getByText('125')).toBeInTheDocument()

    view.rerender(
      <AgentConversation
        messages={[{ ...value, usage: { ...value.usage!, estimated: true } }]}
        runStatus="completed"
        loading={false}
        sessionKey="session-one"
      />,
    )
    expect(within(screen.getByLabelText('本轮用量'))
      .getByText('agent.inspector.partialUsage')).toBeInTheDocument()

    view.rerender(
      <AgentConversation
        messages={[{ ...value, status: 'streaming' }]}
        runStatus="running"
        loading={false}
        sessionKey="session-one"
      />,
    )
    expect(screen.queryByLabelText('本轮用量')).not.toBeInTheDocument()
  })

  it('关闭每轮 Token 展示后隐藏终态回复尾注但保留消息正文', () => {
    const value = message('已完成')
    value.status = 'completed'
    value.usage = {
      input_tokens: 80,
      cache_read_tokens: 10,
      cache_write_tokens: 0,
      output_tokens: 30,
      reasoning_tokens: 0,
      total_tokens: 120,
      estimated: false,
    }

    render(
      <AgentConversation
        messages={[value]}
        runStatus="completed"
        loading={false}
        sessionKey="session-one"
        showTurnTokenUsage={false}
      />,
    )

    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.queryByLabelText('本轮用量')).not.toBeInTheDocument()
  })

  it('同一终态回复后到 Token 用量时继续跟随对话尾部', () => {
    const value = message('已完成')
    value.status = 'completed'
    const view = render(
      <AgentConversation messages={[value]} runStatus="completed" loading={false} sessionKey="session-one" />,
    )
    const viewport = view.container.querySelector('[role="log"]') as HTMLDivElement
    const scrollTo = vi.fn()
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, writable: true, value: 700 },
      scrollTo: { configurable: true, value: scrollTo },
    })

    view.rerender(
      <AgentConversation
        messages={[{
          ...value,
          usage: {
            input_tokens: 80,
            cache_read_tokens: 10,
            cache_write_tokens: 0,
            output_tokens: 30,
            reasoning_tokens: 0,
            total_tokens: 120,
            estimated: false,
          },
        }]}
        runStatus="completed"
        loading={false}
        sessionKey="session-one"
      />,
    )

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000 })
  })

  it('用户消息即使包含异常用量数据也不展示统计', () => {
    const value = message('继续检查')
    value.role = 'user'
    value.status = 'completed'
    value.usage = {
      input_tokens: 80,
      cache_read_tokens: 10,
      cache_write_tokens: 0,
      output_tokens: 30,
      reasoning_tokens: 0,
      total_tokens: 120,
      estimated: false,
    }

    render(
      <AgentConversation messages={[value]} runStatus="completed" loading={false} sessionKey="session-one" />,
    )

    expect(screen.queryByLabelText('本轮用量')).not.toBeInTheDocument()
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

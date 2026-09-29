import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentWorkspaceMessage } from '../model/types.ts'
import { AgentConversation } from './AgentConversation.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { duration?: string }) => {
      if (key === 'agent.message.turnUsage') return '本轮用量'
      if (key === 'agent.message.turnTotal') return '总量'
      if (key === 'agent.message.duration') return `${key}:${values?.duration ?? ''}`
      return key
    },
    i18n: { resolvedLanguage: 'zh-CN' },
  }),
}))

vi.mock('./AgentMarkdown.tsx', () => ({
  AgentMarkdown: ({ children }: { children: string }) => {
    if (children === 'suspended-markdown') throw new Promise(() => undefined)
    return <div>{children}</div>
  },
}))

const animationFrames = new Map<number, FrameRequestCallback>()
let animationFrameSequence = 0
const activeRunStatuses = ['queued', 'starting', 'running', 'waiting_approval', 'stopping'] as const

beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    animationFrameSequence += 1
    animationFrames.set(animationFrameSequence, callback)
    return animationFrameSequence
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((frameId: number) => {
    animationFrames.delete(frameId)
  }))
})

beforeEach(() => {
  animationFrames.clear()
  animationFrameSequence = 0
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('AgentConversation', () => {
  it('用户正文上方展示发送时关联的资源，旧消息与助手回复不显示关联标签', async () => {
    const linked: AgentWorkspaceMessage = {
      ...message('查看镜像'), id: 'user-linked', role: 'user', status: 'completed',
      resources: [
        { kind: 'ssh_session', id: 'ses-original', name: 'TX-HK' },
        { kind: 'file_profile', id: 'file-original', name: '备份', host_name: '文件主机' },
      ],
    }
    const legacy = { ...message('旧消息'), id: 'user-legacy', role: 'user' as const }
    const assistant = { ...message('回复'), id: 'assistant', resources: linked.resources }
    const view = render(<AgentConversation messages={[linked, legacy, assistant]} runStatus="completed" loading={false} sessionKey="one" />)
    expect(screen.getAllByRole('group', { name: 'agent.message.resources' })).toHaveLength(1)
    const group = screen.getByRole('group', { name: 'agent.message.resources' })
    expect(within(group).getByText('TX-HK')).toBeVisible()
    expect(within(group).getByText('备份')).toBeVisible()
    expect(group.compareDocumentPosition(screen.getByText('查看镜像')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(group).queryByRole('button')).not.toBeInTheDocument()
    fireEvent.focus(within(group).getByLabelText('agent.message.resourceKind.ssh_session · TX-HK'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('ses-original')
    view.rerender(<AgentConversation messages={[{ ...linked, resources: [{ kind: 'ssh_profile', id: 'ssh-one', name: '运维配置' }] }]} runStatus="completed" loading={false} sessionKey="two" />)
    expect(screen.getByText('运维配置')).toBeVisible()
    expect(screen.queryByText('TX-HK')).not.toBeInTheDocument()
  })

  it('每条消息仅在正文下方操作行显示时间，头部不再重复显示', () => {
    const assistant = { ...message('助手正文'), status: 'completed' as const, duration_ms: 12_000 }
    const user = { ...message('用户正文'), id: 'message-user', role: 'user' as const, status: 'completed' as const }
    const view = render(
      <AgentConversation messages={[user, assistant]} runStatus="completed" loading={false} sessionKey="session-one" />,
    )

    const articles = view.container.querySelectorAll('article')
    expect(articles).toHaveLength(2)
    for (const article of articles) {
      const time = article.querySelector('time')!
      const button = within(article).getByRole('button', { name: 'app.copy' })
      expect(article.querySelectorAll('time')).toHaveLength(1)
      expect(article.querySelector('header time')).toBeNull()
      expect(time).toBeVisible()
      expect(time.parentElement).toContainElement(button)
      const body = within(article).getByText(article === articles[0] ? '用户正文' : '助手正文')
      expect(body.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(within(articles[0]).queryByText(/^agent\.message\.duration:/)).not.toBeInTheDocument()
    expect(within(articles[1]).getByText(/^agent\.message\.duration:.+/)).toBeVisible()
  })

  it.each(activeRunStatuses)(
    '空 Assistant 占位只展示唯一的 %s Run 状态',
    (runStatus) => {
      const placeholder = message('')
      placeholder.parts = []

      render(
        <AgentConversation
          messages={[placeholder]}
          runStatus={runStatus}
          loading={false}
          sessionKey="session-one"
        />,
      )

      const status = screen.getAllByText(`agent.status.${runStatus}`)
      expect(status).toHaveLength(1)
      expect(status[0]?.closest('article')).not.toBeNull()
      const article = status[0]?.closest('article') as HTMLElement
      expect(article.querySelector('time')).toBeNull()
      expect(article.querySelector('header time')).toBeNull()
      expect(within(article).queryByRole('button', { name: 'app.copy' })).not.toBeInTheDocument()
      for (const otherStatus of activeRunStatuses) {
        if (otherStatus !== runStatus) {
          expect(screen.queryByText(`agent.status.${otherStatus}`)).not.toBeInTheDocument()
        }
      }
    },
  )

  it.each(['queued', 'starting'] as const)(
    'Assistant 占位尚未到达时保留唯一的 %s Run 状态兜底',
    (runStatus) => {
      const userMessage = message('为什么？')
      userMessage.role = 'user'
      userMessage.status = 'completed'

      render(
        <AgentConversation
          messages={[userMessage]}
          runStatus={runStatus}
          loading={false}
          sessionKey="session-one"
        />,
      )

      const status = screen.getAllByText(`agent.status.${runStatus}`)
      expect(status).toHaveLength(1)
      expect(status[0]?.closest('article')).toBeNull()
      expect(screen.queryByText('agent.status.running')).not.toBeInTheDocument()
    },
  )

  it('Run 已结束时不为延迟更新的空 Assistant 占位伪造运行状态', () => {
    const placeholder = message('')
    placeholder.parts = []

    render(
      <AgentConversation
        messages={[placeholder]}
        runStatus="completed"
        loading={false}
        sessionKey="session-one"
      />,
    )

    expect(screen.queryByText('agent.status.starting')).not.toBeInTheDocument()
    expect(screen.queryByText('agent.status.running')).not.toBeInTheDocument()
  })

  it('历史空 Assistant 占位不承接新 Run 状态', () => {
    const stalePlaceholder = message('')
    stalePlaceholder.parts = []
    const latestUserMessage = message('继续分析')
    latestUserMessage.id = 'message-two'
    latestUserMessage.role = 'user'
    latestUserMessage.status = 'completed'

    render(
      <AgentConversation
        messages={[stalePlaceholder, latestUserMessage]}
        runStatus="starting"
        loading={false}
        sessionKey="session-one"
      />,
    )

    const status = screen.getAllByText('agent.status.starting')
    expect(status).toHaveLength(1)
    expect(status[0]?.closest('article')).toBeNull()
    expect(screen.queryByText('agent.status.running')).not.toBeInTheDocument()
  })

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
    flushAnimationFrames()
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
    flushAnimationFrames()
    expect(scrollTo).toHaveBeenCalledTimes(resumedCallCount + 1)
  })

  it('Markdown 延迟渲染挂起时仍允许同级受控输入响应', () => {
    function Harness() {
      const [messages, setMessages] = useState([message('ready-markdown')])
      const [draft, setDraft] = useState('')
      return (
        <>
          <button type="button" onClick={() => setMessages([message('suspended-markdown')])}>stream</button>
          <input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <AgentConversation messages={messages} runStatus="running" loading={false} sessionKey="session-one" />
        </>
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'stream' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'draft' }), { target: { value: 'queue now' } })

    expect(screen.getByRole('textbox', { name: 'draft' })).toHaveValue('queue now')
    expect(screen.getByText('ready-markdown')).toBeInTheDocument()
    expect(screen.queryByText('suspended-markdown')).not.toBeInTheDocument()
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

  it('在消息正文内展示图片缩略图并保留大图预览入口', async () => {
    const onPreviewAttachment = vi.fn()
    const onLoadAttachmentContent = vi.fn(async () => new Blob(['image'], { type: 'image/png' }))
    const value = message('请检查这张截图')
    value.attachments = [{
      id: 'attachment-image', session_id: 'session-one', original_name: 'screen.png',
      mime_type: 'image/png', kind: 'image', size_bytes: 128, state: 'bound', revision: 1,
      created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z',
    }]
    render(
      <AgentConversation
        messages={[value]}
        runStatus="completed"
        loading={false}
        sessionKey="session-one"
        onPreviewAttachment={onPreviewAttachment}
        onLoadAttachmentContent={onLoadAttachmentContent}
      />,
    )

    const preview = screen.getByRole('button', { name: 'agent.attachments.previewName' })
    expect(within(preview).getByRole('img', { name: 'screen.png' })).toBeInTheDocument()
    await waitFor(() => expect(onLoadAttachmentContent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'attachment-image' }),
      expect.any(AbortSignal),
    ))
    fireEvent.click(preview)
    expect(onPreviewAttachment).toHaveBeenCalledWith(expect.objectContaining({ id: 'attachment-image' }))
    expect(screen.queryByRole('button', { name: 'screen.png' })).not.toBeInTheDocument()
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

    flushAnimationFrames()
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000 })
  })

  it('同一终态回复迟到耗时时更新底部操作行，并继续跟随对话尾部', () => {
    const value = { ...message('已完成'), status: 'completed' as const }
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
    flushAnimationFrames()
    scrollTo.mockClear()
    expect(screen.queryByText(/^agent\.message\.duration:/)).not.toBeInTheDocument()

    view.rerender(
      <AgentConversation messages={[{ ...value, duration_ms: 12_000 }]} runStatus="completed" loading={false} sessionKey="session-one" />,
    )

    expect(screen.getByText(/^agent\.message\.duration:.+/)).toBeVisible()
    flushAnimationFrames()
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1_000 })

    viewport.scrollTop = 100
    fireEvent.scroll(viewport)
    scrollTo.mockClear()
    view.rerender(
      <AgentConversation messages={[{ ...value, duration_ms: 15_000 }]} runStatus="completed" loading={false} sessionKey="session-one" />,
    )
    flushAnimationFrames()
    expect(scrollTo).not.toHaveBeenCalled()
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

function flushAnimationFrames() {
  const callbacks = [...animationFrames.values()]
  animationFrames.clear()
  act(() => {
    for (const callback of callbacks) callback(performance.now())
  })
}

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

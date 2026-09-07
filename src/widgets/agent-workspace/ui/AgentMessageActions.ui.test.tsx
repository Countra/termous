import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeClipboardText } from '#shared/clipboard'
import type { AgentWorkspaceMessage } from '../model/types.ts'
import { AgentMessageActions } from './AgentMessageActions.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { duration?: string }) => (
      key === 'agent.message.duration' ? `${key}:${values?.duration ?? ''}` : key
    ),
    i18n: { resolvedLanguage: 'zh-CN' },
  }),
}))
vi.mock('#shared/clipboard', () => ({ writeClipboardText: vi.fn() }))

const copy = vi.mocked(writeClipboardText)
const copyLabel = 'app.copy'
const copiedLabel = 'agent.message.copied'

function message(overrides: Partial<AgentWorkspaceMessage> = {}): AgentWorkspaceMessage {
  return {
    id: 'message-one', role: 'assistant', status: 'completed', created_at: '2026-09-05T00:00:00Z',
    parts: [{ id: 'text-one', kind: 'text', text: '# Heading\n\n**Markdown**' }], attachments: [],
    ...overrides,
  }
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => { copy.mockReset(); copy.mockResolvedValue(undefined) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('AgentMessageActions', () => {
  it.each(['user', 'assistant'] as const)('复制 %s 的原始 Markdown，保留空白与代码块而非渲染文本', async (role) => {
    const markdown = '  # 标题\n\n**粗体** 与 [链接](https://example.com)\n\n```ts\nconst value = "a  b"\n```\n\n'
    render(<AgentMessageActions message={message({ role, parts: [{ id: 'text', kind: 'text', text: markdown }] })} />)
    const button = screen.getByRole('button', { name: copyLabel })
    fireEvent.click(button)
    expect(copy).toHaveBeenCalledExactlyOnceWith(markdown)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(copiedLabel))
    expect(button).toHaveAccessibleName(copyLabel)
    await waitFor(() => expect(screen.getByRole('button', { name: copyLabel }).querySelector('.lucide-check')).not.toBeNull())
  })

  it('按原序用两个换行连接所有 text parts，不复制推理、工具、压缩和附件元数据', async () => {
    render(<AgentMessageActions message={message({
      parts: [
        { id: 'reasoning', kind: 'reasoning', text: 'private reasoning', streaming: false },
        { id: 'first', kind: 'text', text: '  # First\n' },
        { id: 'tool', kind: 'tool', name: 'shell', status: 'completed', summary: 'tool output' },
        { id: 'space', kind: 'text', text: '  ' },
        { id: 'compaction', kind: 'compaction', activity: { compaction_id: 'compact', status: 'completed', reason: 'threshold', assistant_message_id: 'message-one', after_part_sequence: 0, tokens_before: 100, created_at: '2026-09-05T00:00:00Z' } },
        { id: 'last', kind: 'text', text: '## Last\n- item\n' },
      ],
      attachments: [{ id: 'attachment', session_id: 'session', original_name: 'secrets.md', mime_type: 'text/markdown', kind: 'text', size_bytes: 200, state: 'ready', revision: 1, created_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:00:00Z' }],
    })} />)
    fireEvent.click(screen.getByRole('button', { name: copyLabel }))
    expect(copy).toHaveBeenCalledExactlyOnceWith(['  # First\n', '  ', '## Last\n- item\n'].join('\n\n'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(copiedLabel))
  })

  it.each([
    message({ status: 'streaming' }),
    message({ parts: [] }),
    message({ parts: [{ id: 'blank', kind: 'text', text: ' \n\t ' }] }),
    message({ parts: [{ id: 'reasoning', kind: 'reasoning', text: 'not a reply', streaming: false }] }),
  ])('流式消息或没有有效正文时不显示复制按钮 %#', (value) => {
    const view = render(<AgentMessageActions message={value} />)
    expect(screen.queryByRole('button', { name: copyLabel })).not.toBeInTheDocument()
    const time = view.container.querySelector('time')
    expect(time).toBeVisible()
    expect(time).toHaveAttribute('datetime', value.created_at)
    expect(copy).not.toHaveBeenCalled()
  })

  it('时间与复制按钮处于同一操作行，时间无需悬停即可读取', () => {
    const value = message({ created_at: '2026-09-05T04:17:43Z' })
    const view = render(<AgentMessageActions message={value} />)
    const button = screen.getByRole('button', { name: copyLabel })
    const times = view.container.querySelectorAll('time')
    expect(times).toHaveLength(1)
    const time = times[0]
    const date = new Date(value.created_at)
    expect(time).toHaveTextContent(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`)
    expect(time).toBeVisible()
    expect(time).toHaveAttribute('datetime', value.created_at)
    expect(time.parentElement).toContainElement(button)
  })

  it.each(['mouseEnter', 'focus'] as const)('%s 时间时展示包含日期、秒和时区的完整本地时间', async (interaction) => {
    const value = message({ created_at: '2026-09-05T04:17:43Z' })
    const view = render(<AgentMessageActions message={value} />)
    const time = view.container.querySelector('time')!
    expect(time).toHaveAttribute('tabindex', '0')
    fireEvent[interaction](time)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('2026')
    expect(tooltip).toHaveTextContent('43')
    expect(tooltip.textContent).toMatch(/GMT|UTC|标准时间|夏令时间|协调世界时|世界协调时间|[A-Z]{2,5}T/)
    expect(tooltip.textContent?.length).toBeGreaterThan(time.textContent?.length ?? 0)
  })

  it.each([0, 1250, 61_000, 3_661_000])('助手终态合法耗时 %i 毫秒显示在时间旁', (duration_ms) => {
    const view = render(<AgentMessageActions message={message({ duration_ms })} />)
    const duration = screen.getByText(/^agent\.message\.duration:.+/)
    expect(duration).toBeVisible()
    expect(view.container.querySelector('time')?.parentElement).toContainElement(duration)
  })

  it('耗时提示通过鼠标与键盘都能解释统计范围', async () => {
    render(<AgentMessageActions message={message({ duration_ms: 12_000 })} />)
    const duration = screen.getByText(/^agent\.message\.duration:/)
    expect(duration).toHaveAttribute('tabindex', '0')
    fireEvent.focus(duration)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('agent.message.durationHint')
  })

  it.each([undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    '缺少或非法耗时 %s 不推算为有效时长',
    (duration_ms) => {
      render(<AgentMessageActions message={message({ duration_ms })} />)
      expect(screen.queryByText(/^agent\.message\.duration:/)).not.toBeInTheDocument()
    },
  )

  it.each([
    { role: 'user', status: 'completed' },
    { role: 'assistant', status: 'streaming' },
  ] as const)('$role 的 $status 状态不显示耗时', (overrides) => {
    render(<AgentMessageActions message={message({ ...overrides, duration_ms: 12_000 })} />)
    expect(screen.queryByText(/^agent\.message\.duration:/)).not.toBeInTheDocument()
  })

  it.each(['failed', 'interrupted', 'interrupted_by_steer'] as const)('终态 %s 的已有正文仍可复制', (status) => {
    render(<AgentMessageActions message={message({ status })} />)
    expect(screen.getByRole('button', { name: copyLabel })).toBeEnabled()
  })

  it('剪贴板失败不显示成功，保留重试按钮并在成功后清除错误', async () => {
    copy.mockRejectedValueOnce(new Error('clipboard unavailable')).mockResolvedValue(undefined)
    render(<AgentMessageActions message={message()} />)
    fireEvent.click(screen.getByRole('button', { name: copyLabel }))
    expect(await screen.findByRole('alert')).toHaveTextContent('agent.message.copyFailed')
    expect(screen.queryByText(copiedLabel)).not.toBeInTheDocument()
    const retry = screen.getByRole('button', { name: copyLabel })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(copiedLabel))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(copy).toHaveBeenCalledTimes(2)
  })

  it('写入在途拒绝双击，不提前播报成功', async () => {
    const pending = deferred()
    copy.mockReturnValue(pending.promise)
    render(<AgentMessageActions message={message()} />)
    const button = screen.getByRole('button', { name: copyLabel })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(copy).toHaveBeenCalledOnce()
    expect(screen.queryByText(copiedLabel)).not.toBeInTheDocument()
    await act(async () => pending.resolve())
    expect(screen.getByRole('status')).toHaveTextContent(copiedLabel)
  })

  it('同一消息正文更新后忽略旧复制回执，下一次点击复制新正文', async () => {
    const pending = deferred()
    copy.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const original = message({ parts: [{ id: 'text', kind: 'text', text: '# 原正文' }] })
    const view = render(<AgentMessageActions message={original} />)
    fireEvent.click(screen.getByRole('button', { name: copyLabel }))
    expect(copy).toHaveBeenCalledExactlyOnceWith('# 原正文')
    view.rerender(<AgentMessageActions message={{ ...original, parts: [{ id: 'text', kind: 'text', text: '# 更新正文\n\n**新内容**' }] }} />)
    await act(async () => pending.resolve())
    expect(screen.queryByText(copiedLabel)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: copyLabel })).not.toHaveAttribute('data-copied', 'true')
    fireEvent.click(screen.getByRole('button', { name: copyLabel }))
    expect(copy).toHaveBeenLastCalledWith('# 更新正文\n\n**新内容**')
    expect(copy).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(copiedLabel))
  })

  it('成功反馈短暂显示，卸载时清理反馈定时器', async () => {
    vi.useFakeTimers()
    const view = render(<AgentMessageActions message={message()} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: copyLabel })))
    expect(screen.getByRole('status')).toHaveTextContent(copiedLabel)
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(screen.queryByText(copiedLabel)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: copyLabel }).querySelector('.lucide-check')).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: copyLabel })))
    expect(screen.getByRole('status')).toHaveTextContent(copiedLabel)
    view.unmount()
    // Antd 按钮还会留下短帧动画；复制反馈计时器不应等到反馈超时才释放。
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['resolve', 'reject'] as const)('卸载后迟到的 %s 不创建反馈或残留定时器', async (outcome) => {
    vi.useFakeTimers()
    const pending = deferred()
    copy.mockReturnValue(pending.promise)
    const view = render(<AgentMessageActions message={message()} />)
    fireEvent.click(screen.getByRole('button', { name: copyLabel }))
    view.unmount()
    const timersAfterUnmount = vi.getTimerCount()
    await act(async () => {
      if (outcome === 'resolve') pending.resolve()
      else pending.reject(new Error('late clipboard failure'))
    })
    expect(screen.queryByText(copiedLabel)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(timersAfterUnmount)
  })
})

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '#entities/agent'
import { AgentArchiveManager, type AgentArchiveManagerProps } from './AgentArchiveManager.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'zh-CN' } }),
}))
vi.mock('./AgentMarkdown.tsx', () => ({ AgentMarkdown: ({ children }: { children: string }) => <div>{children}</div> }))

const archivedSession = (id = 'archive-one'): AgentSession => ({
  id, title: `归档 ${id}`, model_id: 'removed-model', reasoning_level: 'off', revision: 4,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-05T00:00:00Z', archived_at: '2026-09-05T00:00:00Z',
})

function propsFixture(overrides: Partial<AgentArchiveManagerProps> = {}): AgentArchiveManagerProps {
  return {
    open: true, sessions: [archivedSession()], query: '', listLoading: false,
    messages: [], previewLoading: false,
    onClose: vi.fn(), onQueryChange: vi.fn(), onSelect: vi.fn(), onReload: vi.fn(), onReloadPreview: vi.fn(),
    onRestore: vi.fn().mockResolvedValue(true), onDelete: vi.fn().mockResolvedValue(true),
    onLoadAttachmentContent: vi.fn().mockResolvedValue(new Blob(['archive attachment'])),
    ...overrides,
  }
}

describe('AgentArchiveManager', () => {
  it('列表搜索和选择只调用归档回调，未选择时不展示运行控件', () => {
    const props = propsFixture()
    render(<AgentArchiveManager {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'agent.archives.search' }), { target: { value: '查找标题' } })
    expect(props.onQueryChange).toHaveBeenCalledWith('查找标题')
    fireEvent.click(screen.getByRole('button', { name: /归档 archive-one/ }))
    expect(props.onSelect).toHaveBeenCalledWith('archive-one')
    expect(screen.getByText('agent.archives.select')).toBeInTheDocument()
    expect(screen.queryByRole('log')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agent.archives.restore' })).not.toBeInTheDocument()
  })

  it('复用历史对话、压缩活动和用量展示，不出现输入框或执行工具的操作', () => {
    const props = propsFixture({
      selectedSession: archivedSession(),
      messages: [{
        id: 'message-one', role: 'assistant', status: 'completed', created_at: '2026-09-05T00:00:00Z', attachments: [],
        parts: [
          { id: 'text', kind: 'text', text: '归档中的实际回复' },
          { id: 'compaction', kind: 'compaction', activity: {
            compaction_id: 'compact-one', status: 'completed', reason: 'threshold', assistant_message_id: 'message-one',
            after_part_sequence: 1, tokens_before: 80_000, tokens_after: 30_000, created_at: '2026-09-05T00:00:00Z',
          } },
        ],
      }],
    })
    render(<AgentArchiveManager {...props} />)
    expect(within(screen.getByRole('log')).getByText('归档中的实际回复')).toBeInTheDocument()
    expect(screen.getByText('agent.archives.readonly')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'agent.actions.send' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.archives.restore' })).toBeEnabled()
  })

  it('即使模型已移除也可恢复，携带归档快照且在进行中阻止重复恢复', async () => {
    let finish!: () => void
    const onRestore = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const props = propsFixture({ selectedSession: archivedSession(), onRestore })
    render(<AgentArchiveManager {...props} />)
    const restore = screen.getByRole('button', { name: 'agent.archives.restore' })
    fireEvent.click(restore)
    fireEvent.click(restore)
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRestore).toHaveBeenCalledWith(props.selectedSession)
    await act(async () => finish())
  })

  it('恢复进行中仍可搜索、返回和切换其他归档；旧操作失败不会污染新的预览', async () => {
    let reject!: (error: unknown) => void
    const props = propsFixture({
      sessions: [archivedSession(), archivedSession('two')], selectedSession: archivedSession(),
      onRestore: vi.fn(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise })),
    })
    const view = render(<AgentArchiveManager {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.archives.restore' }))
    expect(screen.getByRole('textbox', { name: 'agent.archives.search' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'agent.archives.back' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /归档 two/ }))
    expect(props.onSelect).toHaveBeenCalledWith('two')
    view.rerender(<AgentArchiveManager {...props} selectedSession={archivedSession('two')} />)
    await act(async () => reject(new Error('old restore failed')))
    expect(screen.queryByText('agent.archives.operationFailed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.archives.restore' })).toBeEnabled()
  })

  it('请求期间关闭重开仍继承该会话忙碌状态，其他归档可以独立恢复', async () => {
    let finish!: () => void
    const onRestore = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve })).mockResolvedValue(true)
    const props = propsFixture({ sessions: [archivedSession(), archivedSession('two')], selectedSession: archivedSession(), onRestore })
    const view = render(<AgentArchiveManager {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.archives.restore' }))
    expect(onRestore).toHaveBeenCalledTimes(1)
    const pendingIds = new Set(['archive-one'])
    view.rerender(<AgentArchiveManager {...props} open={false} pendingIds={pendingIds} />)
    view.rerender(<AgentArchiveManager {...props} pendingIds={pendingIds} />)
    const restore = screen.getByRole('button', { name: /agent\.archives\.restore$/ })
    expect(restore).toHaveClass('ant-btn-loading')
    fireEvent.click(restore)
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'agent.archives.back' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'agent.archives.search' })).toBeEnabled()
    view.rerender(<AgentArchiveManager {...props} selectedSession={archivedSession('two')} pendingIds={pendingIds} />)
    const otherRestore = screen.getByRole('button', { name: 'agent.archives.restore' })
    expect(otherRestore).not.toHaveClass('ant-btn-loading')
    await act(async () => fireEvent.click(otherRestore))
    expect(onRestore).toHaveBeenNthCalledWith(2, archivedSession('two'))
    await act(async () => finish())
    expect(screen.queryByText('agent.archives.operationFailed')).not.toBeInTheDocument()
  })

  it('附件复用原预览组件，切换归档后取消尚未完成的附件读取', async () => {
    const attachment = {
      id: 'text-attachment', session_id: 'archive-one', original_name: 'notes.txt', mime_type: 'text/plain',
      kind: 'text' as const, size_bytes: 24, state: 'bound' as const, revision: 1,
      created_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:00:00Z',
    }
    const props = propsFixture({
      selectedSession: archivedSession(),
      messages: [{ id: 'message-with-file', role: 'user', status: 'completed', parts: [], attachments: [attachment], created_at: attachment.created_at }],
      onLoadAttachmentContent: vi.fn(() => new Promise<Blob>(() => undefined)),
    })
    const view = render(<AgentArchiveManager {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'notes.txt' }))
    await waitFor(() => expect(props.onLoadAttachmentContent).toHaveBeenCalledWith(attachment, expect.any(AbortSignal)))
    const signal = vi.mocked(props.onLoadAttachmentContent).mock.calls[0][1]
    view.rerender(<AgentArchiveManager {...props} selectedSession={archivedSession('two')} messages={[]} />)
    expect(signal?.aborted).toBe(true)
  })

  it('永久删除必须先打开菜单并确认，失败保留确认框和重试入口', async () => {
    const props = propsFixture({ selectedSession: archivedSession() })
    vi.mocked(props.onDelete).mockRejectedValueOnce(new Error('network failure')).mockResolvedValue(true)
    render(<AgentArchiveManager {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.sessions.more' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'app.delete' }))
    expect(props.onDelete).not.toHaveBeenCalled()
    const confirm = screen.getByText('agent.archives.deleteTitle').closest<HTMLElement>('[role="dialog"]')!
    expect(within(confirm).getByText('归档 archive-one')).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: /app.delete$/ }))
    await waitFor(() => expect(within(confirm).getByText('agent.archives.operationFailed')).toBeInTheDocument())
    expect(props.onDelete).toHaveBeenCalledWith(props.selectedSession)
    fireEvent.click(within(confirm).getByRole('button', { name: /app.delete$/ }))
    await waitFor(() => expect(confirm).not.toBeVisible())
    expect(props.onDelete).toHaveBeenCalledTimes(2)
  })

  it('删除冲突刷新后人工重试使用同一会话的新revision，不跟随其他预览切换目标', async () => {
    const original = archivedSession()
    const props = propsFixture({ selectedSession: original })
    vi.mocked(props.onDelete).mockRejectedValueOnce(new Error('AGENT_REVISION_CONFLICT')).mockResolvedValue(true)
    const view = render(<AgentArchiveManager {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.sessions.more' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'app.delete' }))
    const confirm = screen.getByText('agent.archives.deleteTitle').closest<HTMLElement>('[role="dialog"]')!
    fireEvent.click(within(confirm).getByRole('button', { name: /app.delete$/ }))
    await waitFor(() => expect(within(confirm).getByText('agent.archives.operationFailed')).toBeInTheDocument())
    const refreshed = { ...original, title: '并发更新后的名称', revision: original.revision + 1 }
    view.rerender(<AgentArchiveManager {...props} sessions={[refreshed, archivedSession('two')]} selectedSession={archivedSession('two')} />)
    expect(within(confirm).getByText(refreshed.title)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: /app.delete$/ }))
    await waitFor(() => expect(confirm).not.toBeVisible())
    expect(props.onDelete).toHaveBeenNthCalledWith(1, original)
    expect(props.onDelete).toHaveBeenNthCalledWith(2, refreshed)
  })

  it('列表与历史读取失败各自重试，搜索无结果不显示空归档误导', () => {
    const props = propsFixture({ selectedSession: archivedSession(), listError: 'NETWORK_ERROR', previewError: 'NETWORK_ERROR' })
    const view = render(<AgentArchiveManager {...props} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'agent.archives.title' })).getByRole('button', { name: 'agent.archives.retry' }))
    fireEvent.click(within(screen.getByRole('region', { name: '归档 archive-one' })).getByRole('button', { name: 'agent.archives.retry' }))
    expect(props.onReload).toHaveBeenCalledTimes(1)
    expect(props.onReloadPreview).toHaveBeenCalledTimes(1)
    view.rerender(<AgentArchiveManager {...propsFixture({ sessions: [], query: '不存在' })} />)
    expect(screen.getByText('agent.archives.noResults')).toBeInTheDocument()
    expect(screen.queryByText('agent.archives.empty')).not.toBeInTheDocument()
  })

  it('返回列表只取消归档选择，关闭面板不提交恢复或删除', () => {
    const props = propsFixture({ selectedSession: archivedSession() })
    render(<AgentArchiveManager {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.archives.back' }))
    expect(props.onSelect).toHaveBeenCalledWith()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(props.onRestore).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  it('列表显示原分组归属和归档日期，分组不存在时回退未分组', () => {
    const grouped = { ...archivedSession(), group_id: 'group-one' }
    const orphaned = { ...archivedSession('two'), group_id: 'removed-group' }
    render(<AgentArchiveManager {...propsFixture({
      sessions: [grouped, orphaned],
      groups: [{ id: 'group-one', name: '服务器维护', sort_order: 0, revision: 1, created_at: grouped.created_at, updated_at: grouped.updated_at }],
    })} />)
    const groupedRow = screen.getByRole('button', { name: /归档 archive-one/ })
    expect(within(groupedRow).getByText('服务器维护')).toBeInTheDocument()
    expect(groupedRow.querySelector('time')).toHaveAttribute('dateTime', grouped.archived_at)
    const orphanedRow = screen.getByRole('button', { name: /归档 two/ })
    expect(within(orphanedRow).getByText('agent.sessions.ungrouped')).toBeInTheDocument()
    expect(screen.queryByText('removed-group')).not.toBeInTheDocument()
  })

  it('返回定位刚查看的会话，目标移除后依次回退首行和搜索框', async () => {
    const first = archivedSession()
    const second = archivedSession('two')
    const props = propsFixture({ sessions: [first, second], selectedSession: second })
    const view = render(<AgentArchiveManager {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.archives.back' }))
    view.rerender(<AgentArchiveManager {...props} selectedSession={undefined} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /归档 two/ })).toHaveFocus())

    view.rerender(<AgentArchiveManager {...props} />)
    view.rerender(<AgentArchiveManager {...props} sessions={[first]} selectedSession={undefined} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /归档 archive-one/ })).toHaveFocus())

    view.rerender(<AgentArchiveManager {...props} sessions={[first]} selectedSession={first} />)
    view.rerender(<AgentArchiveManager {...props} sessions={[]} selectedSession={undefined} />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'agent.archives.search' })).toHaveFocus())
  })

  it('搜索清除预览时保留输入焦点，无结果可直接清空查询', async () => {
    const props = propsFixture({ selectedSession: archivedSession() })
    const view = render(<AgentArchiveManager {...props} />)
    const search = screen.getByRole('textbox', { name: 'agent.archives.search' })
    act(() => search.focus())
    fireEvent.change(search, { target: { value: '不存在' } })
    view.rerender(<AgentArchiveManager {...props} sessions={[]} selectedSession={undefined} query="不存在" listLoading />)
    await waitFor(() => expect(search).toHaveFocus())
    view.rerender(<AgentArchiveManager {...props} sessions={[]} selectedSession={undefined} query="不存在" />)
    fireEvent.click(screen.getByRole('button', { name: 'agent.archives.clearSearch' }))
    expect(props.onQueryChange).toHaveBeenLastCalledWith('')
    expect(props.onRestore).not.toHaveBeenCalled()
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  it('空归档使用只读历史空态，加载和失败时不提前展示空会话', () => {
    const props = propsFixture({ selectedSession: archivedSession(), previewLoading: true })
    const view = render(<AgentArchiveManager {...props} />)
    expect(screen.getByText('agent.archives.loadingPreview')).toBeInTheDocument()
    expect(screen.queryByText('agent.archives.emptyHistory')).not.toBeInTheDocument()
    view.rerender(<AgentArchiveManager {...props} previewLoading={false} previewError="NETWORK_ERROR" />)
    expect(screen.getByText('agent.archives.previewFailed')).toBeInTheDocument()
    expect(screen.queryByText('agent.archives.emptyHistory')).not.toBeInTheDocument()
    view.rerender(<AgentArchiveManager {...props} previewLoading={false} />)
    expect(screen.getByText('agent.archives.emptyHistory')).toBeInTheDocument()
    expect(screen.queryByText('agent.empty.title')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.archives.restore' })).toBeEnabled()
  })
})

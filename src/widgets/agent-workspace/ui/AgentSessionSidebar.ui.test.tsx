import { App as AntdApp } from 'antd'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionGroup } from '#entities/agent'
import type { AgentWorkspaceSession } from '../model/types.ts'
import { sessionSidebarStorageKey } from '../model/sessionSidebar.ts'
import { AgentSessionSidebar, type AgentSessionSidebarProps } from './AgentSessionSidebar.tsx'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en-US' } }) }))

afterEach(() => { cleanup(); localStorage.clear() })

const groups: AgentSessionGroup[] = [
  { id: 'g1', name: 'Ops', sort_order: 0, revision: 1, created_at: '', updated_at: '' },
  { id: 'g2', name: 'Triage', sort_order: 1, revision: 1, created_at: '', updated_at: '' },
]
function session(id: string, extra: Partial<AgentWorkspaceSession> = {}): AgentWorkspaceSession {
  return { id, title: id, model_id: 'model', model_name: 'Model', updated_at: '2026-01-02T00:00:00Z', archived: false, run_status: 'idle', ...extra }
}
function props(overrides: Partial<AgentSessionSidebarProps> = {}): AgentSessionSidebarProps {
  return {
    sessions: [session('alpha', { group_id: 'g1' }), session('beta')], groups, disabled: false,
    onCreate: vi.fn(), onSelect: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(),
    onRename: vi.fn().mockResolvedValue(undefined), onPin: vi.fn().mockResolvedValue(undefined),
    onMoveToGroup: vi.fn().mockResolvedValue(undefined), onCreateGroup: vi.fn().mockResolvedValue(undefined),
    onRenameGroup: vi.fn().mockResolvedValue(undefined), onDeleteGroup: vi.fn().mockResolvedValue(undefined),
    onMoveGroup: vi.fn().mockResolvedValue(undefined), onMovePin: vi.fn().mockResolvedValue(undefined), onMoveSession: vi.fn().mockResolvedValue(undefined), onOpenArchives: vi.fn(),
    ...overrides,
  }
}
function renderSidebar(value: AgentSessionSidebarProps) { return render(<AntdApp><AgentSessionSidebar {...value} /></AntdApp>) }
function row(id: string) { return document.querySelector<HTMLElement>(`[data-agent-session-id="${id}"]`)! }
function grip(id: string) { return within(row(id)).getByRole('button', { name: 'agent.sessions.dragSession' }) }
function group(id: string) { return document.querySelector<HTMLElement>(`[data-agent-session-group="${id}"]`)! }
async function openRowMenu(id: string) {
  await userEvent.click(within(row(id)).getByRole('button', { name: 'agent.sessions.more' }))
}
function transfer() { return { setData: vi.fn(), getData: vi.fn().mockReturnValue('alpha'), setDragImage: vi.fn(), effectAllowed: '', dropEffect: '' } }

describe('AgentSessionSidebar', () => {
  it('置顶只显示一次并保留归属，普通会话固定手动顺序且省去提供方和时间', () => {
    renderSidebar(props({ sessions: [
      session('pinned', { group_id: 'g1', pinned: true }),
      session('old', { group_id: 'g1', sort_order: 20, model_alias: 'Fast', provider_name: 'Provider', updated_at: '2026-05-01T00:00:00Z', last_activity_at: '2026-01-01T00:00:00Z' }),
      session('recent', { group_id: 'g1', sort_order: 10, last_activity_at: '2026-03-01T00:00:00Z' }),
    ] }))
    expect(screen.getAllByText('pinned')).toHaveLength(1)
    expect(within(group('$pinned')).getByText('Ops')).toBeInTheDocument()
    expect(within(group('g1')).getAllByRole('listitem').map((item) => item.dataset.agentSessionId)).toEqual(['old', 'recent'])
    expect(within(row('old')).getByText('Fast')).toBeInTheDocument()
    expect(within(row('old')).queryByText('Provider')).not.toBeInTheDocument()
    expect(row('old').querySelector('time')).toBeNull()
  })

  it('运行中可以右键改名，IME 不误提交且取消后不选择会话', async () => {
    const value = props({ sessions: [session('alpha', { run_status: 'running' })] })
    renderSidebar(value)
    fireEvent.contextMenu(row('alpha'))
    expect(await screen.findByRole('menuitem', { name: 'agent.sessions.archive' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'app.delete' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getByRole('menuitem', { name: 'agent.sessions.rename' }))
    const input = screen.getByRole('textbox', { name: 'agent.sessions.rename' })
    fireEvent.change(input, { target: { value: '新的标题' } })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 })
    expect(value.onRename).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'agent.sessions.rename' })).not.toBeInTheDocument()
    expect(value.onSelect).not.toHaveBeenCalled()
  })

  it('改名校验 UTF-8 字节，服务失败保留草稿并允许重试', async () => {
    const onRename = vi.fn().mockRejectedValueOnce(new Error('conflict')).mockResolvedValue(undefined)
    renderSidebar(props({ onRename }))
    await openRowMenu('alpha')
    await userEvent.click(screen.getByRole('menuitem', { name: 'agent.sessions.rename' }))
    const input = screen.getByRole('textbox', { name: 'agent.sessions.rename' })
    fireEvent.change(input, { target: { value: '中'.repeat(67) } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByText('agent.sessions.invalidName')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '  保留我的标题  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('agent.sessions.operationFailed')).toBeInTheDocument())
    expect(input).toHaveValue('  保留我的标题  ')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'agent.sessions.rename' })).not.toBeInTheDocument())
    expect(onRename).toHaveBeenLastCalledWith('alpha', '保留我的标题')
  })

  it('单行请求不禁用其他会话，归档入口独立可用', async () => {
    let finish!: () => void
    const value = props({ onPin: vi.fn(() => new Promise<void>((resolve) => { finish = resolve })) })
    renderSidebar(value)
    await openRowMenu('alpha')
    await userEvent.click(screen.getByRole('menuitem', { name: 'agent.sessions.pin' }))
    expect(within(row('alpha')).getByRole('button', { name: 'agent.sessions.more' })).toBeDisabled()
    expect(within(row('beta')).getByRole('button', { name: 'agent.sessions.more' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'agent.sessions.new' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'agent.archives.title' }))
    expect(value.onOpenArchives).toHaveBeenCalledOnce()
    await act(async () => finish())
  })

  it('A 改名回执只关闭 A 编辑器，不打断 B 正在输入的标题', async () => {
    let finish!: () => void
    const value = props({ onRename: vi.fn(() => new Promise<void>((resolve) => { finish = resolve })) })
    renderSidebar(value)
    await openRowMenu('alpha')
    await userEvent.click(screen.getByRole('menuitem', { name: 'agent.sessions.rename' }))
    const first = within(row('alpha')).getByRole('textbox')
    fireEvent.change(first, { target: { value: 'A 的标题' } })
    fireEvent.keyDown(first, { key: 'Enter' })
    await openRowMenu('beta')
    await userEvent.click(screen.getByRole('menuitem', { name: 'agent.sessions.rename' }))
    const second = within(row('beta')).getByRole('textbox')
    fireEvent.change(second, { target: { value: 'B 尚未提交的标题' } })
    second.focus()
    await act(async () => finish())
    await act(async () => { await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())) })
    expect(within(row('alpha')).queryByRole('textbox')).not.toBeInTheDocument()
    expect(second).toHaveValue('B 尚未提交的标题')
    expect(second).toBeInTheDocument()
    expect(second).toHaveFocus()
    expect(value.onRename).toHaveBeenCalledTimes(1)
  })

  it('折叠偏好跨卸载保存，选中会话移组后展开目标组', async () => {
    const value = props()
    const view = renderSidebar(value)
    await userEvent.click(within(group('g2')).getByRole('button', { expanded: true }))
    expect(JSON.parse(localStorage.getItem(sessionSidebarStorageKey)!)).toContain('g2')
    view.unmount()
    const second = renderSidebar(value)
    expect(within(group('g2')).getByRole('button', { expanded: false })).toBeInTheDocument()
    second.rerender(<AntdApp><AgentSessionSidebar {...value} selectedSessionId="alpha" sessions={[session('alpha', { group_id: 'g2' })]} /></AntdApp>)
    await waitFor(() => expect(within(group('g2')).getByRole('button', { expanded: true })).toBeInTheDocument())
    expect(row('alpha')).toBeInTheDocument()
  })

  it('移组拖动拒绝外部文本，接受内部会话到折叠或空分组', async () => {
    const value = props()
    renderSidebar(value)
    const dataTransfer = transfer()
    fireEvent.drop(group('g2'), { dataTransfer })
    expect(value.onMoveToGroup).not.toHaveBeenCalled()
    await userEvent.click(within(group('g2')).getByRole('button', { expanded: true }))
    fireEvent.dragStart(grip('alpha'), { dataTransfer })
    expect(group('$pinned')).toBeNull()
    expect(screen.getByText('agent.sessions.pinDropTarget')).toBeInTheDocument()
    fireEvent.dragOver(group('g2'), { dataTransfer })
    expect(group('g2')).toHaveAttribute('data-drop-active', 'true')
    fireEvent.drop(group('g2'), { dataTransfer })
    await waitFor(() => expect(value.onMoveToGroup).toHaveBeenCalledWith('alpha', 'g2', true))
  })

  it('置顶会话和分组分别排序，分组标题拖动保留折叠状态并继续响应点击', async () => {
    const value = props({ sessions: [session('p1', { pinned: true, pin_order: 0 }), session('p2', { pinned: true, pin_order: 1 })] })
    renderSidebar(value)
    const dataTransfer = transfer()
    fireEvent.dragStart(grip('p1'), { dataTransfer })
    fireEvent.drop(row('p2'), { dataTransfer, clientY: 10 })
    await waitFor(() => expect(value.onMoveSession).toHaveBeenCalledWith('p1', 'p2', 'after'))
    const groupTitle = within(group('g1')).getByRole('button', { expanded: true })
    await userEvent.click(groupTitle)
    expect(groupTitle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.dragStart(groupTitle, { dataTransfer })
    fireEvent.drop(group('g2'), { dataTransfer, clientY: 10 })
    await waitFor(() => expect(value.onMoveGroup).toHaveBeenCalledWith('g1', 'g2', 'after'))
    expect(groupTitle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(groupTitle)
    expect(groupTitle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.dragStart(within(group('g1')).getByRole('button', { name: 'agent.sessions.groupActions' }), { dataTransfer })
    fireEvent.drop(group('g2'), { dataTransfer, clientY: 10 })
    expect(value.onMoveGroup).toHaveBeenCalledOnce()
    await openRowMenu('p2')
    await userEvent.click(screen.getByRole('menuitem', { name: 'agent.sessions.moveUp' }))
    await waitFor(() => expect(value.onMoveSession).toHaveBeenCalledWith('p2', 'p1', 'before'))
  })

  it('受控搜索使用独立结果并禁拖排序，加载失败可以重试', async () => {
    const value = props({ searchQuery: 'remote', searchResults: [session('remote', { group_id: 'g2', pinned: true })], onSearchQueryChange: vi.fn(), onSearchRetry: vi.fn() })
    const view = renderSidebar(value)
    expect(row('alpha')).toBeNull()
    expect(grip('remote')).toHaveAttribute('draggable', 'false')
    expect(grip('remote')).toBeDisabled()
    expect(within(row('remote')).getByText('Triage')).toBeInTheDocument()
    await openRowMenu('remote')
    expect(await screen.findByRole('menuitem', { name: 'agent.sessions.moveUp' })).toHaveAttribute('aria-disabled', 'true')
    view.rerender(<AntdApp><AgentSessionSidebar {...value} searchError="offline" /></AntdApp>)
    await userEvent.click(screen.getByRole('button', { name: 'agent.sessions.retry' }))
    expect(value.onSearchRetry).toHaveBeenCalledOnce()
  })

  it('组内新会话与解散确认保持独立语义', async () => {
    const value = props()
    renderSidebar(value)
    await userEvent.click(within(group('g1')).getByRole('button', { name: 'agent.sessions.groupActions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'agent.sessions.newInGroup' }))
    expect(value.onCreate).toHaveBeenCalledWith('g1')
    await userEvent.click(within(group('g1')).getByRole('button', { name: 'agent.sessions.groupActions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'agent.sessions.dissolveGroup' }))
    expect(value.onDeleteGroup).not.toHaveBeenCalled()
    expect(screen.getByText('agent.sessions.dissolveGroupDescription')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'agent.sessions.dissolveGroup' }))
    await waitFor(() => expect(value.onDeleteGroup).toHaveBeenCalledWith('g1'))
    expect(value.onDelete).not.toHaveBeenCalled()
  })

  it('普通会话通过抓手排序并提供上下移动，正文点击只负责选择', async () => {
    const value = props({ sessions: [session('alpha', { sort_order: 20 }), session('beta', { sort_order: 10 })] })
    renderSidebar(value)
    expect(row('alpha')).not.toHaveAttribute('draggable')
    await userEvent.click(within(row('alpha')).getByRole('button', { name: /alpha\s*Model/ }))
    expect(value.onSelect).toHaveBeenCalledWith('alpha')
    await openRowMenu('beta')
    await userEvent.click(screen.getByRole('menuitem', { name: 'agent.sessions.moveUp' }))
    await waitFor(() => expect(value.onMoveSession).toHaveBeenCalledWith('beta', 'alpha', 'before'))
    const dataTransfer = transfer()
    fireEvent.dragStart(grip('alpha'), { dataTransfer })
    fireEvent.drop(row('beta'), { dataTransfer, clientY: 10 })
    await waitFor(() => expect(value.onMoveSession).toHaveBeenCalledWith('alpha', 'beta', 'after'))
    expect(value.onSelect).toHaveBeenCalledOnce()
  })

  it('新建分组使用弹窗并在成功后关闭，不选择或创建会话', async () => {
    const value = props()
    renderSidebar(value)
    await userEvent.click(screen.getByRole('button', { name: 'agent.sessions.createGroup' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'agent.sessions.groupName' }), { target: { value: '  发布排查  ' } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'agent.sessions.createGroupSubmit' }))
    await waitFor(() => expect(value.onCreateGroup).toHaveBeenCalledWith('发布排查'))
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'))
    expect(value.onCreate).not.toHaveBeenCalled()
    expect(value.onSelect).not.toHaveBeenCalled()
  })
})

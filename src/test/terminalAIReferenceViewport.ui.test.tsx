import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as AntdApp, ConfigProvider } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import { ShortcutRuntime, ShortcutRuntimeContextProvider, compileShortcutIndex } from '#entities/shortcuts'
import { TerminalPaneViewport } from '../features/terminal/ui/TerminalPaneViewport'
import { TerminalCompletionRuntime } from '../features/terminal/model/terminalCompletionRuntime'
import type { TerminalAIReferenceSnapshot } from '../features/terminal/model/terminalAIReference'
import type { TerminalContextSnapshot } from '../features/terminal/model/terminalContextTarget'
import { TerminalRuntimeContext, type TerminalRuntimeContextValue } from '../features/terminal/runtime/terminalRuntimeContext'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../features/terminal/runtime/terminalCwdContext', () => ({ useSessionCwdState: () => null }))

function fixture(options: { selection?: string; local?: boolean; canReference?: boolean; ready?: boolean } = {}) {
  const completion = new TerminalCompletionRuntime()
  const source = { host_id: 'host-1', host_name: '生产', ssh_profile_id: 'ssh-1', ssh_profile_name: '默认', started_at: '2026-09-09T00:00:00Z' }
  const reference: TerminalAIReferenceSnapshot = { canReference: options.canReference ?? true, ready: options.ready ?? true, source, targets: [
    { session_id: 'older', title: '较早排查', last_activity_at: '2026-09-01T00:00:00Z' },
    { session_id: 'recent', title: '最新排查', last_activity_at: '2026-09-09T00:00:00Z' },
    { session_id: 'pinned', title: '置顶排查', pinned: true },
    { session_id: 'locked', title: '锁定会话', disabled: true, disabled_reason: 'binding_locked' },
  ] }
  const snapshot: TerminalContextSnapshot = { sessionId: 's1', selectionText: options.selection ?? '  first line\n\tsecond line  ', searchSeed: '', target: null, mouseTrackingMode: 'none', writable: true, disconnected: false }
  const onReferenceTerminalSelection = vi.fn()
  const getAgentReferenceSnapshot = vi.fn(() => reference)
  const noSubscription = () => () => undefined
  const inputLock = { locked: false }
  const runtime = {
    aiCompletionEnabled: false, captureSessionAiInput: () => null,
    getDefaultModelStatus: async () => ({ available: false, reason: 'not_configured' }),
    registerViewport: noSubscription, focusActive: vi.fn(), focusSession: vi.fn(),
    subscribeSessionCompletion: (_id: string, listener: () => void) => completion.subscribe('s1', listener),
    getSessionCompletionSnapshot: () => completion.getSnapshot('s1'),
    subscribeSessionInputLock: noSubscription, getSessionInputLockSnapshot: () => inputLock,
    subscribeSessionCompletionLayout: noSubscription, captureSessionCompletionCursor: () => null,
    setViewportCompletionActive: vi.fn(), setViewportCompletionVisible: vi.fn(),
    closeSessionCompletion: () => completion.closeSuggestions('s1'),
    captureSessionContext: () => ({ ...snapshot }), clearSessionContextSelection: vi.fn(),
  } as unknown as TerminalRuntimeContextValue
  const shortcuts = new ShortcutRuntime({ index: compileShortcutIndex({}, 'win32') })
  // jsdom 不会完成 CSS 入场动画；仅关闭视觉动画，保留菜单悬停收起的真实定时器。
  const view = render(<ConfigProvider theme={{ token: { motion: false } }}><AntdApp>
    <ShortcutRuntimeContextProvider value={{ runtime: shortcuts, platform: 'win32', labels: new Map(), bindingSignatures: new Map() }}>
      <TerminalRuntimeContext.Provider value={runtime}>
        <TerminalPaneViewport paneId="p1" session={{ id: 's1', kind: options.local ? 'local' : 'ssh', origin: 'app', status: 'connected', started_at: source.started_at, pty_cols: 80, pty_rows: 24 }} active workspaceActive themeMode="dark" placeholder="Terminal" onActivate={() => undefined}
          getAgentReferenceSnapshot={getAgentReferenceSnapshot} onReferenceTerminalSelection={onReferenceTerminalSelection} />
      </TerminalRuntimeContext.Provider>
    </ShortcutRuntimeContextProvider>
  </AntdApp></ConfigProvider>)
  const open = () => fireEvent.contextMenu(view.container.querySelector('[data-terminal-pane-frame]')!, { clientX: 80, clientY: 90 })
  const openSubmenu = async () => {
    open()
    await userEvent.hover(await screen.findByRole('menuitem', { name: /terminal.contextMenu.referenceSelection/ }))
    return screen.findByRole('textbox', { name: 'terminal.aiReference.search' })
  }
  return { ...view, open, openSubmenu, reference, snapshot, runtime, onReferenceTerminalSelection }
}

describe('SSH 终端选区引用子菜单', () => {
  it('二级菜单独立 Portal 可搜索并点击，引用使用打开菜单时冻结的原文、来源和目标', async () => {
    const user = userEvent.setup()
    const f = fixture()
    const originalSource = { ...f.reference.source! }
    const search = await f.openSubmenu()
    const popup = search.closest('.ant-dropdown-menu-submenu-popup')!
    expect(popup).toHaveClass('termous-terminal-context-menu-popup')
    expect(within(popup as HTMLElement).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'terminal.aiReference.newSession', '置顶排查', '最新排查', '较早排查', '锁定会话terminal.aiReference.binding_locked',
    ])
    f.snapshot.selectionText = 'changed selection'
    f.reference.source!.host_name = 'changed host'
    f.reference.source!.started_at = '2026-09-10T00:00:00Z'
    f.reference.targets[1].disabled = true
    await user.click(search)
    await user.type(search, '最新')
    expect(search).toHaveFocus()
    expect(screen.queryByRole('menuitem', { name: '较早排查' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: '最新排查' }))
    expect(f.onReferenceTerminalSelection).toHaveBeenCalledOnce()
    expect(f.onReferenceTerminalSelection).toHaveBeenCalledWith({
      target: { kind: 'session', session_id: 'recent' }, sourceSessionId: 's1',
      selectionText: '  first line\n\tsecond line  ', source: originalSource, capturedAt: expect.any(String),
    })
    expect(Number.isFinite(Date.parse(f.onReferenceTerminalSelection.mock.calls[0][0].capturedAt))).toBe(true)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(f.runtime.focusActive).not.toHaveBeenCalled()
    expect(f.runtime.focusSession).not.toHaveBeenCalled()
  })

  it('新会话和禁止更换关联的目标分别处理，禁用项展示原因且不能触发引用', async () => {
    const user = userEvent.setup()
    const f = fixture()
    await f.openSubmenu()
    const locked = screen.getByRole('menuitem', { name: /锁定会话/ })
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    expect(locked).toHaveTextContent('terminal.aiReference.binding_locked')
    await user.click(locked)
    expect(f.onReferenceTerminalSelection).not.toHaveBeenCalled()
    await user.click(screen.getByRole('menuitem', { name: 'terminal.aiReference.newSession' }))
    expect(f.onReferenceTerminalSelection).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'new' } }))
    expect(f.runtime.focusSession).not.toHaveBeenCalled()
  })

  it('搜索无结果仍可新建会话，输入法 Escape 不取消，普通 Escape 关闭并归焦', async () => {
    const user = userEvent.setup()
    const f = fixture()
    const search = await f.openSubmenu()
    await user.click(search)
    await user.type(search, '不存在')
    expect(search).toHaveFocus()
    expect(screen.getByRole('menuitem', { name: 'terminal.aiReference.noMatches' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'terminal.aiReference.newSession' })).not.toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(search, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(search, { key: 'Escape', keyCode: 229 })
    expect(f.runtime.focusSession).not.toHaveBeenCalled()
    expect(search).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(f.runtime.focusSession).toHaveBeenCalledExactlyOnceWith('s1')
    expect(f.onReferenceTerminalSelection).not.toHaveBeenCalled()
  })

  it('搜索过滤后鼠标离开重新定位的浮层仍保持输入，菜单项左方向键可正常收起', async () => {
    const user = userEvent.setup()
    const f = fixture()
    const search = await f.openSubmenu()
    await user.click(search)
    await user.type(search, 'i')
    await user.hover(f.container)
    // 覆盖菜单库 100ms 的悬停收起延迟，不能只检查事件刚发生时的展开状态。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)) })
    expect(search).toHaveFocus()
    expect(screen.getByRole('menuitem', { name: /terminal.contextMenu.referenceSelection/ })).toHaveAttribute('aria-expanded', 'true')
    expect(search).toBeVisible()
    expect(search).toHaveValue('i')
    await user.clear(search)
    await user.type(search, '最新')
    expect(screen.getByRole('menuitem', { name: '最新排查' })).toBeVisible()
    await user.keyboard('{ArrowDown}')
    const create = screen.getByRole('menuitem', { name: 'terminal.aiReference.newSession' })
    expect(create).toHaveFocus()
    // rc-menu 的方向键读取 which；userEvent 不补该旧字段，需提供浏览器实际键值。
    fireEvent.keyDown(create, { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 })
    await waitFor(() => expect(search).not.toBeVisible())
    expect(screen.getByRole('menuitem', { name: /terminal.contextMenu.referenceSelection/ })).toBeVisible()
    expect(f.onReferenceTerminalSelection).not.toHaveBeenCalled()
  })

  it('菜单省略文字使用统一 Tooltip，完整文字不弹提示且不残留原生 title', async () => {
    const user = userEvent.setup()
    const f = fixture()
    f.open()
    const label = screen.getByText('terminal.contextMenu.copy')
    expect(label).not.toHaveAttribute('title')
    Object.defineProperties(label, { scrollWidth: { configurable: true, value: 60 }, clientWidth: { value: 80 } })
    await user.hover(label)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.unhover(label)
    Object.defineProperty(label, 'scrollWidth', { value: 180 })
    await user.hover(label)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('terminal.contextMenu.copy')
    expect(tooltip.closest('.termous-tooltip')).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'terminal.contextMenu.copy' })).toBeVisible()
    await user.unhover(label)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('点击外部仍可关闭聚焦中的搜索菜单', async () => {
    const user = userEvent.setup()
    const f = fixture()
    const search = await f.openSubmenu()
    await user.click(search)
    await user.type(search, 'i')
    await user.click(f.container)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(f.onReferenceTerminalSelection).not.toHaveBeenCalled()
  })

  it('搜索输入的 Enter 不误选目标，方向键进入子菜单后可用 Enter 确认', async () => {
    const f = fixture()
    const search = await f.openSubmenu()
    search.focus()
    fireEvent.keyDown(search, { key: 'Enter', keyCode: 13 })
    expect(f.onReferenceTerminalSelection).not.toHaveBeenCalled()
    fireEvent.keyDown(search, { key: 'ArrowDown', keyCode: 40 })
    const create = screen.getByRole('menuitem', { name: 'terminal.aiReference.newSession' })
    expect(create).toHaveFocus()
    fireEvent.keyDown(create, { key: 'Enter', keyCode: 13 })
    expect(f.onReferenceTerminalSelection).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ target: { kind: 'new' } }))
  })

  it.each([{ local: true }, { selection: '' }])('没有 SSH 真实选区时不展示引用入口：%j', (options) => {
    const f = fixture(options)
    f.open()
    expect(screen.queryByRole('menuitem', { name: /terminal.contextMenu.referenceSelection/ })).not.toBeInTheDocument()
  })

  it('来源未就绪时引用入口禁用，目标快照未就绪时不允许新建或引用', async () => {
    const f = fixture({ canReference: false })
    f.open()
    const unavailable = screen.getByRole('menuitem', { name: /terminal.contextMenu.referenceSelection/ })
    expect(unavailable).toHaveAttribute('aria-disabled', 'true')
    expect(unavailable).toHaveTextContent('terminal.aiReference.sourceUnavailable')
    f.unmount()
    const loading = fixture({ ready: false })
    await loading.openSubmenu()
    expect(screen.getByRole('menuitem', { name: 'terminal.aiReference.loading' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'terminal.aiReference.newSession' })).toHaveAttribute('aria-disabled', 'true')
    expect(loading.onReferenceTerminalSelection).not.toHaveBeenCalled()
  })
})

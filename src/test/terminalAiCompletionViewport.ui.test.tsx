import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalAICompletionRequest, TerminalAICompletionResult } from '#common/contracts'
import { ShortcutRuntime, ShortcutRuntimeContextProvider, compileShortcutIndex } from '#entities/shortcuts'
import { TerminalPaneViewport } from '../features/terminal/ui/TerminalPaneViewport'
import { TerminalCompletionRuntime } from '../features/terminal/model/terminalCompletionRuntime'
import { TerminalRuntimeContext, type TerminalRuntimeContextValue } from '../features/terminal/runtime/terminalRuntimeContext'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../features/terminal/runtime/terminalCwdContext', () => ({ useSessionCwdState: () => null }))

const boundary = { source_generation: 1, shell_id: 'bash', prompt_generation: 1, shell: 'bash', cwd: '/', input_epoch: 1 }
const session = { id: 's1', kind: 'ssh' as const, origin: 'app' as const, status: 'connected' as const, started_at: '2026-09-08T00:00:00Z', pty_cols: 80, pty_rows: 24 }

function fixture(enabled = true) {
  const completion = new TerminalCompletionRuntime()
  completion.applyPromptBoundary('s1', boundary)
  const pending: { request: TerminalAICompletionRequest; resolve: (result: TerminalAICompletionResult) => void }[] = []
  const generate = vi.fn((request: TerminalAICompletionRequest) => new Promise<TerminalAICompletionResult>((resolve) => pending.push({ request, resolve })))
  const cancel = vi.fn(async () => undefined)
  Object.defineProperty(window, 'termous', { configurable: true, value: { terminalAICompletion: { generate, cancel } } })
  const noSubscription = () => () => undefined
  const layoutListeners = new Set<() => void>()
  const inputLock = { locked: false }
  const runtime = {
    aiCompletionEnabled: enabled,
    captureSessionAiInput: () => completion.captureAiInput('s1'),
    setSessionAiCompletionOpen: (_id: string, open: boolean) => completion.setSuggestionsPaused('s1', open),
    acceptSessionAiCompletion: vi.fn(() => 'sent'),
    getDefaultModelStatus: async () => ({ available: true, model_id: 'm1', model_name: 'Default model', provider_name: 'Provider' }),
    registerViewport: noSubscription, focusActive: vi.fn(), focusSession: vi.fn(), resizeSession: vi.fn(),
    subscribeSessionCompletion: (_id: string, listener: () => void) => completion.subscribe('s1', listener),
    getSessionCompletionSnapshot: () => completion.getSnapshot('s1'),
    subscribeSessionInputLock: noSubscription, getSessionInputLockSnapshot: () => inputLock,
    subscribeSessionCompletionLayout: (_id: string, listener: () => void) => {
      layoutListeners.add(listener)
      return () => { layoutListeners.delete(listener) }
    },
    captureSessionCompletionCursor: vi.fn(() => ({ screenRect: { left: 0, top: 0, width: 800, height: 600 }, cursorX: 2, cursorY: 1, columns: 80, rows: 24 })),
    setViewportCompletionActive: vi.fn(), setViewportCompletionVisible: vi.fn(),
    closeSessionCompletion: () => completion.closeSuggestions('s1'),
    clearSessionContextSelection: vi.fn(), copyText: vi.fn(async () => 'copied'),
  } as unknown as TerminalRuntimeContextValue
  const shortcuts = new ShortcutRuntime({ index: compileShortcutIndex({}, 'win32') })
  const tree = (active = true) => <AntdApp>
    <ShortcutRuntimeContextProvider value={{ runtime: shortcuts, platform: 'win32', labels: new Map(), bindingSignatures: new Map() }}>
      <TerminalRuntimeContext.Provider value={runtime}>
        <TerminalPaneViewport paneId="p1" session={session} active={active} workspaceActive themeMode="dark" placeholder="Terminal" onActivate={() => undefined} />
      </TerminalRuntimeContext.Provider>
    </ShortcutRuntimeContextProvider>
  </AntdApp>
  const mounted = render(tree())
  const open = async () => {
    fireEvent.keyDown(mounted.container.querySelector('[data-terminal-pane-frame]')!, { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true })
    return screen.findByRole('textbox', { name: 'terminal.aiCompletion.prompt' })
  }
  return { ...mounted, tree, runtime, completion, pending, generate, cancel, open, emitLayout: () => layoutListeners.forEach((listener) => listener()) }
}

describe('AI 命令面板与终端视口集成', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) })
  })

  it('快捷键打开，面板点击和输入不回到终端，填入只调用专用追加入口', async () => {
    const f = fixture()
    const input = await f.open()
    await waitFor(() => expect(screen.getByTitle('Default model')).toBeInTheDocument())
    expect(screen.getByText('terminal.aiCompletion.title')).toBeVisible()
    expect(screen.getByTitle('Default model')).toHaveTextContent('Default model')
    fireEvent.pointerDown(input)
    fireEvent.mouseDown(input)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(f.runtime.focusActive).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '查看当前目录' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(f.generate).toHaveBeenCalledTimes(1)
    await act(async () => f.pending[0].resolve({ ...f.pending[0].request, status: 'completed', command: 'ls -la', description: '列出文件', model: { id: 'm1', name: 'Actual model', providerName: 'Provider' } }))
    expect(screen.getByTitle('Actual model')).toHaveTextContent('Actual model')
    expect(screen.queryByText('Default model')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'terminal.aiCompletion.append' }))
    expect(f.runtime.acceptSessionAiCompletion).toHaveBeenCalledWith('s1', f.pending[0].request.inputSnapshot, 'ls -la')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(f.runtime.focusSession).toHaveBeenCalledWith('s1')
  })

  it('切换分屏取消在途生成，迟到结果不能显示', async () => {
    const f = fixture()
    const input = await f.open()
    await waitFor(() => expect(screen.getByTitle('Default model')).toBeInTheDocument())
    fireEvent.change(input, { target: { value: '查看当前目录' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    f.rerender(f.tree(false))
    await waitFor(() => expect(f.cancel).toHaveBeenCalledTimes(1))
    await act(async () => f.pending[0].resolve({ ...f.pending[0].request, status: 'completed', command: 'ls', description: '列出文件', model: { id: 'm1', name: 'Actual model', providerName: 'Provider' } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(f.runtime.acceptSessionAiCompletion).not.toHaveBeenCalled()
  })

  it.each(['Enter', '双击'] as const)('新生成追加到列表，上下键选旧命令后 %s 只填入所选项并返回终端', async (submitMethod) => {
    const f = fixture()
    const input = await f.open()
    await waitFor(() => expect(screen.getByTitle('Default model')).toBeInTheDocument())
    for (const command of ['ls -la', 'pwd']) {
      fireEvent.change(input, { target: { value: command === 'pwd' ? '查看目录位置' : '列出文件' } })
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
      const pending = f.pending[f.pending.length - 1]
      await act(async () => pending.resolve({ ...pending.request, status: 'completed', command, description: '命令说明', model: { id: 'm1', name: 'Actual model', providerName: 'Provider' } }))
    }
    expect(screen.getAllByRole('option')).toHaveLength(2)
    const list = screen.getByRole('listbox')
    fireEvent.keyDown(list, { key: 'ArrowUp', code: 'ArrowUp' })
    if (submitMethod === 'Enter') {
      fireEvent.keyDown(list, { key: 'Enter', code: 'Enter' })
    } else {
      fireEvent.doubleClick(screen.getByRole('option', { selected: true }))
    }
    expect(f.runtime.acceptSessionAiCompletion).toHaveBeenCalledWith('s1', f.pending[0].request.inputSnapshot, 'ls -la')
    expect(f.runtime.acceptSessionAiCompletion).toHaveBeenCalledTimes(1)
    expect(f.generate).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(f.runtime.focusSession).toHaveBeenCalledWith('s1')
  })

  it('生成中可填入旧候选并取消新请求，迟到结果不能再次出现', async () => {
    const f = fixture()
    const input = await f.open()
    await waitFor(() => expect(screen.getByTitle('Default model')).toBeInTheDocument())
    fireEvent.change(input, { target: { value: '查看目录' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await act(async () => f.pending[0].resolve({ ...f.pending[0].request, status: 'completed', command: 'ls', description: '命令说明', model: { id: 'm1', name: 'Actual model', providerName: 'Provider' } }))
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(f.generate).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter', code: 'Enter' })
    expect(f.runtime.acceptSessionAiCompletion).toHaveBeenCalledWith('s1', f.pending[0].request.inputSnapshot, 'ls')
    expect(f.cancel).toHaveBeenCalledTimes(1)
    await act(async () => f.pending[1].resolve({ ...f.pending[1].request, status: 'completed', command: 'pwd', description: '命令说明', model: { id: 'm1', name: 'Actual model', providerName: 'Provider' } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(f.runtime.acceptSessionAiCompletion).toHaveBeenCalledTimes(1)
  })

  it('Esc 关闭并归还焦点；关闭设置时快捷键不截获', async () => {
    const f = fixture()
    const input = await f.open()
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(f.runtime.focusSession).toHaveBeenCalledWith('s1')
    f.unmount()
    const disabled = fixture(false)
    const event = new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    fireEvent(disabled.container.querySelector('[data-terminal-pane-frame]')!, event)
    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('生成期间点击外部不取消，焦点移出后 Esc 退出且不送到终端', async () => {
    const f = fixture()
    const input = await f.open()
    await waitFor(() => expect(screen.getByTitle('Default model')).toBeInTheDocument())
    fireEvent.change(input, { target: { value: '查看目录' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const frame = f.container.querySelector('[data-terminal-pane-frame]')!
    fireEvent.pointerDown(document.body)
    fireEvent.pointerDown(frame)
    fireEvent.mouseDown(frame)
    expect(input).toHaveValue('查看目录')
    expect(f.cancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    render(<button type="button">外部按钮</button>)
    const outside = screen.getByRole('button', { name: '外部按钮' })
    fireEvent.pointerDown(outside)
    outside.focus()
    fireEvent.keyDown(outside, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(outside, { key: 'Escape', keyCode: 229 })
    expect(f.cancel).not.toHaveBeenCalled()
    const forwarded = vi.fn()
    outside.addEventListener('keydown', forwarded)
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    fireEvent(outside, escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(forwarded).not.toHaveBeenCalled()
    expect(f.cancel).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(f.runtime.focusSession).toHaveBeenCalledWith('s1')
    await act(async () => f.pending[0].resolve({ ...f.pending[0].request, status: 'completed', command: 'ls', description: '列出文件', model: { id: 'm1', name: 'Model', providerName: 'Provider' } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('结果不因点击外部、选中或复制而关闭，关闭按钮仍可退出', async () => {
    const f = fixture()
    const input = await f.open()
    await waitFor(() => expect(screen.getByTitle('Default model')).toBeInTheDocument())
    fireEvent.change(input, { target: { value: '查看目录' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(async () => f.pending[0].resolve({ ...f.pending[0].request, status: 'completed', command: 'ls', description: '列出文件', model: { id: 'm1', name: 'Model', providerName: 'Provider' } }))
    fireEvent.pointerDown(document.body)
    fireEvent.click(screen.getByRole('option'))
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true')
    expect(f.runtime.acceptSessionAiCompletion).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'terminal.aiCompletion.copy' })))
    expect(f.runtime.copyText).toHaveBeenCalledWith('ls')
    expect(screen.getByRole('option')).toHaveTextContent('ls')
    fireEvent.click(screen.getByRole('button', { name: 'terminal.aiCompletion.close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(f.runtime.focusSession).toHaveBeenCalledWith('s1')
  })

  it('外部弹窗优先处理自己的 Esc，不误关闭 AI 面板', async () => {
    const f = fixture()
    await f.open()
    render(<div role="dialog" aria-label="其他弹窗"><button type="button">弹窗按钮</button></div>)
    const button = screen.getByRole('button', { name: '弹窗按钮' })
    fireEvent.pointerDown(button)
    button.focus()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    fireEvent(button, escape)
    expect(escape.defaultPrevented).toBe(false)
    expect(screen.getByRole('dialog', { name: 'terminal.aiCompletion.title' })).toBeInTheDocument()
    expect(f.runtime.focusSession).not.toHaveBeenCalled()
  })

  it('光标因滚动历史而不可定位时保留面板与关闭入口', async () => {
    const f = fixture()
    const input = await f.open()
    await waitFor(() => expect(screen.getByTitle('Default model')).toBeInTheDocument())
    fireEvent.change(input, { target: { value: '查看当前目录' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    vi.mocked(f.runtime.captureSessionCompletionCursor).mockReturnValue(null)
    act(f.emitLayout)
    expect(screen.getByRole('dialog')).toHaveStyle({ top: '8px', left: '8px' })
    expect(input).toHaveValue('查看当前目录')
    expect(f.cancel).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' })
    expect(f.cancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('靠近右下光标时按360px宽度夹紧，上方候选增长仍保持底边锚点', async () => {
    const f = fixture()
    vi.mocked(f.runtime.captureSessionCompletionCursor).mockReturnValue({
      screenRect: { left: 0, top: 0, width: 800, height: 600 }, cursorX: 75, cursorY: 22, columns: 80, rows: 24,
    })
    const input = await f.open()
    await waitFor(() => expect(screen.getByTitle('Default model')).toBeInTheDocument())
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-placement', 'above')
    expect(dialog).toHaveStyle({ left: '432px', top: '544px', width: '360px', maxHeight: '320px' })
    fireEvent.change(input, { target: { value: '查看目录' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await act(async () => f.pending[0].resolve({ ...f.pending[0].request, status: 'completed', command: 'ls', description: '列出文件', model: { id: 'm1', name: 'Actual model', providerName: 'Provider' } }))
    expect(dialog).toHaveStyle({ top: '544px', maxHeight: '320px' })
    expect(screen.getByRole('listbox')).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape', code: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(f.runtime.focusSession).toHaveBeenCalledWith('s1')
  })

  it('短分屏回退到 pane 内，抬头和输入栏也放不下时取消并关闭', async () => {
    const f = fixture()
    const input = await f.open()
    await waitFor(() => expect(screen.getByTitle('Default model')).toBeInTheDocument())
    fireEvent.change(input, { target: { value: '查看当前目录' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    const rect = HTMLElement.prototype.getBoundingClientRect()
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ ...rect, height: 136, bottom: 136 })
    act(f.emitLayout)
    expect(screen.getByRole('dialog')).toHaveStyle({ top: '8px', maxHeight: '120px' })
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ ...rect, height: 100, bottom: 100 })
    act(f.emitLayout)
    expect(screen.getByRole('dialog')).toHaveStyle({ top: '8px', maxHeight: '84px' })
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ ...rect, height: 90, bottom: 90 })
    act(f.emitLayout)
    expect(screen.getByRole('dialog')).toHaveStyle({ top: '8px', maxHeight: '74px' })
    expect(screen.getByRole('button', { name: 'terminal.aiCompletion.close' })).toBeEnabled()
    expect(f.cancel).not.toHaveBeenCalled()
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ ...rect, height: 89, bottom: 89 })
    act(f.emitLayout)
    expect(f.cancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

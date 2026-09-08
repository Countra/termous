import { act, fireEvent, render, screen } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { createRef, useEffect, useRef, type RefObject } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '#entities/session'
import { defaultCompletionSettings, defaultTerminalSettings } from '#entities/settings'
import { ShortcutRuntime, ShortcutRuntimeContextProvider, compileShortcutIndex } from '#entities/shortcuts'
import type { TerminalGateway } from '../api/terminalGateway'
import type { TerminalTransportOptions } from '../model/terminalTransport'
import { TerminalRuntimeProvider } from './TerminalRuntimeProvider'
import { useTerminalRuntime, type TerminalRuntimeContextValue } from './terminalRuntimeContext'

const terminalMock = vi.hoisted(() => ({ focus: vi.fn() }))
const transportMock = vi.hoisted(() => ({
  onEvent: null as TerminalTransportOptions['onEvent'] | null,
  sendInput: vi.fn<(data: Uint8Array) => boolean>().mockReturnValue(true),
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('@xterm/xterm', () => {
  const subscription = () => ({ dispose() {} })
  return {
    Terminal: class {
      options = {}
      cols = 80
      rows = 24
      buffer = { active: { type: 'normal', cursorX: 0, cursorY: 0 }, onBufferChange: subscription }
      focus = terminalMock.focus
      loadAddon() {}
      open() {}
      dispose() {}
      attachCustomKeyEventHandler() {}
      onData = subscription
      onBinary = subscription
      onWriteParsed = subscription
      onResize = subscription
      onScroll = subscription
    },
  }
})
vi.mock('../model/terminalTransport', () => ({
  TerminalTransport: class {
    constructor(options: TerminalTransportOptions) { transportMock.onEvent = options.onEvent }
    start() {}
    dispose() {}
    isLive() { return true }
    sendInput = transportMock.sendInput
    sendResize() {}
  },
}))

function Viewport({ runtimeRef }: { runtimeRef: RefObject<TerminalRuntimeContextValue | null> }) {
  const runtime = useTerminalRuntime()
  const { registerViewport } = runtime
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => { runtimeRef.current = runtime }, [runtime, runtimeRef])
  useEffect(() => registerViewport({
    viewportId: 'p1', sessionId: 's1', host: host.current, active: true,
  }), [registerViewport])
  return <><div ref={host} /><textarea aria-label="AI 需求" /></>
}

describe('AI 面板打开期间的终端自动焦点', () => {
  it('已经排队的布局与会话刷新不能夺走 AI 输入焦点，显式归焦仍可用', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let sequence = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++sequence, callback)
      return sequence
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
    const flushLayout = () => {
      const current = Array.from(frames.values())
      frames.clear()
      current.forEach((callback) => callback(0))
    }
    terminalMock.focus.mockClear()
    const runtimeRef = createRef<TerminalRuntimeContextValue>()
    const api = { websocketUrl: (path: string) => `ws://localhost${path}` } as TerminalGateway
    const shortcuts = new ShortcutRuntime({ index: compileShortcutIndex({}, 'win32') })
    const session: Session = { id: 's1', kind: 'ssh', origin: 'app', status: 'connected', started_at: '2026-09-08T00:00:00Z', pty_cols: 80, pty_rows: 24 }
    const tree = (sessions: Session[]) => <AntdApp>
      <ShortcutRuntimeContextProvider value={{ runtime: shortcuts, platform: 'win32', labels: new Map(), bindingSignatures: new Map() }}>
        <TerminalRuntimeProvider api={api} sessions={sessions} theme="dark" terminalSettings={defaultTerminalSettings} sshSmoothScrollEnabled={false} completionSettings={{ ...defaultCompletionSettings, ai_enabled: true }} terminalFonts={[]}>
          <Viewport runtimeRef={runtimeRef} />
        </TerminalRuntimeProvider>
      </ShortcutRuntimeContextProvider>
    </AntdApp>
    const view = render(tree([session]))
    act(() => runtimeRef.current!.setSessionAiCompletionOpen('s1', true))
    const input = screen.getByRole('textbox', { name: 'AI 需求' })
    input.focus()
    act(flushLayout)
    expect(terminalMock.focus).not.toHaveBeenCalled()
    expect(input).toHaveFocus()

    view.rerender(tree([session, { ...session, id: 's2', status: 'disconnected' }]))
    act(flushLayout)
    expect(terminalMock.focus).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '列出目录' } })
    expect(input).toHaveValue('列出目录')

    act(() => { runtimeRef.current!.focusSession('s1') })
    expect(terminalMock.focus).toHaveBeenCalledTimes(1)
    terminalMock.focus.mockClear()
    act(() => runtimeRef.current!.setSessionAiCompletionOpen('s1', false))
    view.rerender(tree([{ ...session }]))
    act(flushLayout)
    expect(terminalMock.focus).toHaveBeenCalled()
  })

  it('实际填入入口只发送命令后缀，拒绝执行键、旧快照和重复填入', () => {
    const runtimeRef = createRef<TerminalRuntimeContextValue>()
    const api = { websocketUrl: (path: string) => `ws://localhost${path}` } as TerminalGateway
    const shortcuts = new ShortcutRuntime({ index: compileShortcutIndex({}, 'win32') })
    const session: Session = { id: 's1', kind: 'ssh', origin: 'app', status: 'connected', started_at: '2026-09-08T00:00:00Z', pty_cols: 80, pty_rows: 24 }
    render(<AntdApp>
      <ShortcutRuntimeContextProvider value={{ runtime: shortcuts, platform: 'win32', labels: new Map(), bindingSignatures: new Map() }}>
        <TerminalRuntimeProvider api={api} sessions={[session]} theme="dark" terminalSettings={defaultTerminalSettings} sshSmoothScrollEnabled={false} completionSettings={{ ...defaultCompletionSettings, ai_enabled: true }} terminalFonts={[]}>
          <Viewport runtimeRef={runtimeRef} />
        </TerminalRuntimeProvider>
      </ShortcutRuntimeContextProvider>
    </AntdApp>)
    const runtime = runtimeRef.current!
    act(() => {
      transportMock.onEvent!({ type: 'prompt_boundary', message: {
        type: 'prompt_boundary', source_generation: 1, shell_id: 'bash-1', prompt_generation: 1,
        input_epoch: 1, shell: 'bash', cwd: '/srv',
      } })
      runtime.setSessionAiCompletionOpen('s1', true)
      expect(runtime.sendTextToSession('s1', 'ls')).toBe('sent')
    })
    const input = runtime.captureSessionAiInput('s1')!
    expect(input.line).toBe('ls')
    transportMock.sendInput.mockClear()
    for (const command of ['ls', 'pwd', 'ls\r', 'ls\nwhoami', 'ls\x1b[A']) {
      expect(runtime.acceptSessionAiCompletion('s1', input, command)).toBe('not_ready')
    }
    expect(runtime.acceptSessionAiCompletion('s1', { ...input, revision: input.revision + 1 }, 'ls -la')).toBe('not_ready')
    expect(transportMock.sendInput).not.toHaveBeenCalled()
    act(() => { expect(runtime.acceptSessionAiCompletion('s1', input, 'ls -la')).toBe('sent') })
    expect(transportMock.sendInput).toHaveBeenCalledOnce()
    expect(new TextDecoder().decode(transportMock.sendInput.mock.calls[0][0])).toBe(' -la')
    expect(runtime.captureSessionAiInput('s1')?.line).toBe('ls -la')
    expect(runtime.acceptSessionAiCompletion('s1', input, 'ls -la')).toBe('not_ready')
    expect(transportMock.sendInput).toHaveBeenCalledOnce()

    const updatedInput = runtime.captureSessionAiInput('s1')!
    transportMock.sendInput.mockReturnValueOnce(false)
    act(() => { expect(runtime.acceptSessionAiCompletion('s1', updatedInput, 'ls -la /tmp')).toBe('not_ready') })
    expect(runtime.captureSessionAiInput('s1')).toBeNull()
  })
})

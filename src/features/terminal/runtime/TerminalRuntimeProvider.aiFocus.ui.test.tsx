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

const terminalMock = vi.hoisted(() => ({
  focus: vi.fn(),
  keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
  onData: null as ((data: string) => void) | null,
  buffer: null as { active: { type: string } } | null,
}))
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
      open() { terminalMock.buffer = this.buffer }
      dispose() {}
      attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) { terminalMock.keyHandler = handler }
      hasSelection() { return false }
      onData(handler: (data: string) => void) { terminalMock.onData = handler; return subscription() }
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
  it.each(['debouncing', 'loading', 'ready', 'visible', 'empty', 'error'] as const)('Esc 在 %s 阶段关闭建议后，退格删空并重新输入仍可补全', async (phase) => {
    vi.useFakeTimers()
    const runtimeRef = createRef<TerminalRuntimeContextValue>()
    let queryCount = 0
    const query = vi.fn<TerminalGateway['querySessionCompletions']>(async (_id, request) => {
      queryCount += 1
      if (phase === 'error' && queryCount === 1) throw new Error('offline')
      return {
        request_id: request.request_id, source_generation: request.source_generation,
        status: 'ready', index_generation: 1, is_incomplete: false,
        prompt_observation: { status: 'ready' }, provider_states: [],
        items: phase === 'empty' && queryCount === 1 ? [] : [{ id: 'directory:tmp', kind: 'directory', source: 'directory', label: 'tmp/', insert_text: 'cd tmp/',
          replace_start_utf16: 0, replace_end_utf16: request.cursor_utf16, sources: ['directory'] }],
      }
    })
    const api = { websocketUrl: (path: string) => `ws://localhost${path}`, querySessionCompletions: query } as unknown as TerminalGateway
    const shortcuts = new ShortcutRuntime({ index: compileShortcutIndex({}, 'win32') })
    const session: Session = { id: 's1', kind: 'ssh', origin: 'app', status: 'connected', started_at: '2026-09-08T00:00:00Z', pty_cols: 80, pty_rows: 24 }
    const view = render(<AntdApp>
      <ShortcutRuntimeContextProvider value={{ runtime: shortcuts, platform: 'win32', labels: new Map(), bindingSignatures: new Map() }}>
        <TerminalRuntimeProvider api={api} sessions={[session]} theme="dark" terminalSettings={defaultTerminalSettings} sshSmoothScrollEnabled={false} completionSettings={defaultCompletionSettings} terminalFonts={[]}>
          <Viewport runtimeRef={runtimeRef} />
        </TerminalRuntimeProvider>
      </ShortcutRuntimeContextProvider>
    </AntdApp>)
    try {
      const runtime = runtimeRef.current!
      act(() => {
        transportMock.onEvent!({ type: 'prompt_boundary', message: {
          type: 'prompt_boundary', source_generation: 1, shell_id: 'bash-1', prompt_generation: 1,
          input_epoch: 1, shell: 'bash', cwd: '/srv',
        } })
        runtime.setViewportCompletionActive('p1', 's1', true)
        terminalMock.onData!('cd ')
      })
      if (phase !== 'debouncing') act(() => { vi.advanceTimersByTime(100) })
      if (phase !== 'debouncing' && phase !== 'loading') await act(async () => {})
      if (phase === 'visible') act(() => runtime.setViewportCompletionVisible('p1', 's1', true))
      expect(runtime.getSessionCompletionSnapshot('s1').queryState).toBe(phase === 'visible' || phase === 'empty' ? 'ready' : phase)
      // 有待关闭的建议时也不能劫持远端程序或输入法的 Esc。
      act(() => {
        const forwarded = (init: KeyboardEventInit = {}) => terminalMock.keyHandler!(new KeyboardEvent('keydown', { key: 'Escape', ...init }))
        expect(forwarded({ ctrlKey: true })).toBe(true)
        expect(forwarded({ isComposing: true })).toBe(true)
        expect(forwarded({ keyCode: 229 })).toBe(true)
        terminalMock.buffer!.active.type = 'alternate'
        expect(forwarded()).toBe(true)
        terminalMock.buffer!.active.type = 'normal'
      })
      transportMock.sendInput.mockClear()
      const escape = (type: string, repeat = false) => {
        const event = new KeyboardEvent(type, { key: 'Escape', code: 'Escape', cancelable: true, repeat })
        const forwarded = terminalMock.keyHandler!(event)
        // 模拟 xterm：未被自定义处理器接管的 Esc 会进入 onData 并写入 PTY。
        if (forwarded && type === 'keydown') terminalMock.onData!('\x1b')
        return { forwarded, prevented: event.defaultPrevented }
      }
      act(() => { expect(escape('keydown')).toEqual({ forwarded: false, prevented: true }) })
      act(() => runtime.setViewportCompletionVisible('p1', 's1', false))
      act(() => { expect(escape('keydown', true)).toEqual({ forwarded: false, prevented: true }) })
      act(() => { escape('keyup') })
      expect(transportMock.sendInput).not.toHaveBeenCalled()
      expect(runtime.getSessionCompletionSnapshot('s1').input.trust).toBe('trusted')
      await act(async () => {})
      expect(runtime.getSessionCompletionSnapshot('s1').queryState).toBe('idle')
      expect(runtime.getSessionCompletionSnapshot('s1').items).toHaveLength(0)
      await act(async () => {
        for (let index = 0; index < 3; index += 1) terminalMock.onData!('\x7f')
        expect(runtime.getSessionCompletionSnapshot('s1').input.line).toBe('')
        terminalMock.onData!('cd')
        vi.advanceTimersByTime(100)
      })
      expect(runtime.getSessionCompletionSnapshot('s1').items).toHaveLength(1)
      expect(runtime.getSessionCompletionSnapshot('s1').input.line).toBe('cd')
      await act(async () => {
        terminalMock.keyHandler!(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', ctrlKey: true }))
        terminalMock.keyHandler!(new KeyboardEvent('keyup', { key: 'j', code: 'KeyJ', ctrlKey: true }))
      })
      expect(query).toHaveBeenLastCalledWith('s1', expect.objectContaining({ trigger: 'manual', line: 'cd' }), { signal: expect.any(AbortSignal) })
      expect(runtime.getSessionCompletionSnapshot('s1').input.trust).toBe('trusted')
      act(() => {
        runtime.setViewportCompletionActive('p1', 's1', false)
        expect(terminalMock.keyHandler!(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true)
        runtime.setViewportCompletionActive('p1', 's1', true)
      })
      act(() => { expect(escape('keydown').forwarded).toBe(true) })
      await act(async () => {
        terminalMock.keyHandler!(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', ctrlKey: true }))
      })
      expect(screen.getByText('terminal.completion.inputUncertain')).toBeInTheDocument()
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it('智能补全快捷键经 xterm 只发查询，不写入 PTY，并遵守视口与输入锁', async () => {
    const runtimeRef = createRef<TerminalRuntimeContextValue>()
    const query = vi.fn(async () => { throw new Error('offline') })
    const api = { websocketUrl: (path: string) => `ws://localhost${path}`, querySessionCompletions: query } as unknown as TerminalGateway
    const shortcuts = new ShortcutRuntime({ index: compileShortcutIndex({}, 'win32') })
    const session: Session = { id: 's1', kind: 'ssh', origin: 'app', status: 'connected', started_at: '2026-09-08T00:00:00Z', pty_cols: 80, pty_rows: 24 }
    const tree = (enabled = true) => <AntdApp>
      <ShortcutRuntimeContextProvider value={{ runtime: shortcuts, platform: 'win32', labels: new Map(), bindingSignatures: new Map() }}>
        <TerminalRuntimeProvider api={api} sessions={[session]} theme="dark" terminalSettings={defaultTerminalSettings} sshSmoothScrollEnabled={false} completionSettings={{ ...defaultCompletionSettings, enabled }} terminalFonts={[]}>
          <Viewport runtimeRef={runtimeRef} />
        </TerminalRuntimeProvider>
      </ShortcutRuntimeContextProvider>
    </AntdApp>
    const view = render(tree())
    const runtime = runtimeRef.current!
    act(() => {
      transportMock.onEvent!({ type: 'prompt_boundary', message: {
        type: 'prompt_boundary', source_generation: 1, shell_id: 'bash-1', prompt_generation: 1,
        input_epoch: 1, shell: 'bash', cwd: '/srv',
      } })
      runtime.setViewportCompletionActive('p1', 's1', true)
    })
    transportMock.sendInput.mockClear()
    const press = (repeat = false, release = true) => {
      const event = new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', ctrlKey: true, cancelable: true, repeat })
      const result = terminalMock.keyHandler!(event)
      if (release) terminalMock.keyHandler!(new KeyboardEvent('keyup', { code: 'KeyJ', key: 'j', ctrlKey: true }))
      return { result, prevented: event.defaultPrevented }
    }
    await act(async () => { expect(press()).toEqual({ result: false, prevented: true }) })
    expect(query).toHaveBeenCalledWith('s1', expect.objectContaining({ trigger: 'manual', line: '' }), { signal: expect.any(AbortSignal) })
    expect(runtime.getSessionCompletionSnapshot('s1').queryState).toBe('error')
    expect(transportMock.sendInput).not.toHaveBeenCalled()
    await act(async () => { press() })
    expect(query).toHaveBeenCalledTimes(2)
    terminalMock.buffer!.active.type = 'alternate'
    act(() => { expect(press(false, false)).toEqual({ result: true, prevented: false }) })
    act(() => { expect(press(true)).toEqual({ result: true, prevented: false }) })
    expect(query).toHaveBeenCalledTimes(2)
    terminalMock.buffer!.active.type = 'normal'
    act(() => runtime.setViewportCompletionActive('p1', 's1', false))
    act(() => { expect(press().result).toBe(true) })
    expect(query).toHaveBeenCalledTimes(2)
    act(() => {
      runtime.setViewportCompletionActive('p1', 's1', true)
      transportMock.onEvent!({ type: 'input_lock', message: { type: 'input_lock', input_lock: { locked: true } } })
    })
    act(() => { press() })
    expect(query).toHaveBeenCalledTimes(2)
    act(() => {
      transportMock.onEvent!({ type: 'input_lock', message: { type: 'input_lock', input_lock: { locked: false } } })
    })
    view.rerender(tree(false))
    act(() => { expect(press(false, false)).toEqual({ result: true, prevented: false }) })
    act(() => { expect(press(true)).toEqual({ result: true, prevented: false }) })
    expect(query).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(shortcuts.dispatch({ type: 'keydown', code: 'KeyJ', key: 'j', ctrlKey: true }).result).toBe('fallthrough')
  })

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

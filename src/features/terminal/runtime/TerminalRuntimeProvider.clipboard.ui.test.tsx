import { act, fireEvent, render, screen } from '@testing-library/react'
import { App as AntdApp } from 'antd'
import { createRef, useEffect, useRef, type RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '#entities/session'
import { defaultCompletionSettings, defaultTerminalSettings } from '#entities/settings'
import { ShortcutRuntime, ShortcutRuntimeContextProvider, compileShortcutIndex } from '#entities/shortcuts'
import type { TerminalGateway } from '../api/terminalGateway'
import type { TerminalTransportOptions } from '../model/terminalTransport'
import { TerminalRuntimeProvider } from './TerminalRuntimeProvider'
import { useTerminalRuntime, type TerminalRuntimeContextValue } from './terminalRuntimeContext'

const terminalMock = vi.hoisted(() => ({
  keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
  onData: null as ((data: string) => void) | null,
  paste: vi.fn<(text: string) => void>(),
  focus: vi.fn(),
}))
const clipboardMock = vi.hoisted(() => ({ readText: vi.fn<() => Promise<string>>() }))
const transportMock = vi.hoisted(() => ({
  onEvent: null as TerminalTransportOptions['onEvent'] | null,
  live: true,
  sendInput: vi.fn<(data: Uint8Array) => boolean>(),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../lib/terminalClipboard', () => ({ readClipboardText: clipboardMock.readText, writeClipboardText: vi.fn() }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('@xterm/xterm', () => {
  const subscription = () => ({ dispose() {} })
  return { Terminal: class {
    options = {}
    cols = 80
    rows = 24
    buffer = { active: { type: 'normal', cursorX: 0, cursorY: 0 }, onBufferChange: subscription }
    focus = terminalMock.focus
    loadAddon() {}
    open() {}
    dispose() {}
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) { terminalMock.keyHandler = handler }
    hasSelection() { return false }
    paste = terminalMock.paste
    onData(handler: (data: string) => void) { terminalMock.onData = handler; return subscription() }
    onBinary = subscription
    onWriteParsed = subscription
    onResize = subscription
    onScroll = subscription
  } }
})
vi.mock('../model/terminalTransport', () => ({ TerminalTransport: class {
  constructor(options: TerminalTransportOptions) { transportMock.onEvent = options.onEvent }
  start() {}
  dispose() {}
  isLive() { return transportMock.live }
  sendInput = transportMock.sendInput
  sendResize() {}
} }))

function Viewport({ runtimeRef, active }: { runtimeRef: RefObject<TerminalRuntimeContextValue | null>; active: boolean }) {
  const runtime = useTerminalRuntime()
  const host = useRef<HTMLDivElement>(null)
  const { registerViewport } = runtime
  useEffect(() => { runtimeRef.current = runtime }, [runtime, runtimeRef])
  useEffect(() => registerViewport({ viewportId: 'p1', sessionId: 's1', host: host.current, active }), [active, registerViewport])
  return <div ref={host} />
}

function setup() {
  const runtimeRef = createRef<TerminalRuntimeContextValue>()
  const shortcuts = new ShortcutRuntime({ index: compileShortcutIndex({}, 'win32') })
  const session: Session = { id: 's1', kind: 'ssh', origin: 'app', status: 'connected', started_at: '2026-09-08T00:00:00Z', pty_cols: 80, pty_rows: 24 }
  const api = { websocketUrl: (path: string) => `ws://localhost${path}` } as TerminalGateway
  const tree = (active = true) => <AntdApp>
    <ShortcutRuntimeContextProvider value={{ runtime: shortcuts, platform: 'win32', labels: new Map(), bindingSignatures: new Map() }}>
      <TerminalRuntimeProvider api={api} sessions={[session]} theme="dark" terminalSettings={defaultTerminalSettings} sshSmoothScrollEnabled={false} completionSettings={defaultCompletionSettings} terminalFonts={[]}>
        <Viewport runtimeRef={runtimeRef} active={active} />
      </TerminalRuntimeProvider>
    </ShortcutRuntimeContextProvider>
  </AntdApp>
  const view = render(tree())
  const pane = view.container.querySelector('[data-session-id="s1"]')!
  const nativePaste = (text: string) => fireEvent.paste(pane, { clipboardData: { getData: () => text } })
  const press = (type: string, code = '', repeat = false) => {
    const event = new KeyboardEvent(type, { key: 'v', code, keyCode: 86, ctrlKey: type !== 'keyup', repeat, cancelable: true })
    const forwarded = terminalMock.keyHandler!(event)
    // 模拟 xterm 的虚拟键码分支，漏接 Ctrl+V 会进入 Readline 的 quoted-insert。
    if (forwarded && type === 'keydown') terminalMock.onData!('\x16')
    return { forwarded, prevented: event.defaultPrevented }
  }
  return { ...view, pane, runtimeRef, shortcuts, nativePaste, press, setActive: (active: boolean) => view.rerender(tree(active)) }
}

beforeEach(() => {
  terminalMock.paste.mockReset().mockImplementation((text) => terminalMock.onData!(`\x1b[200~${text}\x1b[201~`))
  clipboardMock.readText.mockReset().mockResolvedValue('sample text')
  transportMock.sendInput.mockReset().mockReturnValue(true)
  transportMock.live = true
})
afterEach(() => { vi.restoreAllMocks() })

describe('终端剪贴板事件与生命周期', () => {
  it.each(['', 'Unidentified', 'KeyV'])('键码为“%s”时首轮和连续粘贴均只发送一次', async (code) => {
    const { press, shortcuts, nativePaste } = setup()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => {
        expect(press('keydown', code)).toEqual({ forwarded: false, prevented: true })
        expect(press('keydown', code, true)).toEqual({ forwarded: false, prevented: true })
        press('keyup', code)
      })
    }
    expect(clipboardMock.readText).toHaveBeenCalledTimes(2)
    expect(terminalMock.paste).toHaveBeenCalledTimes(2)
    expect(transportMock.sendInput.mock.calls.map(([data]) => new TextDecoder().decode(data))).toEqual([
      '\x1b[200~sample text\x1b[201~', '\x1b[200~sample text\x1b[201~',
    ])
    shortcuts.updateIndex(compileShortcutIndex({ 'terminal.paste': { bindings: [] } }, 'win32'))
    await act(async () => { expect(press('keydown', code).forwarded).toBe(true); press('keyup', code) })
    expect(clipboardMock.readText).toHaveBeenCalledTimes(2)
    shortcuts.updateIndex(compileShortcutIndex({}, 'win32'))
    act(() => transportMock.onEvent!({ type: 'input_lock', message: { type: 'input_lock', input_lock: { locked: true } } }))
    await act(async () => { press('keydown', code); press('keyup', code) })
    expect(clipboardMock.readText).toHaveBeenCalledTimes(2)
    act(() => transportMock.onEvent!({ type: 'input_lock', message: { type: 'input_lock', input_lock: { locked: false } } }))
    transportMock.sendInput.mockClear()
    clipboardMock.readText.mockRejectedValueOnce(new Error('clipboard unavailable'))
    await act(async () => { press('keydown', code); press('keyup', code) })
    expect(screen.getByText('terminal.pasteFailed')).toBeInTheDocument()
    expect(transportMock.sendInput).not.toHaveBeenCalled()
    const reads = clipboardMock.readText.mock.calls.length
    await act(async () => { nativePaste('native paste') })
    expect(clipboardMock.readText).toHaveBeenCalledTimes(reads)
    expect(transportMock.sendInput).toHaveBeenCalledOnce()
    expect(new TextDecoder().decode(transportMock.sendInput.mock.calls[0][0])).toBe('\x1b[200~native paste\x1b[201~')
  })

  it('原生粘贴写入抛错时显示失败提示，并使补全输入失信', async () => {
    const { nativePaste, runtimeRef } = setup()
    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault() }
    window.addEventListener('error', onError)
    try {
      terminalMock.paste.mockImplementationOnce(() => { throw new Error('paste failed') })
      await act(async () => { nativePaste('sample') })
      expect(errors).toEqual([])
      expect(screen.getByText('terminal.pasteFailed')).toBeInTheDocument()
      expect(runtimeRef.current!.getSessionCompletionSnapshot('s1').input.trust).toBe('uncertain')
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  it('原生剪贴板事件没有文本时不回读另一个剪贴板快照', async () => {
    const { nativePaste } = setup()
    await act(async () => { nativePaste('') })
    expect(clipboardMock.readText).not.toHaveBeenCalled()
    expect(terminalMock.paste).not.toHaveBeenCalled()
    expect(transportMock.sendInput).not.toHaveBeenCalled()
  })

  it('缺少原生数据时继续使用桌面剪贴板，事件读取异常时显示提示', async () => {
    const { pane } = setup()
    await act(async () => { fireEvent.paste(pane) })
    expect(clipboardMock.readText).toHaveBeenCalledOnce()
    expect(terminalMock.paste).toHaveBeenCalledWith('sample text')
    terminalMock.paste.mockClear()
    await act(async () => {
      fireEvent.paste(pane, { clipboardData: { getData: () => { throw new Error('unavailable') } } })
    })
    expect(screen.getByText('terminal.pasteFailed')).toBeInTheDocument()
    expect(terminalMock.paste).not.toHaveBeenCalled()
    expect(clipboardMock.readText).toHaveBeenCalledOnce()
  })

  it('原生粘贴在断连或输入锁定时不读取剪贴板，也不改变输入快照', async () => {
    const { nativePaste, runtimeRef } = setup()
    transportMock.live = false
    const disconnectedSnapshot = runtimeRef.current!.getSessionCompletionSnapshot('s1')
    await act(async () => { nativePaste('sample') })
    expect(runtimeRef.current!.getSessionCompletionSnapshot('s1')).toBe(disconnectedSnapshot)
    transportMock.live = true
    act(() => transportMock.onEvent!({ type: 'input_lock', message: { type: 'input_lock', input_lock: { locked: true } } }))
    const lockedSnapshot = runtimeRef.current!.getSessionCompletionSnapshot('s1')
    await act(async () => { nativePaste('sample') })
    expect(runtimeRef.current!.getSessionCompletionSnapshot('s1')).toBe(lockedSnapshot)
    expect(clipboardMock.readText).not.toHaveBeenCalled()
    expect(terminalMock.paste).not.toHaveBeenCalled()
  })

  it.each(['locked', 'disconnected', 'inactive', 'disposed'])('剪贴板读取结束前变为 %s 时不粘贴', async (state) => {
    const view = setup()
    let resolve!: (text: string) => void
    clipboardMock.readText.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    act(() => { view.press('keydown'); view.press('keyup') })
    act(() => {
      if (state === 'locked') transportMock.onEvent!({ type: 'input_lock', message: { type: 'input_lock', input_lock: { locked: true } } })
      if (state === 'disconnected') transportMock.live = false
      if (state === 'inactive') view.setActive(false)
      if (state === 'disposed') view.unmount()
    })
    await act(async () => { resolve('late text') })
    expect(terminalMock.paste).not.toHaveBeenCalled()
    expect(transportMock.sendInput).not.toHaveBeenCalled()
  })
})

describe('终端程序化命令发送', () => {
  it('自动执行只发送一次命令和回车，并聚焦当前终端', () => {
    const { runtimeRef } = setup()
    const command = "docker exec -it 'fixture-container' sh"
    terminalMock.focus.mockClear()
    act(() => {
      expect(runtimeRef.current!.sendTextToSession('s1', command, { execute: true })).toBe('sent')
    })
    expect(transportMock.sendInput).toHaveBeenCalledExactlyOnceWith(new TextEncoder().encode(`${command}\r`))
    expect(terminalMock.focus).toHaveBeenCalledOnce()
    expect(terminalMock.paste).not.toHaveBeenCalled()
  })

  it.each(['locked', 'disconnected', 'disposed', 'missing'])('目标为 %s 时不发送命令或抢占焦点', (state) => {
    const view = setup()
    const runtime = view.runtimeRef.current!
    act(() => {
      if (state === 'locked') transportMock.onEvent!({ type: 'input_lock', message: { type: 'input_lock', input_lock: { locked: true } } })
      if (state === 'disconnected') transportMock.live = false
      if (state === 'disposed') view.unmount()
    })
    terminalMock.focus.mockClear()
    act(() => {
      const result = runtime.sendTextToSession(state === 'missing' ? 's2' : 's1', 'command', { execute: true })
      expect(result).toBe(state === 'disposed' || state === 'missing' ? 'missing_session' : 'not_ready')
    })
    expect(transportMock.sendInput).not.toHaveBeenCalled()
    expect(terminalMock.focus).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'throws'])('传输 %s 时返回失败，不聚焦或自动重发', (failure) => {
    const { runtimeRef } = setup()
    terminalMock.focus.mockClear()
    transportMock.sendInput.mockImplementationOnce(() => {
      if (failure === 'throws') throw new Error('transport failed')
      return false
    })
    act(() => {
      expect(runtimeRef.current!.sendTextToSession('s1', 'command', { execute: true }))
        .toBe(failure === 'throws' ? 'failed' : 'not_ready')
    })
    expect(transportMock.sendInput).toHaveBeenCalledOnce()
    expect(terminalMock.focus).not.toHaveBeenCalled()
  })
})

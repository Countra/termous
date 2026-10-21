import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf'
import { ClientMessageSchema, ServerMessageSchema } from '@termous/rdp-protocol'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { emptyRemoteDesktopViewerState, type RemoteDesktopViewerCreateOptions } from '../../core/viewerContracts'
import { createRdpViewer } from './viewer'
import { readClipboardText } from '#shared/clipboard'

vi.mock('#shared/clipboard', () => ({ readClipboardText: vi.fn() }))

const files = vi.hoisted(() => ({ intercept: false, prepare: vi.fn() }))
vi.mock('./systemFiles.ts', () => ({ createRdpSystemFiles: () => ({ interceptPaste: () => files.intercept, prepare: files.prepare, changed: vi.fn(), drag: vi.fn(), dispose: vi.fn() }) }))

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 1
  bufferedAmount = 0
  binaryType = ''
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3 })
  constructor() { Socket.instances.push(this) }
}

class PixelWorker {
  static instances: PixelWorker[] = []
  postMessage = vi.fn()
  terminate = vi.fn()
  onmessage?: (event: { data: { type: string; width: number; height: number; displayEpoch: number; receivedBytes: number; sentBytes: number } }) => void
  constructor() { PixelWorker.instances.push(this) }
}

beforeEach(() => {
	vi.mocked(readClipboardText).mockReset().mockResolvedValue('中文\ntext 😀')
	files.intercept = false
	files.prepare.mockReset()
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('Worker', PixelWorker)
  Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { configurable: true, value: vi.fn(() => ({})) })
})

function receive(socket: Socket, payload: MessageInitShape<typeof ServerMessageSchema>['payload']) {
  socket.onmessage?.({ data: Uint8Array.from(toBinary(ServerMessageSchema, create(ServerMessageSchema, { payload }))).buffer })
}

function controllingViewer() {
  const config = options()
  const viewer = createRdpViewer(config), socket = Socket.instances[0]
  receive(socket, { case: 'session', value: { sessionId: 'session', sessionGeneration: 1n, state: 'ready', clipboardAvailable: true, control: { subscriptionId: 'viewer', generation: 1n } } })
  const keyboard = config.target.querySelector('textarea')!
  viewer.focus()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const inputs = () => socket.send.mock.calls.flatMap(([bytes]) => {
    const { payload } = fromBinary(ClientMessageSchema, bytes)
    return payload.case === 'input' ? [payload.value] : []
  })
  return { config, viewer, socket, keyboard, inputs }
}

test('持续收帧与会话通知不推迟分辨率请求，往返固定尺寸保持同一播放器', async () => {
  const f = controllingViewer()
  vi.spyOn(f.config.target, 'getBoundingClientRect').mockReturnValue({ width: 1280, height: 720 } as DOMRect)
  const worker = PixelWorker.instances[0]
  const frame = (width: number, height: number) => worker.onmessage?.({ data: { type: 'frame', width, height, displayEpoch: 1, receivedBytes: 100, sentBytes: 1 } })
  const state = () => receive(f.socket, { case: 'session', value: { sessionId: 'session', sessionGeneration: 1n, state: 'ready', resizeAvailable: true, control: { subscriptionId: 'viewer', generation: 1n } } })
  state(); frame(1920, 1080)
  f.viewer.setFollowWindow(true)
  for (let i = 0; i < 40; i++) { frame(1920, 1080); state(); await vi.advanceTimersByTimeAsync(50) }
  const resizeInputs = () => f.inputs().filter(input => input.operation.case === 'resize')
  expect(resizeInputs()).toHaveLength(1)
  const first = resizeInputs()[0]
  receive(f.socket, { case: 'inputReceipt', value: { sequence: first.sequence, controlGeneration: 1n } })
  frame(1280, 720)
  await vi.advanceTimersByTimeAsync(0)
  f.viewer.setDisplayMode('actual')
  f.viewer.setFollowWindow(false)
  await vi.advanceTimersByTimeAsync(300)
  const second = resizeInputs()[1]
  expect(second.operation).toMatchObject({ case: 'resize', value: { width: 1920, height: 1080 } })
  receive(f.socket, { case: 'inputReceipt', value: { sequence: second.sequence, controlGeneration: 1n } })
  frame(1920, 1080)
  await vi.advanceTimersByTimeAsync(0)
  expect(f.config.target.querySelector('canvas')!.style.width).toBe('1920px')
  f.viewer.setDisplayMode('fit')
  expect(f.config.target.querySelector('canvas')!.style.width).toBe('1280px')
  expect(Socket.instances).toHaveLength(1)
  expect(PixelWorker.instances).toHaveLength(1)
  f.viewer.dispose()
})

test('调整期间控制权换代后，迟到画面不覆盖固定尺寸，重新接管后恢复', async () => {
  const f = controllingViewer()
  const changed = vi.fn()
  f.config.events.onResolutionChanged = changed
  vi.spyOn(f.config.target, 'getBoundingClientRect').mockReturnValue({ width: 1280, height: 720 } as DOMRect)
  const frame = (width: number, height: number) => PixelWorker.instances[0].onmessage?.({ data: { type: 'frame', width, height, displayEpoch: 1, receivedBytes: 1, sentBytes: 1 } })
  const state = (subscriptionId: string, generation: bigint) => receive(f.socket, { case: 'session', value: { sessionId: 'session', sessionGeneration: 1n, state: 'ready', resizeAvailable: true, control: { subscriptionId, generation } } })
  state('viewer', 1n); frame(1920, 1080)
  f.viewer.setFollowWindow(true)
  await vi.advanceTimersByTimeAsync(300)
  f.viewer.setFollowWindow(false)
  state('other', 2n)
  await vi.advanceTimersByTimeAsync(0)
  frame(1920, 1080)
  expect(changed.mock.lastCall?.[0].status).toBe('timeout')
  frame(1280, 720)
  await vi.advanceTimersByTimeAsync(500)
  expect(f.inputs()).toHaveLength(1)
  state('viewer', 3n)
  await vi.advanceTimersByTimeAsync(300)
  expect(f.inputs()[1]).toMatchObject({ controlGeneration: 3n, operation: { case: 'resize', value: { width: 1920, height: 1080 } } })
  expect(f.config.events.onDisconnected).not.toHaveBeenCalled()
  f.viewer.dispose()
})

test('桌面缩小后丢弃旧帧的待发送移动，释放鼠标使用新尺寸内坐标', () => {
  const f = controllingViewer()
  const canvas = f.config.target.querySelector('canvas')!
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600 } as DOMRect)
  canvas.setPointerCapture = vi.fn()
  canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 790, clientY: 590, button: 0 }))
  canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 795, clientY: 595 }))
  PixelWorker.instances[0].onmessage?.({ data: { type: 'frame', width: 400, height: 300, displayEpoch: 2, receivedBytes: 1, sentBytes: 1 } })
  vi.advanceTimersByTime(16)
  canvas.dispatchEvent(new Event('pointercancel'))
  const mouse = f.inputs().flatMap(input => input.operation.case === 'mouse' ? [input.operation.value] : [])
  expect(mouse).toHaveLength(2)
  expect(mouse[1]).toMatchObject({ x: 399, y: 299, flags: 0x1000 })
  expect(f.config.events.onDisconnected).not.toHaveBeenCalled()
  f.viewer.dispose()
})

test('普通 Ctrl+V 发送本机文本，远端确认后才发送一次粘贴组合键', async () => {
  const f = controllingViewer()
  f.keyboard.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', ctrlKey: true, cancelable: true }))
  await Promise.resolve()
  expect(f.inputs().map(input => input.operation.case)).toEqual(['clipboard'])
  receive(f.socket, { case: 'inputReceipt', value: { sequence: 1n, controlGeneration: 1n } })
  await Promise.resolve()
  expect(f.inputs().map(input => input.operation.case)).toEqual(['clipboard', 'key', 'key', 'key', 'key'])
  expect(f.inputs().map(input => input.sequence)).toEqual([1n, 2n, 3n, 4n, 5n])
  f.viewer.dispose()
})

test.each([false, true])('分辨率请求被拒绝时保留连接，仅结果不明时断开：uncertain=%s', async uncertain => {
  const f = controllingViewer()
  vi.spyOn(f.config.target, 'getBoundingClientRect').mockReturnValue({ width: 1280, height: 720 } as DOMRect)
  receive(f.socket, { case: 'session', value: { sessionId: 'session', sessionGeneration: 1n, state: 'ready', resizeAvailable: true, control: { subscriptionId: 'viewer', generation: 1n } } })
  PixelWorker.instances[0].onmessage?.({ data: { type: 'frame', width: 1920, height: 1080, displayEpoch: 1, receivedBytes: 1, sentBytes: 1 } })
  f.viewer.setFollowWindow(true)
  await vi.advanceTimersByTimeAsync(300)
  const request = f.inputs()[0]
  expect(request.operation.case).toBe('resize')
  receive(f.socket, { case: 'fault', value: { code: uncertain ? 'rdp_input_uncertain' : 'rdp_capability_unavailable', uncertain,
    input: { sequence: request.sequence, controlGeneration: request.controlGeneration } } })
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.inputs()).toHaveLength(1)
  if (uncertain) expect(f.config.events.onDisconnected).toHaveBeenCalledExactlyOnceWith(false)
  else {
    expect(f.config.events.onDisconnected).not.toHaveBeenCalled()
    f.keyboard.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' }))
    expect(f.inputs().map(input => input.operation.case)).toEqual(['resize', 'key'])
  }
  f.viewer.dispose()
})

test('远端拒绝文本同步后连接和后续按键保持可用，手动发送返回失败', async () => {
  const f = controllingViewer()
  const sent = expect(f.viewer.sendClipboard('manual')).rejects.toThrow('clipboard_unavailable')
  receive(f.socket, { case: 'fault', value: { code: 'rdp_clipboard_unavailable', uncertain: false, input: { sequence: 1n, controlGeneration: 1n } } })
  await sent
  f.keyboard.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' }))
  expect(f.inputs().map(input => input.operation.case)).toEqual(['clipboard', 'key'])
  expect(f.config.events.onDisconnected).not.toHaveBeenCalled()
  f.viewer.dispose()
})

test('续租失败及旧输入错误不会结束当前文本发布', async () => {
  const f = controllingViewer(), settled = vi.fn()
  const sent = Promise.resolve(f.viewer.sendClipboard('manual')).then(settled)
  receive(f.socket, { case: 'fault', value: { code: 'rdp_control_stale' } })
  receive(f.socket, { case: 'fault', value: { code: 'rdp_clipboard_stale', input: { sequence: 1n, controlGeneration: 0n } } })
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  receive(f.socket, { case: 'inputReceipt', value: { sequence: 1n, controlGeneration: 1n } })
  await sent
  expect(settled).toHaveBeenCalledOnce()
  expect(f.config.events.onDisconnected).not.toHaveBeenCalled()
  f.viewer.dispose()
})

test.each(['remoteClipboard', 'capability', 'composition', 'blur'] as const)('读取文本期间 %s 变化后不能继续发布', async reason => {
  const f = controllingViewer()
  let resolve!: (text: string) => void
  vi.mocked(readClipboardText).mockReturnValueOnce(new Promise<string>(done => { resolve = done }))
  f.keyboard.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', ctrlKey: true }))
  if (reason === 'remoteClipboard') receive(f.socket, { case: 'clipboard', value: { text: '远端新内容' } })
  if (reason === 'capability') {
    for (const clipboardAvailable of [false, true]) receive(f.socket, { case: 'session', value: { sessionId: 'session', sessionGeneration: 1n, state: 'ready', clipboardAvailable, control: { subscriptionId: 'viewer', generation: 1n } } })
  }
  if (reason === 'composition') f.keyboard.dispatchEvent(new CompositionEvent('compositionstart'))
  if (reason === 'blur') { f.viewer.blur(); f.viewer.focus() }
  resolve('不能补发')
  await Promise.resolve(); await Promise.resolve()
  expect(f.inputs()).toHaveLength(0)
  f.viewer.dispose()
})

test('目标不支持文本重定向时，仍然允许远端内部 Ctrl+V', () => {
  const f = controllingViewer()
  receive(f.socket, { case: 'session', value: { sessionId: 'session', sessionGeneration: 1n, state: 'ready', clipboardAvailable: false, control: { subscriptionId: 'viewer', generation: 1n } } })
  f.keyboard.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', ctrlKey: true }))
  expect(f.inputs().map(input => input.operation.case)).toEqual(['key', 'key', 'key', 'key'])
  expect(readClipboardText).not.toHaveBeenCalled()
  f.viewer.dispose()
})

test.each(['blur', 'readonly', 'inactive', 'control', 'remoteClipboard'])('等待文本确认时 %s 不补发粘贴', async reason => {
  const f = controllingViewer()
  f.keyboard.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', ctrlKey: true }))
  await Promise.resolve()
  if (reason === 'blur') f.viewer.blur()
  if (reason === 'readonly') f.viewer.setViewOnly(true)
  if (reason === 'inactive') f.viewer.setViewportActive(false, 'fit')
  if (reason === 'control') receive(f.socket, { case: 'session', value: { sessionId: 'session', sessionGeneration: 1n, state: 'ready', control: { subscriptionId: 'another', generation: 2n } } })
  if (reason === 'remoteClipboard') receive(f.socket, { case: 'clipboard', value: { text: '远端新内容' } })
  receive(f.socket, { case: 'inputReceipt', value: { sequence: 1n, controlGeneration: 1n } })
  await Promise.resolve(); await Promise.resolve()
  expect(f.inputs().filter(input => input.operation.case === 'key')).toHaveLength(0)
  f.viewer.dispose()
})

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  Socket.instances = []
  PixelWorker.instances = []
})

function options(): RemoteDesktopViewerCreateOptions {
  const target = document.createElement('div')
  document.body.appendChild(target)
  return {
    target, state: { ...emptyRemoteDesktopViewerState },
    transport: { kind: 'rdp-pixels', attachment: { subscription_id: 'viewer', control_url: 'ws://127.0.0.1:1234/control', display_url: 'ws://127.0.0.1:1234/display', control_ticket: 'control', display_ticket: 'display' } },
    session: {
      id: 'session', profile_id: 'profile', profile_name: 'Desktop', host_id: 'host', host_name: 'Host',
      route: 'direct', route_config_version: 1, protocol: 'rdp', protocol_config_version: 1,
      vnc: { target_host: '', port: 5900, shared: true, default_view_only: false, default_display_mode: 'fit' },
      rdp: { target_host: 'desktop.test', port: 3389, server_name: 'desktop.test', username: 'tester', domain: '', width: 800, height: 600, audio: false, default_view_only: false, default_display_mode: 'fit' },
      status: 'ready', phase: 'ready', connection_generation: 1, viewer_attached: false, created_at: '', updated_at: '',
    },
    events: {
      onConnected: vi.fn(), onDisconnected: vi.fn(), onControlChanged: vi.fn(), onCredentialsRequired: vi.fn(),
      onSecurityFailure: vi.fn(), onServerVerification: vi.fn(), onClipboard: vi.fn(), onDesktopName: vi.fn(),
      onCapabilities: vi.fn(), onMetrics: vi.fn(),
    },
  }
}

test('按键按下后通道拥塞只断开一次，清理不递归且不重放输入', () => {
  const config = options()
  const viewer = createRdpViewer(config)
  viewer.focus()
  // 排空 jsdom 聚焦文本框产生的 selectionchange，之后只检查观看端的定时器。
  vi.advanceTimersByTime(0)
  const socket = Socket.instances[0]
  const state = toBinary(ServerMessageSchema, create(ServerMessageSchema, { payload: { case: 'session', value: {
    sessionId: 'session', sessionGeneration: 1n, state: 'ready', control: { subscriptionId: 'viewer', generation: 1n },
  } } }))
  socket.onmessage?.({ data: Uint8Array.from(state).buffer })
  config.target.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' }))
  expect(socket.send).toHaveBeenCalledTimes(1)
  socket.bufferedAmount = 256 * 1024 + 1
  expect(() => viewer.sendCtrlAltDel()).not.toThrow()
  expect(config.events.onDisconnected).toHaveBeenCalledExactlyOnceWith(false)
  expect(socket.close).toHaveBeenCalledTimes(1)
  expect(PixelWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
  expect(socket.send).toHaveBeenCalledTimes(1)
  expect(config.target.children).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
  socket.onmessage?.({ data: Uint8Array.from(state).buffer })
  expect(config.events.onControlChanged).toHaveBeenCalledTimes(1)
  viewer.dispose()
  expect(socket.close).toHaveBeenCalledTimes(1)
})

test.each(['canvas', 'observer'])('初始化 %s 失败会释放已创建的资源', (stage) => {
  const config = options()
  if (stage === 'canvas') vi.spyOn(HTMLCanvasElement.prototype, 'transferControlToOffscreen').mockImplementation(() => { throw new Error('fixture canvas') })
  else vi.stubGlobal('ResizeObserver', class { constructor() { throw new Error('fixture observer') } })
  expect(() => createRdpViewer(config)).toThrow(`fixture ${stage}`)
  expect(PixelWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
  expect(Socket.instances[0].close).toHaveBeenCalledTimes(1)
  expect(config.target.children).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
  expect(config.events.onDisconnected).not.toHaveBeenCalled()
})

test('控制连接构造失败会释放 Worker，不遗留 DOM', () => {
  const config = options()
  vi.stubGlobal('WebSocket', class { constructor() { throw new Error('fixture socket') } })
  expect(() => createRdpViewer(config)).toThrow('fixture socket')
  expect(PixelWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
  expect(config.target.children).toHaveLength(0)
})

test('系统文件粘贴先释放已发送的 Ctrl，截获 V 和重复按键，不遗留松键或自动重发', () => {
  const config = options()
  const viewer = createRdpViewer(config)
  const socket = Socket.instances[0]
  socket.onmessage?.({ data: Uint8Array.from(toBinary(ServerMessageSchema, create(ServerMessageSchema, { payload: { case: 'session', value: {
    sessionId: 'session', sessionGeneration: 1n, state: 'ready', control: { subscriptionId: 'viewer', generation: 1n },
  } } }))).buffer })
  files.intercept = true
  const keyboard = config.target.querySelector('textarea')!
  for (const [type, code, repeat] of [['keydown', 'ControlLeft', false], ['keydown', 'KeyV', false], ['keydown', 'KeyV', true], ['keyup', 'KeyV', false], ['keyup', 'ControlLeft', false]] as const) {
    keyboard.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'KeyV' ? 'v' : 'Control', ctrlKey: true, repeat, cancelable: true }))
  }
  const keys = socket.send.mock.calls.map(([bytes]) => fromBinary(ClientMessageSchema, bytes).payload).flatMap(payload => payload.case === 'input' && payload.value.operation.case === 'key' ? [payload.value.operation.value] : [])
  expect(keys.map(key => [key.scancode, key.down])).toEqual([[0x1d, true], [0x1d, false]])
  expect(files.prepare).toHaveBeenCalledExactlyOnceWith(false)
  expect(config.events.onDisconnected).not.toHaveBeenCalled()
  viewer.dispose()
})

import { create, toBinary } from '@bufbuild/protobuf'
import { ServerMessageSchema } from '@termous/rdp-protocol'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { emptyRemoteDesktopViewerState, type RemoteDesktopViewerCreateOptions } from '../../core/viewerContracts'
import { createRdpViewer } from './viewer'

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
  constructor() { PixelWorker.instances.push(this) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('Worker', PixelWorker)
  Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { configurable: true, value: vi.fn(() => ({})) })
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
    target, url: '', state: { ...emptyRemoteDesktopViewerState },
    attachment: { subscription_id: 'viewer', control_url: 'ws://127.0.0.1:1234/control', display_url: 'ws://127.0.0.1:1234/display', control_ticket: 'control', display_ticket: 'display' },
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

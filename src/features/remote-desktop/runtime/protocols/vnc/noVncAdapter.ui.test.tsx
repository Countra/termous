import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VncViewerAdapter, type VncViewerAdapterEvents } from './noVncAdapter.ts'

interface FakeRfbInstance extends EventTarget {
  background: string
  viewOnly: boolean
  focusOnClick: boolean
  qualityLevel: number
  compressionLevel: number
  resizeSession: boolean
  scaleViewport: boolean
  clipViewport: boolean
  showDotCursor: boolean
  focus: ReturnType<typeof vi.fn>
  blur: ReturnType<typeof vi.fn>
  sendCredentials: ReturnType<typeof vi.fn>
  approveServer: ReturnType<typeof vi.fn>
  sendCtrlAltDel: ReturnType<typeof vi.fn>
  clipboardPasteFrom: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

const noVncMock = vi.hoisted(() => ({
  instances: [] as EventTarget[],
  constructorCalls: [] as Array<{ target: HTMLElement; channel: unknown; options: unknown }>,
  throwOnConstruct: false,
}))

vi.mock('@novnc/novnc', () => ({
  default: class FakeRfb extends EventTarget {
    background = ''
    viewOnly = false
    focusOnClick = false
    qualityLevel = 0
    compressionLevel = 0
    resizeSession = false
    scaleViewport = false
    clipViewport = false
    showDotCursor = false
    focus = vi.fn()
    blur = vi.fn()
    sendCredentials = vi.fn()
    approveServer = vi.fn()
    sendCtrlAltDel = vi.fn()
    clipboardPasteFrom = vi.fn()
    disconnect = vi.fn()

    constructor(target: HTMLElement, channel: unknown, options: unknown) {
      super()
      noVncMock.instances.push(this)
      noVncMock.constructorCalls.push({ target, channel, options })
      if (noVncMock.throwOnConstruct) {
        throw new Error('constructor failed')
      }
    }
  },
}))

class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static readonly instances: MockWebSocket[] = []
  static instrumentableSend = true

  readonly url: string
  readonly protocols: string[]
  protocol = 'binary'
  readyState = MockWebSocket.CONNECTING
  bufferedAmount = 0
  binaryType: BinaryType = 'blob'
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
  })

  constructor(url: string, protocols: string[]) {
    super()
    this.url = url
    this.protocols = protocols
    if (!MockWebSocket.instrumentableSend) {
      Object.defineProperty(this, 'send', {
        configurable: false,
        writable: true,
        value: this.send,
      })
    }
    MockWebSocket.instances.push(this)
  }

  receive(data: ArrayBuffer) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  noVncMock.instances.length = 0
  noVncMock.constructorCalls.length = 0
  noVncMock.throwOnConstruct = false
  MockWebSocket.instances.length = 0
  MockWebSocket.instrumentableSend = true
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('VNC Viewer Adapter', () => {
  it('使用 binary 子协议创建 noVNC，并映射显示与输入控制', async () => {
    const target = document.createElement('div')
    const events = viewerEvents()
    const adapter = await VncViewerAdapter.create({
      target,
      url: 'ws://127.0.0.1:8122/api/v1/remote-desktop-stream?ticket=opaque',
      shared: true,
      viewOnly: true,
      displayMode: 'fit',
      credentials: { username: 'operator' },
      events,
    })
    const rfb = latestRfb()

    expect(MockWebSocket.instances[0]).toMatchObject({
      url: 'ws://127.0.0.1:8122/api/v1/remote-desktop-stream?ticket=opaque',
      protocols: ['binary'],
    })
    expect(noVncMock.constructorCalls).toEqual([{
      target,
      channel: MockWebSocket.instances[0],
      options: {
        shared: true,
        credentials: { username: 'operator' },
      },
    }])
    expect(rfb.viewOnly).toBe(true)
    expect(rfb.showDotCursor).toBe(true)
    expect(rfb.qualityLevel).toBe(6)
    expect(rfb.compressionLevel).toBe(2)
    expect(rfb.scaleViewport).toBe(true)
    expect(rfb.resizeSession).toBe(false)

    adapter.setDisplayMode('resize')
    expect(rfb.scaleViewport).toBe(false)
    expect(rfb.clipViewport).toBe(true)
    expect(rfb.resizeSession).toBe(true)

    adapter.setViewportActive(false, 'resize')
    expect(rfb.resizeSession).toBe(false)
    adapter.setViewportActive(true, 'resize')
    expect(rfb.resizeSession).toBe(true)

    adapter.setDisplayMode('actual')
    expect(rfb.scaleViewport).toBe(false)
    expect(rfb.clipViewport).toBe(false)
    expect(rfb.resizeSession).toBe(false)
    adapter.setViewOnly(false)
    expect(rfb.viewOnly).toBe(false)
    adapter.dispose()
  })

  it('投影动态凭据字段、能力和服务器 SHA-256 指纹', async () => {
    const events = viewerEvents()
    const adapter = await VncViewerAdapter.create({
      target: document.createElement('div'),
      url: 'ws://127.0.0.1:8122/stream',
      shared: false,
      viewOnly: false,
      displayMode: 'actual',
      events,
    })
    const rfb = latestRfb()

    rfb.dispatchEvent(new CustomEvent('credentialsrequired', {
      detail: { types: ['username', 'password', 'target', 'unsupported'] },
    }))
    rfb.dispatchEvent(new CustomEvent('capabilities', {
      detail: { capabilities: { power: true } },
    }))
    rfb.dispatchEvent(new CustomEvent('serververification', {
      detail: { type: 'RSA', publickey: new Uint8Array([1, 2, 3, 4]) },
    }))

    expect(events.onCredentialsRequired).toHaveBeenCalledWith(['username', 'password', 'target'])
    expect(events.onCapabilities).toHaveBeenCalledWith({ power: true })
    await vi.waitFor(() => {
      expect(events.onServerVerification).toHaveBeenCalledWith({
        type: 'RSA',
        fingerprint: 'SHA256:n2SnR+G5fxMfq7a0Rylsm28CAeefs8U1bmx36JtqgGo',
      })
    })
    adapter.dispose()
  })

  it('按秒发布真实传输字节并在释放后停止采样', async () => {
    vi.useFakeTimers()
    const events = viewerEvents()
    const adapter = await VncViewerAdapter.create({
      target: document.createElement('div'),
      url: 'ws://127.0.0.1:8122/stream',
      shared: true,
      viewOnly: false,
      displayMode: 'fit',
      events,
    })
    const socket = MockWebSocket.instances[0]
    const rfb = latestRfb()

    rfb.dispatchEvent(new Event('connect'))
    socket.receive(new Uint8Array(2048).buffer)
    socket.send(new Uint8Array(32))
    vi.advanceTimersByTime(1000)

    expect(events.onMetrics).toHaveBeenLastCalledWith(expect.objectContaining({
      receivedBytes: 2048,
      sentBytes: 32,
      receiveBytesPerSecond: 2048,
      sendBytesPerSecond: 32,
      outboundMeasured: true,
    }))
    const callsBeforeDispose = vi.mocked(events.onMetrics).mock.calls.length
    adapter.dispose()
    vi.advanceTimersByTime(2000)
    expect(events.onMetrics).toHaveBeenCalledTimes(callsBeforeDispose)
  })

  it('无法覆写 WebSocket send 时保留连接并明确关闭发送统计', async () => {
    vi.useFakeTimers()
    MockWebSocket.instrumentableSend = false
    const events = viewerEvents()
    const adapter = await VncViewerAdapter.create({
      target: document.createElement('div'),
      url: 'ws://127.0.0.1:8122/stream',
      shared: true,
      viewOnly: false,
      displayMode: 'fit',
      events,
    })
    const socket = MockWebSocket.instances[0]
    const rfb = latestRfb()

    rfb.dispatchEvent(new Event('connect'))
    socket.send(new Uint8Array(32))
    vi.advanceTimersByTime(1000)

    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(events.onMetrics).toHaveBeenLastCalledWith(expect.objectContaining({
      sentBytes: 0,
      outboundMeasured: false,
    }))
    adapter.dispose()
  })

  it('noVNC 构造失败时关闭已创建的 WebSocket 并停止采样', async () => {
    vi.useFakeTimers()
    noVncMock.throwOnConstruct = true
    const events = viewerEvents()

    await expect(VncViewerAdapter.create({
      target: document.createElement('div'),
      url: 'ws://127.0.0.1:8122/stream',
      shared: true,
      viewOnly: false,
      displayMode: 'fit',
      events,
    })).rejects.toThrow('constructor failed')

    const socket = MockWebSocket.instances[0]
    expect(socket.close).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    expect(events.onMetrics).not.toHaveBeenCalled()
  })

  it('释放操作幂等，并解绑所有 noVNC 事件', async () => {
    const events = viewerEvents()
    const adapter = await VncViewerAdapter.create({
      target: document.createElement('div'),
      url: 'ws://127.0.0.1:8122/stream',
      shared: true,
      viewOnly: false,
      displayMode: 'fit',
      events,
    })
    const rfb = latestRfb()
    const socket = MockWebSocket.instances[0]

    adapter.dispose()
    adapter.dispose()
    rfb.dispatchEvent(new Event('connect'))
    rfb.dispatchEvent(new CustomEvent('clipboard', { detail: { text: 'late' } }))

    expect(rfb.disconnect).toHaveBeenCalledTimes(1)
    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(events.onConnected).not.toHaveBeenCalled()
    expect(events.onClipboard).not.toHaveBeenCalled()
  })
})

function latestRfb() {
  const value = noVncMock.instances[noVncMock.instances.length - 1]
  if (!value) {
    throw new Error('测试 noVNC 实例不存在')
  }
  return value as FakeRfbInstance
}

function viewerEvents(): VncViewerAdapterEvents {
  return {
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onCredentialsRequired: vi.fn(),
    onSecurityFailure: vi.fn(),
    onServerVerification: vi.fn(),
    onClipboard: vi.fn(),
    onDesktopName: vi.fn(),
    onCapabilities: vi.fn(),
    onMetrics: vi.fn(),
  }
}

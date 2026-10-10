import { create, toBinary } from '@bufbuild/protobuf'
import { DesktopAttachmentSchema, DesktopPeer } from '@termous/remote-protocol/desktop'
import { DesktopPacketSchema } from '@termous/remote-protocol/desktop-protocol'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

test.each(['rfb', 'h264'])('%s 兼容旧 Core 的 null ICE，且释放创建的连接', transport => {
  const close = vi.fn()
  const construct = vi.fn()
  vi.stubGlobal('RTCPeerConnection', class {
    constructor(configuration: RTCConfiguration) { construct(configuration) }
    createDataChannel() { return { readyState: 'connecting', close: vi.fn() } }
    addTransceiver() { return { setCodecPreferences: vi.fn() } }
    close = close
  })
  vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs: [{ mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f' }] }) })
  const peer = new DesktopPeer(create(DesktopAttachmentSchema, { transport }), null, { packet: vi.fn(), track: vi.fn(), closed: vi.fn() })
  try { expect(construct).toHaveBeenCalledWith({ iceServers: [], bundlePolicy: 'max-bundle' }) }
  finally { peer.close() }
  expect(close).toHaveBeenCalledTimes(1)
})

test('无效 ICE 配置保留失败语义，不降级为直连也不泄露底层异常', () => {
  const construct = vi.fn()
  vi.stubGlobal('RTCPeerConnection', class {
    constructor(configuration: RTCConfiguration) { construct(configuration); throw new TypeError('invalid turn:private.invalid credential=synthetic') }
  })
  const servers = [{ urls: 'turn:fixture.invalid' }]
  expect(() => new DesktopPeer(create(DesktopAttachmentSchema, { transport: 'rfb' }), servers, { packet: vi.fn(), track: vi.fn(), closed: vi.fn() })).toThrow('desktop_ice_invalid')
  expect(construct).toHaveBeenCalledExactlyOnceWith({ iceServers: servers, bundlePolicy: 'max-bundle' })
})

test('浏览器无法创建连接时不误报中继配置错误', () => {
  vi.stubGlobal('RTCPeerConnection', class {
    constructor() { throw new DOMException('synthetic resource failure', 'UnknownError') }
  })
  expect(() => new DesktopPeer(create(DesktopAttachmentSchema, { transport: 'rfb' }), [], { packet: vi.fn(), track: vi.fn(), closed: vi.fn() })).toThrow('desktop_peer_failed')
})

test('编码能力不支持时，构造清理不会用连接关闭事件覆盖原始错误', () => {
  const closed = vi.fn(), close = vi.fn()
  vi.stubGlobal('RTCPeerConnection', class {
    connectionState = 'closed'
    onconnectionstatechange?: () => void
    createDataChannel() { return { readyState: 'connecting' } }
    addTransceiver() { return { setCodecPreferences: vi.fn() } }
    close() { close(); this.onconnectionstatechange?.() }
  })
  vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs: [] }) })
  expect(() => new DesktopPeer(create(DesktopAttachmentSchema, { transport: 'h264' }), [], { packet: vi.fn(), track: vi.fn(), closed })).toThrow('desktop_h264_unsupported')
  expect(close).toHaveBeenCalledTimes(1)
  expect(closed).not.toHaveBeenCalled()
})

function recoveryPeer(transport = 'h264') {
  vi.useFakeTimers()
  const channel = { readyState: 'open', bufferedAmount: 0, send: vi.fn(), close: vi.fn() }
  vi.stubGlobal('RTCPeerConnection', class {
    connectionState: RTCPeerConnectionState = 'connected'
    onconnectionstatechange?: () => void
    createDataChannel() { return channel }
    addTransceiver() { return { setCodecPreferences: vi.fn() } }
    getStats() { return Promise.resolve(new Map()) }
    close = vi.fn()
  })
  vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs: [{ mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f' }] }) })
  const events = { packet: vi.fn(), track: vi.fn(), closed: vi.fn(), recovering: vi.fn() }
  const peer = new DesktopPeer(create(DesktopAttachmentSchema, { transport }), [], events)
  const change = (state: RTCPeerConnectionState) => {
    Object.defineProperty(peer.pc, 'connectionState', { configurable: true, value: state })
    peer.pc.onconnectionstatechange?.call(peer.pc, new Event('connectionstatechange'))
  }
  return { peer, change, events, channel }
}

test('视频短暂断线原连接恢复，旧定时器不关闭恢复后的连接', async () => {
  const { peer, change, events, channel } = recoveryPeer()
  try {
    change('disconnected')
    expect(events.recovering).toHaveBeenLastCalledWith(true)
    expect(() => peer.input({ kind: 'move', control: { generation: 1n } })).toThrow('desktop_media_recovering')
    expect(channel.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(9_000)
    expect(events.closed).not.toHaveBeenCalled()
    change('connected')
    expect(events.recovering).toHaveBeenLastCalledWith(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(events.closed).not.toHaveBeenCalled()
    change('disconnected')
    await vi.advanceTimersByTimeAsync(6_000)
    change('disconnected')
    await vi.advanceTimersByTimeAsync(4_000)
    expect(events.closed).toHaveBeenCalledExactlyOnceWith('desktop_recovery_timeout')
  } finally { peer.close() }
})

test('有未确认输入时不等待网络恢复，不重放输入', () => {
  const { peer, change, events, channel } = recoveryPeer()
  peer.input({ kind: 'key', code: 'KeyA', down: true, control: { generation: 1n } })
  change('disconnected')
  change('connected')
  expect(events.closed).toHaveBeenCalledExactlyOnceWith('desktop_input_uncertain')
  expect(channel.send).toHaveBeenCalledTimes(1)
  expect(events.recovering).not.toHaveBeenCalled()
})

test('渲染停顿导致状态事件迟到时，恢复定时器不误关已连通的媒体', async () => {
  const { peer, change, events } = recoveryPeer()
  try {
    change('disconnected')
    Object.defineProperty(peer.pc, 'connectionState', { configurable: true, value: 'connected' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(events.closed).not.toHaveBeenCalled()
    expect(events.recovering).toHaveBeenLastCalledWith(false)
  } finally { peer.close() }
})

test.each(['failed', 'closed'] as const)('媒体终止状态 %s 立即关闭，不等待恢复期限', state => {
  const { peer, change, events } = recoveryPeer()
  change('disconnected')
  change(state)
  expect(events.closed).toHaveBeenCalledTimes(1)
  expect(peer.pc.close).toHaveBeenCalledTimes(1)
})

test('透明 RFB 断开维持原有回收语义', () => {
  const { change, events } = recoveryPeer('rfb')
  change('disconnected')
  expect(events.closed).toHaveBeenCalledExactlyOnceWith('desktop_disconnected')
  expect(events.recovering).not.toHaveBeenCalled()
})

test('关闭后迟到媒体与消息回调不再交付给会话', () => {
  const { peer, events, channel } = recoveryPeer()
  peer.close()
  peer.pc.ontrack?.call(peer.pc, { track: { kind: 'video' }, streams: [{}] } as unknown as RTCTrackEvent)
  const receiver = channel as unknown as RTCDataChannel
  receiver.onmessage?.call(receiver, new MessageEvent('message', { data: new ArrayBuffer(0) }))
  expect(events.track).not.toHaveBeenCalled()
  expect(events.packet).not.toHaveBeenCalled()
  expect(events.closed).toHaveBeenCalledTimes(1)
})

test.each([
  ['revoked', 2n, false, false],
  ['released', undefined, false, false],
  ['same_lease', 1n, false, true],
  ['uncertain', 2n, true, true],
] as const)('输入拒绝只对权威控制撤销保留媒体：%s', async (_name, nextGeneration, uncertain, closed) => {
  const { peer, events, channel } = recoveryPeer()
  try {
    peer.input({ kind: 'key', code: 'KeyA', down: true, control: { generation: 1n } })
    const packet = create(DesktopPacketSchema, { kind: 'ack', controlGeneration: 1n, sequence: 1n, errorCode: 'desktop_control_stale', uncertain, state: { available: true, control: nextGeneration === undefined ? undefined : { generation: nextGeneration } } })
    const receiver = channel as unknown as RTCDataChannel
    receiver.onmessage?.call(receiver, new MessageEvent('message', { data: toBinary(DesktopPacketSchema, packet).buffer }))
    await vi.advanceTimersByTimeAsync(6_000)
    expect(events.closed).toHaveBeenCalledTimes(closed ? 1 : 0)
    expect(events.packet).toHaveBeenCalledTimes(closed ? 0 : 1)
    expect(channel.send).toHaveBeenCalledTimes(1)
  } finally { peer.close() }
})

test('旧租约拒绝携带的状态不能覆盖已经获得的新控制权', async () => {
  const { peer, events, channel } = recoveryPeer()
  const receiver = channel as unknown as RTCDataChannel
  try {
    peer.input({ kind: 'key', code: 'KeyA', down: true, control: { generation: 1n } })
    peer.resetInputSequence(3n)
    peer.input({ kind: 'key', code: 'KeyB', down: true, control: { generation: 3n } })
    for (const packet of [
      create(DesktopPacketSchema, { kind: 'ack', controlGeneration: 1n, sequence: 1n, errorCode: 'desktop_control_stale', state: { available: true, control: { generation: 2n } } }),
      create(DesktopPacketSchema, { kind: 'ack', controlGeneration: 3n, sequence: 1n }),
    ]) receiver.onmessage?.call(receiver, new MessageEvent('message', { data: toBinary(DesktopPacketSchema, packet).buffer }))
    await vi.advanceTimersByTimeAsync(6_000)
    expect(events.closed).not.toHaveBeenCalled()
    expect(events.packet).toHaveBeenCalledTimes(1)
    expect(events.packet.mock.calls[0][0].controlGeneration).toBe(3n)
    expect(channel.send).toHaveBeenCalledTimes(2)
  } finally { peer.close() }
})

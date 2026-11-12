import { create } from '@bufbuild/protobuf'
import { afterEach, expect, test, vi } from 'vitest'
import { RemoteDesktopSession, DesktopResponseSchema } from '@termous/remote-protocol/desktop'

const sdp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=ice-ufrag:fixture\r\na=recvonly\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 packetization-mode=1;profile-level-id=42e01f\r\n'
afterEach(() => vi.unstubAllGlobals())

function fixture(rejectFirst: boolean, remoteReject = false, rejection = new DOMException('synthetic rejection', 'NotSupportedError')) {
  const peers: { closed: boolean; configuration: RTCConfiguration; localDescription?: RTCSessionDescriptionInit }[] = []
  vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs: [{mimeType:'video/H264',sdpFmtpLine:'packetization-mode=1;profile-level-id=42e01f'}] }) })
  vi.stubGlobal('RTCPeerConnection', class extends EventTarget {
    closed = false
    connectionState = 'new'
    iceGatheringState = 'complete'
    localDescription?: RTCSessionDescriptionInit
    readonly index = peers.length
    configuration: RTCConfiguration
    constructor(configuration: RTCConfiguration) { super(); this.configuration = configuration; peers.push(this) }
    createDataChannel() { return Object.assign(new EventTarget(), {readyState:'open',bufferedAmount:0,send:vi.fn()}) }
    addTransceiver() { return {setCodecPreferences:vi.fn()} }
    async createOffer() { return {type:'offer',sdp} }
    async setLocalDescription(value: RTCSessionDescriptionInit) {
      if (rejectFirst && this.index === 0) throw rejection
      this.localDescription = value
    }
    async setRemoteDescription() {}
    async addIceCandidate() {}
    close() { this.closed = true }
  })
  const request = vi.fn(async (input: {action?: string; sdp?:string; negotiationId?:string; ice?: { sequence?:bigint }; iceAck?:bigint}) => {
    if (input.action === 'attach') return create(DesktopResponseSchema, {attachment:{id:'attachment',transport:'h264',mediaGeneration:1n}})
    if (input.action === 'describe') return create(DesktopResponseSchema, {state:{available:true}})
    if (input.action === 'offer') { if (remoteReject) throw new Error('desktop_h264_unsupported'); return create(DesktopResponseSchema, {sdp, negotiationId:input.negotiationId}) }
    return create(DesktopResponseSchema, {negotiationId: input.negotiationId, iceAck: input.ice?.sequence ?? input.iceAck})
  })
  const receiver = vi.fn()
  const runtime = new RemoteDesktopSession({capabilities:['desktop-trickle-ice-v1'], onICE:()=>()=>{}, request,ice:async()=>({ice_servers:[{urls:'turn:fixture.invalid',username:'fixture',credential:'fixture'}],transport_policy:'relay'}),receiverPolicy:'prefer_level_51'}, 'session',1n,{state:vi.fn(),status:vi.fn(),clipboard:vi.fn(),challenge:vi.fn(),receiver})
  return {runtime,request,peers,receiver}
}

test('生产准备路径本地回退只创建一个附着并发送一次原生 Offer', async () => {
  const {runtime,request,peers,receiver} = fixture(true)
  try {
    await runtime.start(document.createElement('div'),document.createElement('video'))
    expect(peers.map(peer => peer.configuration.iceTransportPolicy)).toEqual(['relay', 'relay']);
    expect(peers).toHaveLength(2); expect(peers[0].closed).toBe(true)
    expect(request.mock.calls.filter(([v])=>v.action === 'attach')).toHaveLength(1)
    const offers = request.mock.calls.filter(([v])=>v.action === 'offer')
    expect(offers).toHaveLength(1); expect(offers[0][0].sdp).toContain('42e01f')
    expect(receiver).toHaveBeenLastCalledWith(expect.objectContaining({policy:'native',fallbackReason:'desktop_h264_declaration_rejected'}))
    expect(request.mock.calls.some(([v])=>v.action === 'acquire')).toBe(false)
  } finally { await runtime.close() }
  expect(runtime.cleanupConfirmed).toBe(true)
})

test('成功提升使用原生最终 SDP，Core 拒绝后不自动重附着', async () => {
  const {runtime,request,peers} = fixture(false,true)
  await runtime.start(document.createElement('div'),document.createElement('video'))
  await runtime.close()
  expect(peers).toHaveLength(1)
  expect(request.mock.calls.filter(([v])=>v.action === 'offer')[0][0].sdp).toBe(peers[0].localDescription?.sdp)
  expect(peers[0].localDescription?.sdp).toContain('42e033')
  expect(request.mock.calls.map(([v])=>v.action)).toEqual(['attach','describe','offer','detach'])
})

test.each(['InvalidStateError', 'AbortError', 'NotAllowedError'])('本地 %s 不触发能力回退', async name => {
  const {runtime, request, peers} = fixture(true, false, new DOMException('synthetic failure', name))
  await runtime.start(document.createElement('div'), document.createElement('video'))
  await runtime.close()
  expect(peers).toHaveLength(1)
  expect(peers[0].closed).toBe(true)
  expect(request.mock.calls.map(([value]) => value.action)).toEqual(['attach', 'describe', 'detach'])
})

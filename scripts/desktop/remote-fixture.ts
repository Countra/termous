import { create, fromJson, toJson, type MessageInitShape } from '@bufbuild/protobuf'
import { DesktopRequestSchema, type DesktopICEEvent, type DesktopStreamState } from '@termous/remote-protocol/desktop-protocol'
import { RemoteDesktopSession } from '@termous/remote-protocol/desktop'
import { ResponseSchema, SessionSchema, EventSchema } from '@termous/remote-protocol'
import { openExistingViewer } from './remote-existing-viewer.ts'

const output = document.querySelector('#result')!
const api = async (path: string, input?: unknown) => {
  const r = await fetch(`/fixture/${path}`, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Termous-Fixture': 'desktop', 'Content-Type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) })
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.status === 204 ? null : r.json()
}
const wait = () => new Promise(resolve => setTimeout(resolve, 50))
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
let view: RemoteDesktopSession
let local: Awaited<ReturnType<typeof openExistingViewer>> | undefined
let step = 'connect', failure = ''
const eventsAbort = new AbortController()
void (async () => {
  const iceListeners = new Set<(value: DesktopICEEvent) => void>()
  const streamListeners = new Set<(value: DesktopStreamState) => void>()
  const events = await fetch('/fixture/events', { headers: { 'X-Termous-Fixture': 'desktop' }, signal: eventsAbort.signal })
  if (!events.ok || !events.body) throw new Error('missing parent events')
  const reader = events.body.pipeThrough(new TextDecoderStream()).getReader()
  void (async () => {
    let pending = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      pending += value
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim()
        pending = pending.slice(newline + 1)
        if (!line) continue
        const event = fromJson(EventSchema, JSON.parse(line))
        if (event.value.case === 'desktopIce') for (const listener of iceListeners) listener(event.value.value)
        if (event.value.case === 'desktopStreamState') for (const listener of streamListeners) listener(event.value.value)
      }
    }
  })().catch(error => { if (!eventsAbort.signal.aborted) failure = String(error) })
  let session = fromJson(SessionSchema, await api('session'))
  for (let i = 0; !['ready', 'streaming'].includes(session.state); i++) { if (i > 100) throw new Error('not ready'); await wait(); session = fromJson(SessionSchema, await api('session')) }
  const existing = session.engine === 'vnc' && new URLSearchParams(location.search).has('existing')
  if (existing) local = await openExistingViewer(session.id, session.generation)
  let attachment: MessageInitShape<typeof DesktopRequestSchema> = {}
  const request = async (input: MessageInitShape<typeof DesktopRequestSchema>) => {
    const response = fromJson(ResponseSchema, await api('request', toJson(DesktopRequestSchema, create(DesktopRequestSchema, input))))
    if (response.error) throw new Error(`${input.action}: ${response.error.code}`)
    if (response.result.case !== 'desktop') throw new Error('wrong response')
    const r = response.result.value
    if (r.attachment) attachment = { sessionId: session.id, connectionGeneration: session.generation, attachmentId: r.attachment.id, mediaGeneration: r.attachment.mediaGeneration }
    return r
  }
  let phase = ''
  const createViewer = () => new RemoteDesktopSession({ request, ice: async () => api('ice'), protocol: session.engine === 'rdp' ? 'rdp' : 'vnc',
    capabilities: ['desktop-trickle-ice-v1', 'desktop-presentation-v1', 'desktop-video-limits-v2', 'desktop-video-stability-v1'],
    onICE: listener => { iceListeners.add(listener); return () => iceListeners.delete(listener) },
    onStreamState: listener => { streamListeners.add(listener); return () => streamListeners.delete(listener) },
  }, session.id, session.generation, {
    state: () => {}, status: (value, reason) => { phase = value; if (reason) { failure = reason; output.textContent = `FAILED: ${reason}` } }, clipboard: () => {}, challenge: async () => ({ accept: false }),
  })
  const startViewer = async (current: RemoteDesktopSession) => {
    phase = ''
    await current.start(document.querySelector('#desktop')!, document.querySelector('#video')!)
    for (let i = 0; phase !== 'viewing'; i++) { if (phase === 'closed' || i > 160) throw new Error(`viewer not ready: ${phase}`); await wait() }
    if (!current.owned) await current.acquire(false)
  }
  const checkVNCPixels = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#desktop canvas')!
    const pixel = canvas.getContext('2d')!.getImageData(300, 200, 1, 1).data
    assert(pixel[0] === 30 && pixel[1] === 20 && pixel[2] === 10, 'remote VNC pixels invalid')
    document.querySelector<HTMLElement>('#desktop')!.dataset.lastFrame = canvas.toDataURL('image/png')
  }
  view = createViewer()
  await startViewer(view)
  assert(view.owned, 'control acquisition')
  if (existing) assert(local?.disconnected(), 'local stream not handed off')
  if (session.engine === 'vnc') checkVNCPixels()
  if (session.engine === 'rdp') {
    const video = document.querySelector<HTMLVideoElement>('#video')!
    assert(video.videoWidth === 800 && video.videoHeight === 600, 'H.264 decoded size')
    assert((video.srcObject as MediaStream).getAudioTracks().length === 0, 'unexpected audio track')
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600
    const context = canvas.getContext('2d')!; context.drawImage(video, 0, 0)
    const pixel = context.getImageData(400, 300, 1, 1).data
    assert(pixel[0] > 150 && pixel[1] < 80 && pixel[2] < 80, 'H.264 decoded pixel channels')
  }
  step = 'capture'
  const first = await request({ ...attachment, action: 'capture', capture: { maxWidth: 400 } })
  assert(first.image?.width === 400 && first.image.height === 300, 'remote screenshot scale')
  step = 'click'
  view.input({ kind: 'click', button: 'left', x: 400, y: 300 })
  if (session.engine === 'rdp') {
    // worker 夹具延迟鼠标执行；此时续租应排队，不得把正常并发误报为桌面断开。
    await wait()
    const current = await request({ ...attachment, action: 'describe' })
    assert(current.state?.control, 'missing control during input')
    await request({ ...attachment, action: 'renew', control: current.state!.control })
    assert(phase === 'viewing', 'renewal interrupted active input')
  }
  step = 'text'
  await view.command('text', 'Termous 中文')
  await wait()
  step = 'after_sequence'
  const second = await request({ ...attachment, action: 'capture', capture: { afterSequence: first.image!.frameSequence, maxWidth: 400 } })
  assert(second.image!.frameSequence > first.image!.frameSequence, 'stale frame after input')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  for (let offset = 0; offset < second.image!.totalBytes;) {
    const part = await request({ ...attachment, action: 'image', captureId: second.image!.id, offset })
    assert(part.image?.data.length, 'empty screenshot chunk'); chunks.push(new Uint8Array(part.image!.data)); offset += part.image!.data.length
  }
  const snapshot = document.querySelector<HTMLImageElement>('#snapshot')!
  snapshot.src = URL.createObjectURL(new Blob(chunks, { type: 'image/png' }))
  await snapshot.decode()
  if (session.engine === 'rdp') {
    // 另一主体收回控制后，模拟状态尚未同步时发出的旧租约输入。
    const previous = await request({ ...attachment, action: 'describe' })
    await api('reclaim', {})
    view.peer!.send({ kind: 'input', input: { kind: 'key', code: 'KeyA', down: true, control: previous.state!.control, sequence: 60n, displayEpoch: previous.state!.displayEpoch } })
    for (let i = 0; view.owned; i++) { if (phase === 'closed' || i > 100) throw new Error('revoked input interrupted video'); await wait() }
    await wait()
    assert(phase === 'viewing', 'revoked control ended viewing')
    await view.acquire(true)
    assert(view.owned, 'explicit takeover after revocation')
  }
  step = 'release'
  await view.release()
  assert(!view.owned, 'control retained after release')
  step = 'reacquire'
  await view.acquire(false)
  assert(view.owned, 'control reacquisition')
  if (session.engine === 'rdp') {
    const current = await request({ ...attachment, action: 'describe' })
    // 相同有效租约的乱序输入不能被宽容处理，否则会掩盖输入序列损坏。
    view.peer!.send({ kind: 'input', input: { kind: 'key', code: 'KeyA', down: true, control: current.state!.control, sequence: 60n, displayEpoch: current.state!.displayEpoch } })
    for (let i = 0; phase !== 'closed'; i++) { if (i > 100) throw new Error('invalid sequence did not close attachment'); await wait() }
  }
  step = 'close'
  await view.close()
  if (session.engine === 'rdp') assert(document.querySelector<HTMLVideoElement>('#video')!.srcObject === null, 'video source retained after close')
  const state = await request({ sessionId: session.id, connectionGeneration: session.generation, action: 'describe' })
  assert(!state.state?.attachmentId, 'attachment not released')
  if (existing) {
    local?.close()
    // 在同一协议会话内连续交接，旧执行器与旧租约不能污染后续附着。
    for (let cycle = 0; cycle < 2; cycle++) {
      step = `handoff_${cycle + 2}`
      local = await openExistingViewer(session.id, session.generation)
      view = createViewer()
      await startViewer(view)
      assert(local.disconnected() && view.owned, 'repeated handoff or control failed')
      checkVNCPixels()
      await view.close()
      local.close()
    }
    local = await openExistingViewer(session.id, session.generation)
    local.close()
  }
  output.textContent = JSON.stringify({ passed: true, checks: ['独立 WebRTC', session.engine === 'rdp' ? 'OpenH264 + libyuv → worker WS → Pion → video 解码、无音频轨道' : 'noVNC Raw/CopyRect/Tight PNG', '执行 DataChannel', '控制申请／释放／重新申请', '程序点击', 'Unicode 输入', '截图分块和 PNG 解码', '附着完整回收', ...(existing ? ['同一会话连续三轮本机／远控交接', '控制端实际像素', '退出后本机画面恢复'] : [])] }, null, 2)
  await api('result?passed=true', {})
})().catch(async error => { output.textContent = `FAILED: ${step}: ${String(error)}${failure ? `; channel=${failure}` : ''}`; await view?.close(); await api('result?passed=false', {}).catch(() => {}) }).finally(() => { local?.close(); eventsAbort.abort() })

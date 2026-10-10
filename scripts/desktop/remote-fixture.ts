import { create, fromJson, toJson, type MessageInitShape } from '@bufbuild/protobuf'
import { DesktopRequestSchema } from '@termous/remote-protocol/desktop-protocol'
import { RemoteDesktopSession } from '@termous/remote-protocol/desktop'
import { ResponseSchema, SessionSchema } from '@termous/remote-protocol'

const output = document.querySelector('#result')!
const api = async (path: string, input?: unknown) => {
  const r = await fetch(`/fixture/${path}`, { method: input === undefined ? 'GET' : 'POST', headers: { 'X-Termous-Fixture': 'desktop', 'Content-Type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) })
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.status === 204 ? null : r.json()
}
const wait = () => new Promise(resolve => setTimeout(resolve, 50))
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
let view: RemoteDesktopSession
void (async () => {
  let session = fromJson(SessionSchema, await api('session'))
  for (let i = 0; session.state !== 'ready'; i++) { if (i > 100) throw new Error('not ready'); await wait(); session = fromJson(SessionSchema, await api('session')) }
  let attachment: MessageInitShape<typeof DesktopRequestSchema> = {}
  const request = async (input: MessageInitShape<typeof DesktopRequestSchema>) => {
    const response = fromJson(ResponseSchema, await api('request', toJson(DesktopRequestSchema, create(DesktopRequestSchema, input))))
    if (response.error) throw new Error(response.error.code)
    if (response.result.case !== 'desktop') throw new Error('wrong response')
    const r = response.result.value
    if (r.attachment) attachment = { sessionId: session.id, connectionGeneration: session.generation, attachmentId: r.attachment.id, mediaGeneration: r.attachment.mediaGeneration }
    return r
  }
  let phase = ''
  view = new RemoteDesktopSession({ request, ice: async () => [] }, session.id, session.generation, {
    state: () => {}, status: (value, reason) => { phase = value; if (reason) output.textContent = `FAILED: ${reason}` }, clipboard: () => {}, challenge: async () => ({ accept: false }),
  })
  await view.start(document.querySelector('#desktop')!, document.querySelector('#video')!)
  for (let i = 0; phase !== 'viewing'; i++) { if (phase === 'closed' || i > 160) throw new Error(`viewer not ready: ${phase}`); await wait() }
  if (!view.owned) await view.acquire(false)
  assert(view.owned, 'control acquisition')
  if (session.engine === 'rdp') {
    const video = document.querySelector<HTMLVideoElement>('#video')!
    assert(video.videoWidth === 800 && video.videoHeight === 600, 'H.264 decoded size')
    assert((video.srcObject as MediaStream).getAudioTracks().length === 0, 'unexpected audio track')
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600
    const context = canvas.getContext('2d')!; context.drawImage(video, 0, 0)
    const pixel = context.getImageData(400, 300, 1, 1).data
    assert(pixel[0] > 150 && pixel[1] < 80 && pixel[2] < 80, 'H.264 decoded pixel channels')
  }
  const first = await request({ ...attachment, action: 'capture', capture: { maxWidth: 400 } })
  assert(first.image?.width === 400 && first.image.height === 300, 'remote screenshot scale')
  view.input({ kind: 'click', button: 'left', x: 400, y: 300 })
  await view.command('text', 'Termous 中文')
  await wait()
  const second = await request({ ...attachment, action: 'capture', capture: { afterSequence: first.image!.frameSequence, maxWidth: 400 } })
  assert(second.image!.frameSequence > first.image!.frameSequence, 'stale frame after input')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  for (let offset = 0; offset < second.image!.totalBytes;) {
    const part = await request({ ...attachment, action: 'image', captureId: second.image!.id, offset })
    assert(part.image?.data.length, 'empty screenshot chunk'); chunks.push(new Uint8Array(part.image!.data)); offset += part.image!.data.length
  }
  document.querySelector<HTMLImageElement>('#snapshot')!.src = URL.createObjectURL(new Blob(chunks, { type: 'image/png' }))
  await view.close()
  const state = await request({ sessionId: session.id, connectionGeneration: session.generation, action: 'describe' })
  assert(!state.state?.attachmentId, 'attachment not released')
  output.textContent = JSON.stringify({ passed: true, checks: ['独立 WebRTC', session.engine === 'rdp' ? 'OpenH264 + libyuv → worker WS → Pion → video 解码、无音频轨道' : 'noVNC Raw/CopyRect/Tight PNG', '执行 DataChannel', '控制权', '程序点击', 'Unicode 输入', '截图分块', '附着完整回收'] }, null, 2)
  await api('result?passed=true', {})
})().catch(async error => { output.textContent = `FAILED: ${String(error)}`; await view?.close(); await api('result?passed=false', {}).catch(() => {}) })

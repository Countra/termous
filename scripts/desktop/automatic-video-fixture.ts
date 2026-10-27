import { videoDefaultCapabilities, videoModeForSize } from '@termous/remote-protocol/presentation'
import { H264VideoAdapter } from '../../../termous-remote/browser/desktop/adapters/h264Video'

const result = document.querySelector('#result')!
const video = document.querySelector<HTMLVideoElement>('#video')!
const sender = new RTCPeerConnection({ iceServers: [] })
const receiver = new RTCPeerConnection({ iceServers: [] })
const canvas = document.createElement('canvas')
const source = { width: 2560, height: 1440 }
canvas.width = source.width; canvas.height = source.height
const context = canvas.getContext('2d')!
let frame = 0, timer: ReturnType<typeof setInterval> | undefined, stream: MediaStream | undefined
let decodeTimeout: ReturnType<typeof setTimeout> | undefined
let adapter: H264VideoAdapter | undefined
const closed = () => {
  clearInterval(timer); clearTimeout(decodeTimeout); stream?.getTracks().forEach(track => track.stop())
  adapter?.close(); sender.close(); receiver.close()
}
window.addEventListener('pagehide', closed, { once: true })

const gather = (peer: RTCPeerConnection) => peer.iceGatheringState === 'complete' ? Promise.resolve() : new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => { peer.removeEventListener('icegatheringstatechange', changed); reject(new Error('ICE gathering timed out')) }, 10_000)
  const changed = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', changed); resolve() } }
  peer.addEventListener('icegatheringstatechange', changed)
})

void (async () => {
  const mode = videoModeForSize({ ...videoDefaultCapabilities, sourceWidth: source.width, sourceHeight: source.height }, 'auto')
  if (mode?.maxWidth !== source.width || mode.maxHeight !== source.height) throw new Error('automatic resolution did not preserve the source')
  const paint = () => {
    context.fillStyle = '#12304f'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#fff'; context.font = '64px sans-serif'; context.fillText(`2560 × 1440 · frame ${frame++}`, 80, 130)
    context.fillStyle = '#2ee59d'; context.fillRect((frame * 32) % 2200, 400, 300, 300)
  }
  paint(); timer = setInterval(paint, 100)
  stream = canvas.captureStream(10)
  const track = stream.getVideoTracks()[0]
  const transceiver = sender.addTransceiver(track, { streams: [stream], direction: 'sendonly' })
  const codecs = RTCRtpSender.getCapabilities('video')?.codecs.filter(codec => codec.mimeType.toLowerCase() === 'video/h264') ?? []
  if (!codecs.length) throw new Error('H.264 is unavailable in this browser')
  // 使用浏览器真实提供的编码能力，不改写 SDP 或伪造更高等级。
  transceiver.setCodecPreferences(codecs)
  const decoded = new Promise<void>((resolve, reject) => {
    decodeTimeout = setTimeout(() => reject(new Error(`decoded size timed out: ${video.videoWidth} × ${video.videoHeight}`)), 20_000)
    adapter = new H264VideoAdapter(video, async () => { throw new Error('configuration is exercised by the service tests') }, () => {}, reason => { clearTimeout(decodeTimeout); reject(new Error(reason)) }, observed => {
      if (observed.width === source.width && observed.height === source.height && (observed.viewportWidth ?? 0) < source.width) { clearTimeout(decodeTimeout); resolve() }
    })
  })
  // 先挂接拒绝处理，协商失败时不会遗留未处理的超时 Promise。
  void decoded.catch(() => {})
  receiver.ontrack = event => adapter!.mount(event.streams[0])
  await sender.setLocalDescription(await sender.createOffer()); await gather(sender)
  await receiver.setRemoteDescription(sender.localDescription!)
  await receiver.setLocalDescription(await receiver.createAnswer()); await gather(receiver)
  await sender.setRemoteDescription(receiver.localDescription!)
  await decoded
  const report = await receiver.getStats()
  let codec = ''
  report.forEach(item => { if (item.type === 'inbound-rtp' && item.kind === 'video') codec = report.get(item.codecId)?.mimeType ?? '' })
  if (codec.toLowerCase() !== 'video/h264') throw new Error(`unexpected codec: ${codec}`)
  result.textContent = JSON.stringify({ passed: true, source, selected: { width: mode.maxWidth, height: mode.maxHeight }, decoded: { width: video.videoWidth, height: video.videoHeight }, viewport: { width: video.clientWidth, height: video.clientHeight }, codec }, null, 2)
  const poster = document.createElement('canvas'); poster.width = 640; poster.height = 360
  poster.getContext('2d')!.drawImage(video, 0, 0, poster.width, poster.height)
  video.poster = poster.toDataURL('image/png')
})().catch(error => { result.textContent = `FAILED: ${String(error)}` }).finally(closed)

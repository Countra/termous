import { WebSocket, type RawData } from 'ws'
import { fromBinary } from '@bufbuild/protobuf'
import { StreamFrameSchema } from '@termous/remote-protocol'
import type { AppConfig } from '#common/contracts'
import { RemoteCoreError } from './core'

// 每个窗口的未消费字节有上限；渲染完成后才确认，避免终端输出淹没主进程。
export class RemoteTerminalStream {
  private socket?: WebSocket
  private sequence = 0
  private outstanding = new Map<number, number>()
  private buffered = 0
  private stopped = false

  constructor(private receive: (sequence: number, bytes: Uint8Array) => void, private closed: () => void) {}

  async open(config: AppConfig, generation: string, id: string) {
    if (this.stopped) throw new RemoteCoreError('remote_disconnected')
    if (this.socket) return
    const url = new URL(`/api/v1/remote-control/connections/${encodeURIComponent(id)}/stream`, config.apiBaseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('generation', generation)
    const socket = new WebSocket(url, { headers: { 'X-Termous-Token': config.apiToken }, followRedirects: false, maxPayload: 65536, handshakeTimeout: 8000, perMessageDeflate: false })
    this.socket = socket
    socket.on('message', (data: RawData, binary: boolean) => {
      const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
      if (!binary || bytes.length > 65536 || this.buffered + bytes.length > 512 * 1024 || this.outstanding.size >= 128) {
        this.close()
        return
      }
      const sequence = ++this.sequence
      this.outstanding.set(sequence, bytes.length)
      this.buffered += bytes.length
      this.receive(sequence, new Uint8Array(bytes))
      if (this.buffered >= 256 * 1024) socket.pause()
    })
    socket.on('error', () => this.close())
    socket.on('close', () => this.close())
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', () => reject(new RemoteCoreError('remote_stream_unavailable')))
      socket.once('close', () => reject(new RemoteCoreError('remote_disconnected')))
    })
  }

  consume(sequence: number) {
    const size = this.outstanding.get(sequence)
    if (size === undefined) return
    this.outstanding.delete(sequence)
    this.buffered -= size
    if (this.buffered < 128 * 1024) this.socket?.resume()
  }

  async send(data: unknown) {
    if (!(data instanceof Uint8Array) || data.byteLength > 17 * 1024) throw new RemoteCoreError('remote_invalid_request')
    const frame = fromBinary(StreamFrameSchema, data)
    if (!['terminal_input', 'credit', 'close'].includes(frame.kind) || frame.data.length > 16384 || frame.credit > 262144n) throw new RemoteCoreError('remote_invalid_request')
    const socket = this.socket
    if (this.stopped || !socket || socket.readyState !== WebSocket.OPEN) throw new RemoteCoreError('remote_disconnected')
    if (socket.bufferedAmount > 256 * 1024) throw new RemoteCoreError('remote_capacity_exceeded')
    await new Promise<void>((resolve, reject) => socket.send(data, { binary: true }, error => error ? reject(new RemoteCoreError('remote_send_failed', true)) : resolve()))
    return true
  }

  close() {
    if (this.stopped) return
    this.stopped = true
    this.socket?.terminate()
    this.outstanding.clear()
    this.buffered = 0
    this.closed()
  }
}

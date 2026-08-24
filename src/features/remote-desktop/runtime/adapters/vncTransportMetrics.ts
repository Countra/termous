import type { VncTransportMetricsSnapshot } from '../../model/viewerTypes.ts'

const sampleIntervalMs = 1000

export class VncTransportMetrics {
  readonly channel: WebSocket

  private connectedAt: number | null = null
  private receivedBytes = 0
  private sentBytes = 0
  private previousReceivedBytes = 0
  private previousSentBytes = 0
  private previousSampleAt = performance.now()
  private timer: number | undefined
  private disposed = false
  private outboundMeasured = false

  constructor(
    url: string,
    private readonly onMetrics: (metrics: VncTransportMetricsSnapshot) => void,
  ) {
    this.channel = new WebSocket(url, ['binary'])
    this.channel.addEventListener('message', this.handleMessage)
    this.outboundMeasured = this.instrumentSend()
    this.timer = window.setInterval(this.sample, sampleIntervalMs)
  }

  markConnected() {
    if (this.connectedAt === null) {
      this.connectedAt = Date.now()
      this.publish(0, 0)
    }
  }

  dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.channel.removeEventListener('message', this.handleMessage)
    if (this.timer !== undefined) {
      window.clearInterval(this.timer)
      this.timer = undefined
    }
  }

  close() {
    if (this.channel.readyState === WebSocket.CONNECTING || this.channel.readyState === WebSocket.OPEN) {
      this.channel.close()
    }
    this.dispose()
  }

  private readonly handleMessage = (event: MessageEvent) => {
    this.receivedBytes += payloadByteLength(event.data)
  }

  private readonly sample = () => {
    if (this.disposed) {
      return
    }
    const currentSampleAt = performance.now()
    const elapsed = Math.max(1, currentSampleAt - this.previousSampleAt)
    const receiveRate = Math.round((this.receivedBytes - this.previousReceivedBytes) * 1000 / elapsed)
    const sendRate = Math.round((this.sentBytes - this.previousSentBytes) * 1000 / elapsed)
    this.previousSampleAt = currentSampleAt
    this.previousReceivedBytes = this.receivedBytes
    this.previousSentBytes = this.sentBytes
    this.publish(receiveRate, sendRate)
  }

  private publish(receiveBytesPerSecond: number, sendBytesPerSecond: number) {
    if (this.disposed) {
      return
    }
    this.onMetrics({
      connectedAt: this.connectedAt,
      sampledAt: Date.now(),
      receivedBytes: this.receivedBytes,
      sentBytes: this.sentBytes,
      receiveBytesPerSecond,
      sendBytesPerSecond,
      bufferedAmount: this.channel.bufferedAmount,
      outboundMeasured: this.outboundMeasured,
    })
  }

  private instrumentSend() {
    const send = this.channel.send.bind(this.channel)
    try {
      Object.defineProperty(this.channel, 'send', {
        configurable: true,
        value: (data: string | Blob | BufferSource) => {
          send(data)
          this.sentBytes += payloadByteLength(data)
        },
      })
      return true
    } catch {
      return false
    }
  }
}

function payloadByteLength(value: unknown) {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value).byteLength
  }
  if (value instanceof Blob) {
    return value.size
  }
  if (value instanceof ArrayBuffer) {
    return value.byteLength
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength
  }
  return 0
}

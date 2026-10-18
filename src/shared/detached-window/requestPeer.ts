import { sameDetachedConnection, type DetachedConnection, type DetachedPacket } from '#common/contracts'

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class DetachedRequestPeer {
  private readonly pending = new Map<string, Pending>()
  private readonly received = new Map<string, Promise<{ payload?: unknown; error?: string }>>()
  private closed = false

  readonly connection: DetachedConnection
  private readonly send: (packet: DetachedPacket) => void
  constructor(connection: DetachedConnection, send: (packet: DetachedPacket) => void) { this.connection = connection; this.send = send }

  request(operation: NonNullable<DetachedPacket['operation']>, payload?: unknown, timeout = 15000, id: string = crypto.randomUUID()) {
    if (this.closed || this.pending.size >= 128) return Promise.reject(new Error('detached_disconnected'))
    if (this.pending.has(id)) return Promise.reject(new Error('detached_request_pending'))
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('detached_request_timeout')) }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ connection: this.connection, kind: 'request', id, operation, payload }) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }

  accept(packet: DetachedPacket, handle: (packet: DetachedPacket) => Promise<unknown>, retainResponse = true) {
    if (this.closed || !sameDetachedConnection(packet.connection, this.connection)) return false
    if (packet.kind === 'response' && packet.id) {
      const pending = this.pending.get(packet.id)
      if (!pending) return true
      this.pending.delete(packet.id)
      clearTimeout(pending.timer)
      if (packet.error) pending.reject(new Error(packet.error))
      else pending.resolve(packet.payload)
      return true
    }
    if (packet.kind !== 'request' || !packet.id) return false
    let response = this.received.get(packet.id)
    if (!response) {
      // 去重表在整代连接内保留。达到上限后拒绝新命令，不能驱逐旧 ID 后重新执行。
      if (this.received.size >= 20000) {
        this.send({ connection: this.connection, kind: 'response', id: packet.id, error: 'detached_request_limit' })
        return true
      }
      response = Promise.resolve().then(() => {
        // 请求入队后连接可能先被释放；尚未开始的业务不能跨窗口代次继续执行。
        if (this.closed) throw new Error('detached_disconnected')
        return handle(packet)
      }).then(payload => ({ payload }), () => ({ error: 'detached_operation_failed' }))
      this.received.set(packet.id, response)
    }
    void response.then(result => {
      if (!this.closed) this.send({ connection: this.connection, kind: 'response', id: packet.id, ...result })
      // 适配器声明可安全重复的读取不保留响应，避免图片内容在整代连接中累计。
      if (!retainResponse && this.received.get(packet.id!) === response) this.received.delete(packet.id!)
    })
    return true
  }

  dispose() {
    this.closed = true
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('detached_disconnected')) }
    this.pending.clear()
    this.received.clear()
  }
}

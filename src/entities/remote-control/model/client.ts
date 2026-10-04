import { create, fromBinary, fromJson, toBinary, toJson, type MessageInitShape } from '@bufbuild/protobuf'
import { EnvelopeSchema, RequestSchema, ResponseSchema, StreamFrameSchema, type Event, type StreamFrame } from '@termous/remote-protocol'
import type { RemoteConnection, RemoteResult, RemoteWindowBridge, RemoteLocalSelection } from '#common/contracts'

export class RemoteError extends Error {
  constructor(readonly code: string, readonly uncertain = false) { super(code) }
}
export function unwrap<T>(value: RemoteResult<T>): T {
  if (!value.ok) throw new RemoteError(value.code, value.uncertain)
  return value.value
}

export class RemoteClient {
  private streams = new Map<string, (frame: StreamFrame) => Promise<void> | void>()
  private events = new Set<(event: Event) => void>()
  private stop?: () => void
  constructor(readonly bridge: RemoteWindowBridge, readonly connection: RemoteConnection) {}

  start(closed: () => void) {
    this.stop?.()
    this.stop = this.bridge.subscribe((sequence, data) => {
      void this.receive(data).catch(closed).finally(() => this.bridge.consume(sequence))
    }, closed)
  }
  private async receive(data: Uint8Array) {
    const envelope = fromBinary(EnvelopeSchema, data)
    if (envelope.connectionId !== this.connection.id || envelope.generation.toString() !== this.connection.scope.generation) throw new RemoteError('remote_stale')
    if (envelope.payload.case === 'stream') await this.streams.get(envelope.payload.value.streamId)?.(envelope.payload.value)
    else if (envelope.payload.case === 'event') for (const listener of this.events) listener(envelope.payload.value)
  }
  async request(input: MessageInitShape<typeof RequestSchema>) {
    const value = unwrap(await this.bridge.request(toJson(RequestSchema, create(RequestSchema, input))))
    const response = fromJson(ResponseSchema, value)
    if (response.error) throw new RemoteError(response.error.code, response.error.uncertain)
    return response
  }
  stream(id: string, callback: (frame: StreamFrame) => Promise<void> | void) {
    this.streams.set(id, callback)
    return () => { if (this.streams.get(id) === callback) this.streams.delete(id) }
  }
  onEvent(callback: (event: Event) => void) { this.events.add(callback); return () => { this.events.delete(callback) } }
  async selectTransfer(input: RemoteLocalSelection) { return unwrap(await this.bridge.selectTransfer(input)) }
  async localTransfers() { return unwrap(await this.bridge.localTransfers()) }
  async localTransferAction(id: string, action: 'resume' | 'cancel') { return unwrap(await this.bridge.localTransferAction(id, action)) }
  async send(input: MessageInitShape<typeof StreamFrameSchema>) {
    unwrap(await this.bridge.send(toBinary(StreamFrameSchema, create(StreamFrameSchema, input))))
  }
  dispose() { this.stop?.(); this.stop = undefined; this.streams.clear(); this.events.clear() }
}

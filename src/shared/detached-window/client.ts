import type { DetachedBootstrap, DetachedPacket, DetachedWindowBridge } from '#common/contracts'
import { sameDetachedConnection } from '#common/contracts'
import { DetachedRequestPeer } from './requestPeer.ts'

export class DetachedClient {
  readonly peer: DetachedRequestPeer
  private readonly listeners = new Set<(packet: DetachedPacket) => void>()
  private handler?: (packet: DetachedPacket) => Promise<unknown>
  constructor(readonly bootstrap: DetachedBootstrap, private readonly bridge: DetachedWindowBridge) {
    const { module, instance, generation } = bootstrap
    this.peer = new DetachedRequestPeer({ module, instance, generation }, packet => bridge.send(packet))
  }
  accept(packet: DetachedPacket) {
    if (!sameDetachedConnection(packet.connection, this.bootstrap)) return
    if (this.peer.accept(packet, request => this.handler ? this.handler(request) : Promise.reject(new Error('detached_not_ready')))) return
    for (const listener of this.listeners) listener(packet)
  }
  subscribe(listener: (packet: DetachedPacket) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  handle(handler: (packet: DetachedPacket) => Promise<unknown>) { this.handler = handler; return () => { if (this.handler === handler) this.handler = undefined } }
  ready() { this.bridge.send({ connection: this.bootstrap, kind: 'ready' }) }
  dispose() { this.peer.dispose(); this.listeners.clear(); this.handler = undefined }
}

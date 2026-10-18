export type DetachedPhase = 'embedded' | 'opening' | 'detached' | 'returning'
export interface DetachedIdentity { module: string; instance: string }
export interface DetachedConnection extends DetachedIdentity { generation: string }
export interface DetachedAppearance { theme: 'light' | 'dark'; language: 'en-US' | 'zh-CN' }
export interface DetachedBootstrap extends DetachedConnection { appearance: DetachedAppearance }
export interface DetachedRect { x: number; y: number; width: number; height: number }
export interface DetachedPacket {
  connection: DetachedConnection
  kind: 'initialize' | 'request' | 'response' | 'state' | 'ready' | 'return' | 'closed' | 'appearance'
  id?: string
  operation?: 'snapshot' | 'command' | 'binary' | 'flush' | 'return' | 'reveal'
  payload?: unknown
  error?: string
}
export interface DetachedOwnerBridge {
  open: (identity: DetachedIdentity, rect?: DetachedRect) => Promise<DetachedConnection & { capture?: string }>
  focus: (identity: DetachedIdentity) => Promise<boolean>
  close: (connection: DetachedConnection) => Promise<void>
  reveal: () => Promise<void>
  send: (packet: DetachedPacket) => void
  subscribe: (listener: (packet: DetachedPacket) => void) => () => void
}
export interface DetachedWindowBridge {
  debugMode?: boolean
  bootstrap: () => Promise<DetachedBootstrap>
  send: (packet: DetachedPacket) => void
  subscribe: (listener: (packet: DetachedPacket) => void) => () => void
}
export const detachedChannels = {
  open: 'detached:open', focus: 'detached:focus', close: 'detached:close',
  reveal: 'detached:reveal', bootstrap: 'detached:bootstrap', packet: 'detached:packet',
} as const

export function sameDetachedConnection(a: DetachedConnection, b: DetachedConnection) {
  return a.module === b.module && a.instance === b.instance && a.generation === b.generation
}

export function isDetachedIdentity(value: unknown): value is DetachedIdentity {
  if (!value || typeof value !== 'object') return false
  const candidate = value as DetachedIdentity
  return [candidate.module, candidate.instance].every(part => typeof part === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(part))
}

export function isDetachedPacket(value: unknown): value is DetachedPacket {
  if (!value || typeof value !== 'object') return false
  const packet = value as DetachedPacket
  return isDetachedIdentity(packet.connection) && typeof packet.connection.generation === 'string'
    && packet.connection.generation.length > 0 && packet.connection.generation.length <= 80
    && ['initialize', 'request', 'response', 'state', 'ready', 'return', 'closed', 'appearance'].includes(packet.kind)
    && (packet.id === undefined || typeof packet.id === 'string' && packet.id.length <= 100)
    && (packet.error === undefined || typeof packet.error === 'string' && packet.error.length <= 200)
    && (packet.operation === undefined || ['snapshot', 'command', 'binary', 'flush', 'return', 'reveal'].includes(packet.operation))
}

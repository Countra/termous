import type { IpcMainEvent, IpcMainInvokeEvent, BrowserWindow } from 'electron'
import { isDetachedPacket, sameDetachedConnection, detachedChannels, type DetachedConnection, type DetachedPacket } from '#common/contracts'
import type { DetachedModuleRegistration } from './registry.ts'

export interface DetachedEntry {
  window: BrowserWindow
  connection: DetachedConnection
  registration: DetachedModuleRegistration
  url: string
  ready: boolean
  started?: boolean
  timer?: ReturnType<typeof setTimeout>
}

export function trustedDetachedEntry(entries: Iterable<DetachedEntry>, event: IpcMainEvent | IpcMainInvokeEvent) {
  return [...entries].find(entry => !entry.window.isDestroyed() && event.sender === entry.window.webContents
    && event.senderFrame === event.sender.mainFrame && event.senderFrame?.url === entry.url)
}

export function validateDetachedRequest(entry: DetachedEntry, value: unknown): value is DetachedPacket {
  if (!isDetachedPacket(value) || !sameDetachedConnection(value.connection, entry.connection)) return false
  if (value.kind === 'ready') return true
  if (value.kind === 'response') return !!value.id
  if (value.kind !== 'request' || !value.id) return false
  switch (value.operation) {
    case 'snapshot': case 'reveal': return value.payload === undefined
    case 'return': return typeof value.payload === 'boolean'
    case 'command': return entry.ready && entry.registration.validateCommand(value.payload)
    case 'binary': return entry.ready && entry.registration.validateBinary(value.payload)
    default: return false
  }
}

export function sendDetachedPacket(window: BrowserWindow | null, packet: DetachedPacket) {
  if (!window || window.isDestroyed()) return
  const contents = window.webContents
  // Renderer 崩溃时 BrowserWindow 可能仍存活，但其 frame 已失效。
  if (!contents.isDestroyed() && !contents.isCrashed() && !contents.mainFrame.detached) contents.send(detachedChannels.packet, packet)
}

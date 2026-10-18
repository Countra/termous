export type SystemClipboardOperation = 'import_files' | 'publish_files'
export interface SystemClipboardCapability {
  state: 'ready' | 'unsupported' | 'unavailable'
  reason?: string
}
export interface SystemClipboardCapabilitiesSnapshot {
  schema_version: 1
  instance_id: string
  revision: number
  capabilities: Record<SystemClipboardOperation, SystemClipboardCapability>
}
export interface SystemClipboardCapabilitiesEvent {
  type: 'resync' | 'changed'
  instance_id: string
  revision: number
}
export interface SystemClipboardConnectionState {
  version: number
  status: 'loading' | 'connected' | 'disconnected' | 'unsupported'
  snapshot?: SystemClipboardCapabilitiesSnapshot
  reason?: string
}
export interface SystemClipboardCapabilitiesBridge {
  get: () => Promise<SystemClipboardConnectionState>
  subscribe: (listener: (state: SystemClipboardConnectionState) => void) => () => void
}
export const systemClipboardChannels = {
  get: 'system-clipboard:capabilities', changed: 'system-clipboard:capabilities-changed',
} as const

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SYSTEM_CLIPBOARD_INVALID_RESPONSE')
  return value as Record<string, unknown>
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('SYSTEM_CLIPBOARD_INVALID_RESPONSE')
  return value
}
function instance(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128) throw new Error('SYSTEM_CLIPBOARD_INVALID_RESPONSE')
  return value
}
export function decodeSystemClipboardCapabilities(value: unknown): SystemClipboardCapabilitiesSnapshot {
  const v = record(value), caps = record(v.capabilities)
  if (v.schema_version !== 1) throw new Error('SYSTEM_CLIPBOARD_VERSION_UNSUPPORTED')
  const capability = (raw: unknown): SystemClipboardCapability => {
    const c = record(raw)
    if (typeof c.state !== 'string' || !['ready', 'unsupported', 'unavailable'].includes(c.state) || c.reason !== undefined && (typeof c.reason !== 'string' || c.reason.length > 128)) throw new Error('SYSTEM_CLIPBOARD_INVALID_RESPONSE')
    return { state: c.state as SystemClipboardCapability['state'], ...(c.reason ? { reason: c.reason as string } : {}) }
  }
  return { schema_version: 1, instance_id: instance(v.instance_id), revision: revision(v.revision), capabilities: { import_files: capability(caps.import_files), publish_files: capability(caps.publish_files) } }
}
export function decodeSystemClipboardEvent(value: unknown): SystemClipboardCapabilitiesEvent {
  const v = record(value)
  if (v.type !== 'resync' && v.type !== 'changed') throw new Error('SYSTEM_CLIPBOARD_INVALID_RESPONSE')
  return { type: v.type, instance_id: instance(v.instance_id), revision: revision(v.revision) }
}

import type { CloudChallenge, CloudConflict, CloudDevice, CloudEvent, CloudPreview, CloudRekeyStatus, CloudSession, CloudStatus } from '#common/contracts'
import type { CloudProfile } from '#common/contracts'

export function decodeCloudProfile(value: unknown): CloudProfile {
  const r = record(value)
  const revision = text(r.revision, 19)
  const avatar = text(r.avatar, 349550)
  if (!/^(0|[1-9]\d*)$/.test(revision) || BigInt(revision) > 9223372036854775807n) throw new Error('CLOUD_RESPONSE_INVALID')
  if (avatar && !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)) throw new Error('CLOUD_RESPONSE_INVALID')
  return { user_id: text(r.user_id), name: text(r.name, 128), bio: text(r.bio, 400), organization: text(r.organization, 200), avatar, revision, updated_at: r.updated_at === null ? null : date(r.updated_at) }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CLOUD_RESPONSE_INVALID')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('CLOUD_RESPONSE_INVALID')
  return value
}
function optional(value: unknown): string | undefined { return value === undefined ? undefined : text(value) }
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('CLOUD_RESPONSE_INVALID')
  return value
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('CLOUD_RESPONSE_INVALID')
  return value
}
function choice<const T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error('CLOUD_RESPONSE_INVALID')
  return value as T
}
function date(value: unknown): string {
  const result = text(value)
  if (!Number.isFinite(Date.parse(result))) throw new Error('CLOUD_RESPONSE_INVALID')
  return result
}
export function decodeCloudList<T>(value: unknown, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error('CLOUD_RESPONSE_INVALID')
  return value.map(decode)
}
export function decodeCloudStatus(value: unknown): CloudStatus {
  const r = record(value)
  return {
    generation: text(r.generation), revision: integer(r.revision), configured: boolean(r.configured), authenticated: boolean(r.authenticated),
    phase: choice(r.phase, ['unconfigured', 'unavailable', 'signed_out', 'ready', 'blocked', 'syncing']),
    binding_id: optional(r.binding_id), current_session_id: optional(r.current_session_id), origin: optional(r.origin), error_code: optional(r.error_code),
    email: optional(r.email), user_id: optional(r.user_id), device_id: optional(r.device_id), workspace_id: optional(r.workspace_id), key_epoch: optional(r.key_epoch),
    device_status: r.device_status === undefined ? undefined : choice(r.device_status, ['pending', 'active', 'revoked']),
    confirmed: boolean(r.confirmed), auto_sync: boolean(r.auto_sync), pending: integer(r.pending), conflicts: integer(r.conflicts),
    last_success: r.last_success === undefined ? undefined : date(r.last_success),
  }
}
export function decodeCloudEvent(value: unknown): CloudEvent {
  const r = record(value)
  return { type: choice(r.type, ['snapshot', 'status', 'resync', 'datasets']), status: decodeCloudStatus(r.status), datasets: r.datasets === undefined ? undefined : decodeCloudList(r.datasets, (v) => text(v, 64)) }
}
export function decodeCloudDevice(value: unknown): CloudDevice {
  const r = record(value)
  return { id: text(r.id), user_id: text(r.user_id), name: text(r.name), signing_key: text(r.signing_key), recipient: text(r.recipient), status: choice(r.status, ['pending', 'active', 'revoked']), created_at: date(r.created_at) }
}
export function decodeCloudSession(value: unknown): CloudSession {
  const r = record(value)
  return { id: text(r.id), device_id: text(r.device_id), created_at: date(r.created_at), expires_at: date(r.expires_at), revoked: boolean(r.revoked) }
}
export function decodeCloudChallenge(value: unknown): CloudChallenge {
  const r = record(value)
  return { id: text(r.id), kind: text(r.kind), nonce: text(r.nonce), user_id: text(r.user_id), session_id: text(r.session_id), device_id: text(r.device_id), workspace_id: text(r.workspace_id), key_epoch: text(r.key_epoch), recovery_version: text(r.recovery_version), signing_key: text(r.signing_key), recipient: text(r.recipient), recovery_epoch: text(r.recovery_epoch), expires_at: date(r.expires_at) }
}
export function decodeCloudPairing(value: unknown) {
  const r = record(value)
  return { challenge: decodeCloudChallenge(r.challenge), fingerprint: text(r.fingerprint) }
}
export function decodeCloudApproval(value: unknown) { return { trust_root: text(record(value).trust_root, 8192) } }
export function decodeCloudPreview(value: unknown): CloudPreview {
  const r = record(value)
  return { id: text(r.id), generation: text(r.generation), blocked: boolean(r.blocked), error_code: optional(r.error_code), items: decodeCloudList(r.items, (item) => {
    const i = record(item)
    return { dataset: text(i.dataset), upload: integer(i.upload), download: integer(i.download), delete: integer(i.delete), conflicts: integer(i.conflicts) }
  }) }
}
export function decodeCloudConflict(value: unknown): CloudConflict {
  const r = record(value)
  return { id: text(r.id), dataset: text(r.dataset), object_id: text(r.object_id), name: text(r.name), local_deleted: boolean(r.local_deleted), remote_deleted: boolean(r.remote_deleted) }
}
export function decodeCloudRekey(value: unknown): CloudRekeyStatus {
  const r = record(value)
  return { id: optional(r.id), status: choice(r.status, ['', 'staging', 'complete', 'cancelled', 'expired']), completed: integer(r.completed), total: integer(r.total) }
}

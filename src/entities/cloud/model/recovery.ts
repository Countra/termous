import type { CloudArchive, CloudArchivePreview, CloudPersonalRecoveryOperation, CloudPersonalRecoverySetup, CloudPersonalRecoveryStatus, CloudWorkspaceRestart } from '#common/contracts'
import { decodeCloudConflict, decodeCloudList, decodeCloudPreview } from './decode.ts'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CLOUD_RESPONSE_INVALID')
  return value as Record<string, unknown>
}
function text(value: unknown): string { if (typeof value !== 'string' || value.length > 1024) throw new Error('CLOUD_RESPONSE_INVALID'); return value }
function id(value: unknown): string { const r = text(value); if (!/^[A-Za-z0-9_-]{1,128}$/.test(r)) throw new Error('CLOUD_RESPONSE_INVALID'); return r }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('CLOUD_RESPONSE_INVALID'); return value }
function revision(value: unknown): string { const r = text(value); if (!/^(0|[1-9]\d{0,18})$/.test(r) || BigInt(r) > 9223372036854775807n) throw new Error('CLOUD_RESPONSE_INVALID'); return r }
function date(value: unknown): string { const r = text(value); if (!Number.isFinite(Date.parse(r))) throw new Error('CLOUD_RESPONSE_INVALID'); return r }
function optionalDate(value: unknown) { return value === undefined ? undefined : date(value) }
function choice<T extends string>(value: unknown, choices: readonly T[]): T { if (!choices.includes(value as T)) throw new Error('CLOUD_RESPONSE_INVALID'); return value as T }
export function decodePersonalStatus(value: unknown): CloudPersonalRecoveryStatus { const r = object(value); return { enabled: bool(r.enabled), revision: revision(r.revision) } }
export function decodePersonalOperation(value: unknown): CloudPersonalRecoveryOperation {
  const r = object(value)
  return { id: id(r.id), kind: choice(r.kind, ['setup', 'recover']), status: choice(r.status, ['pending', 'verified', 'prepared', 'completed', 'acknowledged', 'cancelled', 'expired', 'invalidated']), revision: revision(r.revision), membership_head: text(r.membership_head), personal_revision: revision(r.personal_revision), key_epoch: revision(r.key_epoch), expires_at: date(r.expires_at), verified_until: optionalDate(r.verified_until) }
}
export function decodePersonalSetup(value: unknown): CloudPersonalRecoverySetup {
  const r = object(value), op = decodePersonalOperation(value)
  if (op.kind !== 'setup' || op.status !== 'verified') throw new Error('CLOUD_RESPONSE_INVALID')
  if (!Array.isArray(r.confirm_groups) || r.confirm_groups.length !== 2 || r.confirm_groups.some(v => !Number.isInteger(v) || v < 0 || v > 11) || r.confirm_groups[0] === r.confirm_groups[1]) throw new Error('CLOUD_RESPONSE_INVALID')
  const key = text(r.recovery_key)
  if (!/^TRK1-(?:[A-Z2-7]{5}-){11}[A-Z2-7]{5}$/.test(key)) throw new Error('CLOUD_RESPONSE_INVALID')
  return { ...op, recovery_key: key, confirm_groups: r.confirm_groups as number[] }
}
export function decodeWorkspaceRestart(value: unknown): CloudWorkspaceRestart {
  const r = object(value)
  if (!Number.isSafeInteger(r.revision) || (r.revision as number) < 1) throw new Error('CLOUD_RESPONSE_INVALID')
  if (r.source_device_count !== undefined && (!Number.isSafeInteger(r.source_device_count) || (r.source_device_count as number) < 0)) throw new Error('CLOUD_RESPONSE_INVALID')
  return { source_device_count: r.source_device_count as number | undefined, id: id(r.id), status: choice(r.status, ['pending', 'verified', 'completed', 'cancelled', 'expired', 'invalidated']), revision: r.revision as number, source_workspace_id: id(r.source_workspace_id), target_workspace_id: id(r.target_workspace_id), expires_at: date(r.expires_at), verified_until: optionalDate(r.verified_until), email_sent: bool(r.email_sent), archive_expires_at: optionalDate(r.archive_expires_at), local_pending: r.local_pending === undefined ? undefined : bool(r.local_pending) }
}
export function decodeArchive(value: unknown): CloudArchive { const r = object(value); return { id: id(r.id), status: choice(r.status, ['archived', 'deleting']), revision: revision(r.revision), expires_at: optionalDate(r.expires_at), local_key_available: bool(r.local_key_available) } }
export function decodeArchivePreview(value: unknown): CloudArchivePreview { const r = object(value); return { ...decodeCloudPreview(value), workspace_id: id(r.workspace_id), expires_at: date(r.expires_at), conflicts: decodeCloudList(r.conflicts, decodeCloudConflict) } }

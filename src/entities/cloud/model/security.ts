import type { CloudAuthorization, CloudRecoveryStatus, CloudSecurityOverview } from '#common/contracts'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CLOUD_RESPONSE_INVALID')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('CLOUD_RESPONSE_INVALID')
  return value
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('CLOUD_RESPONSE_INVALID')
  return value
}
function revision(value: unknown): string {
  const result = text(value, 19)
  if (!/^(0|[1-9]\d*)$/.test(result) || BigInt(result) > 9223372036854775807n) throw new Error('CLOUD_RESPONSE_INVALID')
  return result
}
function date(value: unknown): string {
  const result = text(value)
  if (!Number.isFinite(Date.parse(result))) throw new Error('CLOUD_RESPONSE_INVALID')
  return result
}
function optionalDate(value: unknown) { return value === undefined ? undefined : date(value) }
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error('CLOUD_RESPONSE_INVALID')
  return value as T
}
export function decodeCloudAuthorization(value: unknown): CloudAuthorization {
  const r = object(value)
  if (!Array.isArray(r.allowed_actions) || r.allowed_actions.length > 8) throw new Error('CLOUD_RESPONSE_INVALID')
  const fingerprint = r.fingerprint === undefined ? undefined : text(r.fingerprint)
  if (fingerprint && !/^[A-F0-9]{4}( [A-F0-9]{4}){7}$/.test(fingerprint)) throw new Error('CLOUD_RESPONSE_INVALID')
  return { id: text(r.id, 128), workspace_id: text(r.workspace_id, 128), device_id: text(r.device_id, 128), approver_id: r.approver_id === undefined ? undefined : text(r.approver_id, 128),
    kind: choice(r.kind, ['approval', 'recovery', 'enablement']), name: text(r.name), revision: revision(r.revision),
    status: choice(r.status, ['pending', 'verifying', 'verified', 'processing', 'approved', 'acknowledged', 'rejected', 'cancelled', 'expired', 'invalidated', 'failed']),
    expires_at: date(r.expires_at), created_at: date(r.created_at), source_summary: text(r.source_summary), platform: text(r.platform, 64), fingerprint,
    target_confirmed: bool(r.target_confirmed), keys_verified: bool(r.keys_verified), allowed_actions: r.allowed_actions.map(v => choice(v, ['cancel', 'respond', 'reject', 'confirm', 'verify', 'approve', 'claim', 'complete'])) }
}
export function decodeCloudRecoveryStatus(value: unknown): CloudRecoveryStatus {
  const r = object(value), p = object(r.policy)
  return { policy: { workspace_id: text(p.workspace_id), revision: revision(p.revision), status: choice(p.status, ['disabled', 'enabling', 'enabled', 'frozen']), updated_at: date(p.updated_at) }, available: bool(r.available), reason: r.reason === undefined ? undefined : text(r.reason), blocked_until: optionalDate(r.blocked_until) }
}
export function decodeCloudSecurity(value: unknown): CloudSecurityOverview {
  const r = object(value), a = object(r.account)
  return { account: { contract: choice(a.contract, ['cloud-authorization-v1', 'cloud-recovery-safeguards-v1']), managed_recovery: bool(a.managed_recovery), mfa_enabled: bool(a.mfa_enabled), mfa_revision: revision(a.mfa_revision), recovery_blocked_until: optionalDate(a.recovery_blocked_until), workspace_id: a.workspace_id === undefined ? undefined : text(a.workspace_id), recovery_required: a.recovery_required === undefined ? undefined : bool(a.recovery_required), recovery_ready: a.recovery_ready === undefined ? undefined : bool(a.recovery_ready), personal_recovery_enabled: a.personal_recovery_enabled === undefined ? undefined : bool(a.personal_recovery_enabled), archive_available: a.archive_available === undefined ? undefined : bool(a.archive_available) }, recovery: decodeCloudRecoveryStatus(r.recovery), membership_initialized: bool(r.membership_initialized), keys_verified: bool(r.keys_verified) }
}

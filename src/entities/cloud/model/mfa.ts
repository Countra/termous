import { observeCloudTime } from './deadline.ts'
import type { CloudLoginResult, CloudMFACodes, CloudMFASetup, CloudMFAStatus, CloudReauthentication } from '#common/contracts'
import { decodeCloudStatus } from './decode.ts'
import { isCloudConnectionError } from './connection.ts'

export function isCloudMFAUncertainError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false
  const code = 'code' in cause ? cause.code : undefined
  return isCloudConnectionError(cause.message) || ['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'REQUEST_ABORTED'].includes(String(code)) || ['CLOUD_RESPONSE_INVALID', 'protocol_invalid', 'response_too_large'].includes(cause.message)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CLOUD_RESPONSE_INVALID')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error('CLOUD_RESPONSE_INVALID')
  return value
}
function date(value: unknown): string {
  const result = text(value, 64)
  if (!Number.isFinite(Date.parse(result))) throw new Error('CLOUD_RESPONSE_INVALID')
  return result
}
function revision(value: unknown): string {
  const result = text(value, 19)
  if (!/^(0|[1-9]\d*)$/.test(result) || BigInt(result) > 9223372036854775807n) throw new Error('CLOUD_RESPONSE_INVALID')
  return result
}

export function decodeCloudLogin(value: unknown): CloudLoginResult {
  const r = record(value)
  if (r.state === 'authenticated') {
    const status = decodeCloudStatus(r.status)
    if (!status.authenticated) throw new Error('CLOUD_RESPONSE_INVALID')
    return { state: 'authenticated', status }
  }
  if (r.state !== 'mfa_required') throw new Error('CLOUD_RESPONSE_INVALID')
  const challenge = record(r.challenge)
  if (!Array.isArray(challenge.methods) || !challenge.methods.length || challenge.methods.length > 2 || new Set(challenge.methods).size !== challenge.methods.length || challenge.methods.some((m) => m !== 'totp' && m !== 'backup_code')) throw new Error('CLOUD_RESPONSE_INVALID')
  return { state: 'mfa_required', challenge: observeCloudTime({ server_time: date(challenge.server_time), id: text(challenge.id, 256), expires_at: date(challenge.expires_at), methods: challenge.methods as ('totp' | 'backup_code')[] }) }
}

export function decodeCloudMFAStatus(value: unknown): CloudMFAStatus {
  const r = record(value)
  if (typeof r.enabled !== 'boolean' || !Number.isSafeInteger(r.backup_codes_remaining) || (r.backup_codes_remaining as number) < 0 || (r.backup_codes_remaining as number) > 10 || (!r.enabled && (r.backup_codes_remaining !== 0 || r.enabled_at !== undefined))) throw new Error('CLOUD_RESPONSE_INVALID')
  return observeCloudTime({ server_time: date(r.server_time), enabled: r.enabled, revision: revision(r.revision), backup_codes_remaining: r.backup_codes_remaining as number, enabled_at: r.enabled_at === undefined ? undefined : date(r.enabled_at), verified_until: r.verified_until === undefined ? undefined : date(r.verified_until) })
}

export function decodeCloudMFASetup(value: unknown): CloudMFASetup {
  const r = record(value)
  const secret = text(r.secret, 128)
  const uri = text(r.otpauth_uri, 4096)
  let parsed: URL
  try { parsed = new URL(uri) } catch { throw new Error('CLOUD_RESPONSE_INVALID') }
  // 二维码只承载验证器协议，不允许响应诱导外部页面或任意链接。
  if (!/^[A-Z2-7]{32}$/.test(secret) || parsed.protocol !== 'otpauth:' || parsed.hostname !== 'totp' || parsed.port || parsed.username || parsed.password || parsed.hash || parsed.searchParams.get('secret') !== secret || parsed.searchParams.get('issuer') !== 'Termous' || (parsed.searchParams.get('algorithm') ?? 'SHA1') !== 'SHA1' || (parsed.searchParams.get('digits') ?? '6') !== '6' || (parsed.searchParams.get('period') ?? '30') !== '30') throw new Error('CLOUD_RESPONSE_INVALID')
  return observeCloudTime({ server_time: date(r.server_time), setup_id: text(r.setup_id, 256), expires_at: date(r.expires_at), secret, otpauth_uri: uri, revision: revision(r.revision) })
}

export function decodeCloudMFACodes(value: unknown): CloudMFACodes {
  const r = record(value)
  if (!Array.isArray(r.backup_codes) || r.backup_codes.length !== 10 || new Set(r.backup_codes).size !== 10) throw new Error('CLOUD_RESPONSE_INVALID')
  const codes = r.backup_codes.map((code) => text(code, 26))
  if (codes.some((code) => !/^[A-Z2-7]{26}$/.test(code))) throw new Error('CLOUD_RESPONSE_INVALID')
  const status = decodeCloudMFAStatus(r.status)
  if (!status.enabled || status.backup_codes_remaining !== 10) throw new Error('CLOUD_RESPONSE_INVALID')
  return { status, backup_codes: codes }
}

export function decodeCloudReauthentication(value: unknown): CloudReauthentication {
  const r = record(value)
  return observeCloudTime({ server_time: date(r.server_time), verified_until: date(r.verified_until) })
}

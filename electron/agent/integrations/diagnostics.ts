import type { IntegrationDiagnostic } from '#common/contracts'

export class IntegrationFailure extends Error {
  readonly diagnostic: IntegrationDiagnostic
  constructor(diagnostic: IntegrationDiagnostic) { super(diagnostic.code); this.diagnostic = diagnostic }
}

export function redactIntegrationDetail(text: string, secret: { environment?: Record<string, string>; headers?: Record<string, string> }) {
  let result = text.slice(-32 * 1024)
  const values = [...Object.values(secret.environment ?? {}), ...Object.values(secret.headers ?? {})].filter(Boolean).sort((a, b) => b.length - a.length)
  for (const value of values) result = result.split(value).join('[redacted]')
  return result.replace(/(authorization|api[_-]?key|token|password|secret)\s*[:=]\s*(?:Bearer\s+|Basic\s+)?[^\s,;]+/giu, '$1=[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, '$1[redacted]@').slice(-8192)
}

export function integrationDiagnostic(error: unknown, phase = 'request'): IntegrationDiagnostic {
  if (error instanceof IntegrationFailure) return error.diagnostic
  let code = error instanceof Error && /^[A-Z][A-Z0-9_]{0,127}$/u.test(error.message) ? error.message : 'INTEGRATION_REQUEST_FAILED'
  const cause = error instanceof Error && 'cause' in error && error.cause instanceof Error ? error.cause : error
  const errno = cause instanceof Error && 'code' in cause ? String(cause.code) : ''
  const codes: Record<string, string> = { ENOENT: 'INTEGRATION_EXECUTABLE_NOT_FOUND', ECONNREFUSED: 'INTEGRATION_CONNECTION_REFUSED', ENOTFOUND: 'INTEGRATION_DNS_FAILED', EAI_AGAIN: 'INTEGRATION_DNS_FAILED', CERT_HAS_EXPIRED: 'INTEGRATION_TLS_FAILED', DEPTH_ZERO_SELF_SIGNED_CERT: 'INTEGRATION_TLS_FAILED', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'INTEGRATION_TLS_FAILED' }
  if (codes[errno]) code = codes[errno]
  if (error instanceof DOMException && error.name === 'AbortError') code = 'INTEGRATION_CANCELLED'
  return { code, phase, message: code, diagnostic_id: crypto.randomUUID() }
}

export function readIntegrationDiagnostic(value: unknown): IntegrationDiagnostic | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  if (typeof input.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(input.code) || typeof input.phase !== 'string' || input.phase.length > 64 || typeof input.message !== 'string') return undefined
  return { code: input.code, phase: input.phase, message: input.message.slice(0, 1024),
    ...(typeof input.elapsed_ms === 'number' ? { elapsed_ms: input.elapsed_ms } : {}),
    ...(typeof input.timeout_ms === 'number' ? { timeout_ms: input.timeout_ms } : {}),
    ...(typeof input.exit_code === 'number' ? { exit_code: input.exit_code } : {}),
    ...(typeof input.diagnostic_id === 'string' ? { diagnostic_id: input.diagnostic_id.slice(0, 128) } : {}),
    ...(typeof input.detail === 'string' ? { detail: input.detail.slice(0, 8192) } : {}),
  }
}

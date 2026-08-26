import type {
  RemoteDesktopDisplayMode,
  RemoteDesktopSession,
  RemoteDesktopSessionEvent,
  RemoteDesktopSessionPhase,
  RemoteDesktopSessionStatus,
} from '#entities/remote-desktop'

const rfc3339Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const sessionStatuses = new Set<RemoteDesktopSessionStatus>([
  'connecting',
  'waiting_host_trust',
  'ready',
  'streaming',
  'reattach_wait',
  'reconnecting',
  'stopping',
  'failed',
])
const sessionPhases = new Set<RemoteDesktopSessionPhase>([
  'queued',
  'resolving_auth',
  'dialing_ssh',
  'waiting_host_trust',
  'ready',
  'dialing_target',
  'streaming',
  'waiting_reattach',
  'waiting_retry',
  'stopping',
  'failed',
])
const displayModes = new Set<RemoteDesktopDisplayMode>(['fit', 'resize', 'actual'])

export function decodeRemoteDesktopSessionEvent(value: string): RemoteDesktopSessionEvent | null {
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(decoded)) {
    return null
  }
  switch (decoded.type) {
    case 'snapshot':
      if (!Array.isArray(decoded.sessions) || !decoded.sessions.every(isRemoteDesktopSession)) {
        return null
      }
      return { type: decoded.type, sessions: decoded.sessions }
    case 'upsert':
      return isRemoteDesktopSession(decoded.session)
        ? { type: decoded.type, session: decoded.session }
        : null
    case 'removed':
      return isRecord(decoded.session) && isNonEmptyString(decoded.session.id)
        ? { type: decoded.type, session: { id: decoded.session.id } }
        : null
    case 'telemetry':
      if (
        !isNonEmptyString(decoded.session_id)
        || !isPositiveSafeInteger(decoded.connection_generation)
        || !isNonNegativeSafeInteger(decoded.ssh_rtt_ms)
        || !isValidTimestamp(decoded.sampled_at)
      ) {
        return null
      }
      return {
        type: decoded.type,
        session_id: decoded.session_id,
        connection_generation: decoded.connection_generation,
        ssh_rtt_ms: decoded.ssh_rtt_ms,
        sampled_at: decoded.sampled_at,
      }
    default:
      return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRemoteDesktopSession(value: unknown): value is RemoteDesktopSession {
  if (!isRecord(value) || !isRecord(value.vnc)) {
    return false
  }
  const vnc = value.vnc
  return isNonEmptyString(value.id)
    && isNonEmptyString(value.profile_id)
    && isNonEmptyString(value.profile_name)
    && isNonEmptyString(value.host_id)
    && isNonEmptyString(value.host_name)
    && isNonEmptyString(value.ssh_profile_id)
    && value.route === 'ssh_tunnel'
    && isConfigVersion(value.route_config_version)
    && value.protocol === 'vnc'
    && isConfigVersion(value.protocol_config_version)
    && (vnc.loopback_host === '127.0.0.1' || vnc.loopback_host === '::1')
    && isPort(vnc.port)
    && typeof vnc.shared === 'boolean'
    && typeof vnc.default_view_only === 'boolean'
    && typeof vnc.default_display_mode === 'string'
    && displayModes.has(vnc.default_display_mode as RemoteDesktopDisplayMode)
    && typeof value.status === 'string'
    && sessionStatuses.has(value.status as RemoteDesktopSessionStatus)
    && typeof value.phase === 'string'
    && sessionPhases.has(value.phase as RemoteDesktopSessionPhase)
    && isOptionalString(value.status_message)
    && isOptionalNonEmptyString(value.host_key_challenge_id)
    && isNonNegativeSafeInteger(value.connection_generation)
    && typeof value.viewer_attached === 'boolean'
    && isOptionalNonNegativeSafeInteger(value.reconnect_attempt)
    && isOptionalNonNegativeSafeInteger(value.reconnect_max_attempts)
    && isOptionalTimestamp(value.next_reconnect_at)
    && isValidTimestamp(value.created_at)
    && isValidTimestamp(value.updated_at)
    && isOptionalString(value.last_error)
    && isOptionalString(value.error_code)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isOptionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isOptionalNonNegativeSafeInteger(value: unknown): value is number | undefined {
  return value === undefined || isNonNegativeSafeInteger(value)
}

function isPort(value: unknown): value is number {
  return isPositiveSafeInteger(value) && value <= 65_535
}

function isConfigVersion(value: unknown): value is number {
  return isPositiveSafeInteger(value) && value <= 65_535
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && rfc3339Pattern.test(value)
    && Number.isFinite(Date.parse(value))
}

function isOptionalTimestamp(value: unknown): value is string | undefined {
  return value === undefined || isValidTimestamp(value)
}

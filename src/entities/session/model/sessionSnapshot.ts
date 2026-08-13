import type { Session, SessionKind, SessionStatus } from './types.ts'

const sessionKinds = new Set<SessionKind>(['ssh', 'local'])
const sessionStatuses = new Set<SessionStatus>([
  'connecting',
  'waiting_host_trust',
  'connected',
  'disconnected',
  'failed',
])

export interface SessionSnapshotEvent {
  type: 'session_snapshot'
  instance_id: string
  revision: number
  sessions: Session[]
}

export class SessionSnapshotProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionSnapshotProtocolError'
  }
}

export function decodeSessionSnapshotEvent(value: unknown): SessionSnapshotEvent {
  const event = requireRecord(value, '会话清单事件缺失')
  if (event.type !== 'session_snapshot') {
    throw new SessionSnapshotProtocolError('会话清单事件类型无效')
  }
  const sessions = requireArray(event.sessions, '会话清单快照无效').map(decodeSession)
  const sessionIds = new Set<string>()
  sessions.forEach((session) => {
    if (sessionIds.has(session.id)) {
      throw new SessionSnapshotProtocolError('会话清单包含重复会话')
    }
    sessionIds.add(session.id)
  })
  return {
    type: 'session_snapshot',
    instance_id: requireString(event.instance_id, '会话清单实例 ID 缺失'),
    revision: requireNonNegativeInteger(event.revision, '会话清单修订号无效'),
    sessions,
  }
}

function decodeSession(value: unknown): Session {
  const session = requireRecord(value, '会话清单项无效')
  const kind = requireString(session.kind, '会话类型缺失')
  const status = requireString(session.status, '会话状态缺失')
  if (!sessionKinds.has(kind as SessionKind)) {
    throw new SessionSnapshotProtocolError('会话类型无效')
  }
  if (!sessionStatuses.has(status as SessionStatus)) {
    throw new SessionSnapshotProtocolError('会话状态无效')
  }
  requireString(session.id, '会话 ID 缺失')
  requireString(session.started_at, '会话开始时间缺失')
  requireNonNegativeInteger(session.pty_cols, '会话终端列数无效')
  requireNonNegativeInteger(session.pty_rows, '会话终端行数无效')
  return session as unknown as Session
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SessionSnapshotProtocolError(message)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SessionSnapshotProtocolError(message)
  }
  return value
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value) {
    throw new SessionSnapshotProtocolError(message)
  }
  return value
}

function requireNonNegativeInteger(value: unknown, message: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SessionSnapshotProtocolError(message)
  }
  return value as number
}

import type {
  FileSession,
  FileAccessCapability,
  FileSessionOrigin,
  FileSessionStatus,
} from './types.ts'

const fileSessionOrigins = new Set<FileSessionOrigin>(['app', 'mcp'])
const fileSessionStatuses = new Set<FileSessionStatus>([
  'connecting',
  'connected',
  'waiting_trust',
  'disconnected',
  'failed',
])
const fileAccessCapabilities = new Set<FileAccessCapability>([
  'browse',
  'content_read',
  'content_write',
  'entry_mutate',
  'permission_edit',
  'transfer',
  'batch_rename',
  'name_search',
])

export interface FileSessionSnapshotEvent {
  type: 'file_session_snapshot'
  instance_id: string
  revision: number
  sessions: FileSession[]
}

export class FileSessionSnapshotProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileSessionSnapshotProtocolError'
  }
}

export function decodeFileSessionSnapshotEvent(value: unknown): FileSessionSnapshotEvent {
  const event = requireRecord(value, '文件会话清单事件缺失')
  if (event.type !== 'file_session_snapshot') {
    throw new FileSessionSnapshotProtocolError('文件会话清单事件类型无效')
  }
  const sessions = requireArray(event.sessions, '文件会话清单快照无效')
    .map(decodeFileSession)
  const sessionIds = new Set<string>()
  sessions.forEach((session) => {
    if (sessionIds.has(session.id)) {
      throw new FileSessionSnapshotProtocolError('文件会话清单包含重复会话')
    }
    sessionIds.add(session.id)
  })
  return {
    type: 'file_session_snapshot',
    instance_id: requireString(event.instance_id, '文件会话清单实例 ID 缺失'),
    revision: requireNonNegativeInteger(event.revision, '文件会话清单修订号无效'),
    sessions,
  }
}

export function normalizeFileSessionResponse(value: unknown): FileSession {
  return decodeFileSession(value)
}

export function normalizeFileSessionEventResponse(value: unknown): FileSession {
  return decodeFileSession(value)
}

export function normalizeFileSessionResponseList(value: unknown): FileSession[] {
  return requireArray(value, '文件会话清单无效')
    .map(decodeFileSession)
}

function decodeFileSession(value: unknown): FileSession {
  const session = requireRecord(value, '文件会话清单项无效')
  const status = requireString(session.status, '文件会话状态缺失')
  if (!fileSessionStatuses.has(status as FileSessionStatus)) {
    throw new FileSessionSnapshotProtocolError('文件会话状态无效')
  }
  requireString(session.id, '文件会话 ID 缺失')
  requireString(session.host_id, '文件会话主机 ID 缺失')
  requireString(session.current_path, '文件会话路径缺失')
  requireString(session.started_at, '文件会话开始时间缺失')
  requireOptionalNonNegativeInteger(
    session.connection_generation,
    '文件会话连接代际无效',
  )
  requireOptionalNonNegativeInteger(session.state_seq, '文件会话状态序号无效')
  const identity = decodeFileSessionAccessIdentity(session)
  return {
    ...session,
    ...identity,
    origin: decodeFileSessionOrigin(session.origin),
  } as unknown as FileSession
}

function decodeFileSessionAccessIdentity(session: Record<string, unknown>): Pick<
  FileSession,
  'file_access_profile_id' | 'ssh_profile_id' | 'engine' | 'namespace' | 'capabilities'
> {
  const engine = requireString(session.engine, '文件会话引擎缺失')
  if (engine !== 'sftp') {
    throw new FileSessionSnapshotProtocolError('文件会话引擎无效')
  }
  return {
    file_access_profile_id: requireString(
      session.file_access_profile_id,
      '文件访问 Profile ID 缺失',
    ),
    ssh_profile_id: requireString(session.ssh_profile_id, 'SSH Profile ID 缺失'),
    engine,
    namespace: requireString(session.namespace, '文件会话命名空间缺失'),
    capabilities: decodeFileAccessCapabilities(session.capabilities),
  }
}

function decodeFileAccessCapabilities(value: unknown): FileAccessCapability[] {
  const capabilities = requireArray(value, '文件会话能力集合无效').map((item) => {
    const capability = requireString(item, '文件会话能力无效') as FileAccessCapability
    if (!fileAccessCapabilities.has(capability)) {
      throw new FileSessionSnapshotProtocolError('文件会话能力无效')
    }
    return capability
  })
  if (new Set(capabilities).size !== capabilities.length) {
    throw new FileSessionSnapshotProtocolError('文件会话能力包含重复项')
  }
  return [...capabilities].sort()
}

function decodeFileSessionOrigin(value: unknown): FileSessionOrigin {
  if (value === undefined) {
    return 'app'
  }
  if (!fileSessionOrigins.has(value as FileSessionOrigin)) {
    throw new FileSessionSnapshotProtocolError('文件会话来源无效')
  }
  return value as FileSessionOrigin
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FileSessionSnapshotProtocolError(message)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new FileSessionSnapshotProtocolError(message)
  }
  return value
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value) {
    throw new FileSessionSnapshotProtocolError(message)
  }
  return value
}

function requireNonNegativeInteger(value: unknown, message: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new FileSessionSnapshotProtocolError(message)
  }
  return value as number
}

function requireOptionalNonNegativeInteger(value: unknown, message: string): void {
  if (value !== undefined) {
    requireNonNegativeInteger(value, message)
  }
}

export function mergeFileSessionSnapshot(
  current: FileSession | null | undefined,
  next: FileSession,
) {
  if (current?.id === next.id && isOlderFileSessionSnapshot(current, next)) {
    return current
  }
  return next
}

export function upsertFileSessionSnapshot(
  current: FileSession[],
  next: FileSession,
) {
  const existingIndex = current.findIndex((session) => session.id === next.id)
  if (existingIndex < 0) {
    return [...current, next]
  }
  const existing = current[existingIndex]
  const resolved = mergeFileSessionSnapshot(existing, next)
  if (resolved === existing) {
    return current
  }
  return current.map((session, index) => (index === existingIndex ? resolved : session))
}

export function replaceFileSessionSnapshot(
  current: FileSession[],
  next: FileSession,
  replacedSessionId = '',
) {
  if (!replacedSessionId || replacedSessionId === next.id) {
    return upsertFileSessionSnapshot(current, next)
  }
  const replacedIndex = current.findIndex((session) => session.id === replacedSessionId)
  const retained = replacedSessionId && replacedSessionId !== next.id
    ? current.filter((session) => session.id !== replacedSessionId)
    : current
  const existing = retained.find((session) => session.id === next.id)
  if (existing) {
    return upsertFileSessionSnapshot(retained, next)
  }
  if (replacedIndex < 0) {
    return [...retained, next]
  }
  const insertionIndex = Math.min(replacedIndex, retained.length)
  return [
    ...retained.slice(0, insertionIndex),
    next,
    ...retained.slice(insertionIndex),
  ]
}

export function reconcileFileSessionSnapshotList(
  current: FileSession[],
  reloaded: FileSession[],
  revisionBaseline: ReadonlyMap<string, number>,
  latestRevisions: ReadonlyMap<string, number>,
) {
  const currentById = new Map(current.map((session) => [session.id, session]))
  const reloadedIds = new Set(reloaded.map((session) => session.id))
  const merged: FileSession[] = []

  for (const session of reloaded) {
    if (fileSessionChangedSince(session.id, revisionBaseline, latestRevisions)) {
      const currentSession = currentById.get(session.id)
      if (currentSession) {
        merged.push(currentSession)
      }
      continue
    }
    merged.push(mergeFileSessionSnapshot(currentById.get(session.id), session))
  }

  for (const session of current) {
    if (
      !reloadedIds.has(session.id)
      && fileSessionChangedSince(session.id, revisionBaseline, latestRevisions)
    ) {
      merged.push(session)
    }
  }
  return merged
}

export function filterFileSessionsByActiveSources(
  fileSessions: FileSession[],
  activeSourceSessionIds: ReadonlySet<string>,
) {
  return fileSessions.filter((session) => (
    !session.source_session_id || activeSourceSessionIds.has(session.source_session_id)
  ))
}

function fileSessionChangedSince(
  sessionId: string,
  baseline: ReadonlyMap<string, number>,
  latest: ReadonlyMap<string, number>,
) {
  return (baseline.get(sessionId) ?? 0) !== (latest.get(sessionId) ?? 0)
}

export function isOlderFileSessionSnapshot(current: FileSession, next: FileSession) {
  const currentGeneration = current.connection_generation
  const nextGeneration = next.connection_generation
  if (currentGeneration !== undefined && nextGeneration === undefined) {
    return true
  }
  if (currentGeneration !== undefined && nextGeneration !== undefined) {
    if (nextGeneration !== currentGeneration) {
      return nextGeneration < currentGeneration
    }
    if (current.state_seq !== undefined && next.state_seq === undefined) {
      return true
    }
    if (current.state_seq !== undefined && next.state_seq !== undefined) {
      return next.state_seq <= current.state_seq
    }
  }
  return false
}

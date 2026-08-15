import type { FileSession, RemoteFileEntry } from '#entities/file'
import type { Host } from '#entities/host'
import { normalizeRemotePosixPath } from '#shared/path'
import type {
  RemoteCopyBatchFailure,
  RemoteCopyBreadcrumb,
  RemoteCopySourceValidation,
  RemoteCopyTargetSession,
} from './types.ts'
import { remoteCopyBatchTargetLimit } from './types.ts'

export function filterRemoteCopyTargetSessions(
  hosts: readonly Host[],
  fileSessions: readonly FileSession[],
  sourceHostId: string,
  search = '',
): RemoteCopyTargetSession[] {
  const hostById = new Map(hosts.map((host) => [host.id, host]))
  const connected = fileSessions.flatMap((session) => {
    const host = hostById.get(session.host_id)
    if (
      !host
      || session.host_id === sourceHostId
      || session.status !== 'connected'
      || !isValidGeneration(session.connection_generation)
    ) {
      return []
    }
    return [{ host, session }]
  })
  const hostCounts = new Map<string, number>()
  for (const candidate of connected) {
    hostCounts.set(candidate.host.id, (hostCounts.get(candidate.host.id) ?? 0) + 1)
  }
  const query = search.trim().toLocaleLowerCase()

  return connected
    .filter(({ host, session }) => {
      if (!query) {
        return true
      }
      return [
        host.name,
        host.address,
        host.username,
        host.id,
        session.id,
        session.current_path,
      ].some((value) => value.toLocaleLowerCase().includes(query))
    })
    .map(({ host, session }) => ({
      host,
      session: session as FileSession & { connection_generation: number },
      shortSessionId: shortRemoteCopySessionId(session.id),
      duplicateHostSession: (hostCounts.get(host.id) ?? 0) > 1,
    }))
    .sort((left, right) => (
      left.host.name.localeCompare(right.host.name)
      || left.session.started_at.localeCompare(right.session.started_at)
      || left.session.id.localeCompare(right.session.id)
    ))
}

export function validateRemoteCopySource(
  entries: readonly Pick<RemoteFileEntry, 'kind'>[],
): RemoteCopySourceValidation {
  if (entries.length === 0) {
    return { valid: false, reason: 'empty' }
  }
  if (entries.some((entry) => entry.kind === 'symlink' || entry.kind === 'other')) {
    return { valid: false, reason: 'unsupported' }
  }
  return { valid: true }
}

export function normalizeRemoteCopyDirectory(path: string, fallback = '/') {
  return normalizeRemotePosixPath(path) ?? normalizeRemotePosixPath(fallback) ?? '/'
}

export function normalizeRemoteCopyBatchDirectory(path: string) {
  return normalizeRemotePosixPath(path)
}

export function reconcileRemoteCopyBatchSelection(
  selectedSessionIds: readonly string[],
  targets: readonly RemoteCopyTargetSession[],
) {
  const targetBySessionId = new Map(targets.map((target) => [target.session.id, target]))
  const selectedHostIds = new Set<string>()
  const result: string[] = []
  for (const sessionId of selectedSessionIds) {
    const target = targetBySessionId.get(sessionId)
    if (
      !target
      || selectedHostIds.has(target.host.id)
      || result.length >= remoteCopyBatchTargetLimit
    ) {
      continue
    }
    selectedHostIds.add(target.host.id)
    result.push(sessionId)
  }
  return result
}

export function toggleRemoteCopyBatchTarget(
  selectedSessionIds: readonly string[],
  targetSessionId: string,
  targets: readonly RemoteCopyTargetSession[],
) {
  const current = reconcileRemoteCopyBatchSelection(selectedSessionIds, targets)
  if (current.includes(targetSessionId)) {
    return { sessionIds: current.filter((sessionId) => sessionId !== targetSessionId), limitReached: false }
  }

  const targetBySessionId = new Map(targets.map((target) => [target.session.id, target]))
  const target = targetBySessionId.get(targetSessionId)
  if (!target) {
    return { sessionIds: current, limitReached: false }
  }
  const sameHostSessionId = current.find(
    (sessionId) => targetBySessionId.get(sessionId)?.host.id === target.host.id,
  )
  if (!sameHostSessionId && current.length >= remoteCopyBatchTargetLimit) {
    return { sessionIds: current, limitReached: true }
  }
  return {
    sessionIds: [
      ...current.filter((sessionId) => sessionId !== sameHostSessionId),
      targetSessionId,
    ],
    limitReached: false,
  }
}

export function rebindRemoteCopyBatchFailures(
  failures: readonly RemoteCopyBatchFailure[],
  targets: readonly RemoteCopyTargetSession[],
) {
  const targetBySessionId = new Map(targets.map((target) => [target.session.id, target]))
  return failures.map((failure) => {
    const target = targetBySessionId.get(failure.sessionId)
      ?? targets.find((candidate) => candidate.host.id === failure.hostId)
    if (!target) {
      return failure
    }
    return {
      ...failure,
      sessionId: target.session.id,
      hostName: target.host.name,
    }
  })
}

export function normalizeRemoteCopyFolderName(value: string) {
  const name = value.trim()
  if (!name || name === '.' || name === '..' || name.includes('/')) {
    return null
  }
  for (const character of name) {
    const codePoint = character.codePointAt(0) ?? 0
    if (
      codePoint <= 0x1f
      || codePoint === 0x7f
      || (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return null
    }
  }
  return name
}

export function remoteCopyParentPath(path: string) {
  const normalized = normalizeRemoteCopyDirectory(path)
  if (normalized === '/') {
    return '/'
  }
  const segments = normalized.split('/').filter(Boolean)
  segments.pop()
  return segments.length > 0 ? `/${segments.join('/')}` : '/'
}

export function buildRemotePathBreadcrumbs(path: string): RemoteCopyBreadcrumb[] {
  const normalized = normalizeRemoteCopyDirectory(path)
  const breadcrumbs: RemoteCopyBreadcrumb[] = [{ label: '/', path: '/' }]
  const segments = normalized.split('/').filter(Boolean)
  let current = ''
  for (const segment of segments) {
    current += `/${segment}`
    breadcrumbs.push({ label: segment, path: current })
  }
  return breadcrumbs
}

export function shortRemoteCopySessionId(sessionId: string) {
  return sessionId.length <= 8 ? sessionId : sessionId.slice(-8)
}

function isValidGeneration(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

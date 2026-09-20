import type { FileSession, RemoteFileEntry } from '#entities/file'
import type { Host } from '#entities/host'
import type { FileAccessProfile } from '#entities/file-access-profile'
import { projectFileAccessProfile } from '#entities/file-access-profile'
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
  sourceSessionId: string,
  search = '',
  profiles: readonly FileAccessProfile[] = [],
): RemoteCopyTargetSession[] {
  const hostById = new Map(hosts.map((host) => [host.id, host]))
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
  const connected = fileSessions.flatMap((session) => {
    const host = hostById.get(session.host_id)
    const profile = profileById.get(session.file_access_profile_id ?? '')
    const endpoint = profile ? projectFileAccessProfile(profile).endpoint : undefined
    if ((!host && !session.file_access_profile_id) || session.id === sourceSessionId
      || session.status !== 'connected' || !isValidGeneration(session.connection_generation)
      || session.capabilities && !session.capabilities.includes('transfer_receive')) return []
    return [{
      host, session: session as FileSession & { connection_generation: number },
      identity: session.file_access_profile_id ?? session.host_id,
      name: profile?.name ?? host?.name ?? session.file_access_profile_id ?? session.id,
      description: endpoint ?? (host ? `${host.username}@${host.address}` : session.engine ?? ''),
    }]
  })
  const counts = new Map<string, number>()
  for (const candidate of connected) counts.set(candidate.identity, (counts.get(candidate.identity) ?? 0) + 1)
  const query = search.trim().toLocaleLowerCase()
  return connected.filter((target) => !query || [target.name, target.description, target.identity, target.session.id, target.session.current_path]
    .some((value) => value.toLocaleLowerCase().includes(query)))
    .map((target) => ({ ...target, shortSessionId: shortRemoteCopySessionId(target.session.id), duplicateHostSession: (counts.get(target.identity) ?? 0) > 1 }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.session.started_at.localeCompare(right.session.started_at) || left.session.id.localeCompare(right.session.id))
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
      || selectedHostIds.has(target.identity)
      || result.length >= remoteCopyBatchTargetLimit
    ) {
      continue
    }
    selectedHostIds.add(target.identity)
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
    (sessionId) => targetBySessionId.get(sessionId)?.identity === target.identity,
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
      ?? targets.find((candidate) => candidate.identity === failure.targetId)
    if (!target) {
      return failure
    }
    return {
      ...failure,
      sessionId: target.session.id,
      targetName: target.name,
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

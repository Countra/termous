import {
  filterFileSessionsByActiveSources,
  isTerminatedFileSession,
  mergeFileSessionSnapshot,
  type FileSession,
  type FileSessionSnapshotEvent,
} from '#entities/file'
import {
  decideAuthoritativeSnapshot,
  initialAuthoritativeSnapshotCursor,
  type AuthoritativeSnapshotCursor,
  type AuthoritativeSnapshotDecision,
} from './authoritativeSnapshotState.ts'

export type FileSessionSnapshotCursor = AuthoritativeSnapshotCursor

export type FileSessionSnapshotDecision = AuthoritativeSnapshotDecision

export const initialFileSessionSnapshotCursor: FileSessionSnapshotCursor = {
  ...initialAuthoritativeSnapshotCursor,
}

export function decideFileSessionSnapshot(
  current: FileSessionSnapshotCursor,
  event: FileSessionSnapshotEvent,
  generation: number,
): FileSessionSnapshotDecision {
  return decideAuthoritativeSnapshot(current, event, generation)
}

export function reconcileAuthoritativeFileSessionSnapshot(
  current: FileSession[],
  incoming: FileSession[],
  revisionBaseline: ReadonlyMap<string, number>,
  latestRevisions: ReadonlyMap<string, number>,
  knownSnapshotSessionIds: ReadonlySet<string> = new Set(),
  closeSuppressedSessionIds: ReadonlySet<string> = new Set(),
): FileSession[] {
  const currentById = new Map(current.map((session) => [session.id, session]))
  const incomingIds = new Set(incoming.map((session) => session.id))
  const merged: FileSession[] = []

  incoming.forEach((session) => {
    const currentSession = currentById.get(session.id)
    if (closeSuppressedSessionIds.has(session.id)) {
      if (currentSession) {
        merged.push(currentSession)
      }
      return
    }
    merged.push(mergeFileSessionSnapshot(currentSession, session))
  })

  current.forEach((session) => {
    if (incomingIds.has(session.id) || isTerminatedFileSession(session)) {
      return
    }
    if (knownSnapshotSessionIds.has(session.id)) {
      return
    }
    if (fileSessionChangedSinceSnapshot(
      session.id,
      revisionBaseline,
      latestRevisions,
    )) {
      merged.push(session)
    }
  })
  return merged
}

export function reconcileVisibleAuthoritativeFileSessionSnapshot(
  current: FileSession[],
  incoming: FileSession[],
  activeSourceSessionIds: ReadonlySet<string>,
  revisionBaseline: ReadonlyMap<string, number>,
  latestRevisions: ReadonlyMap<string, number>,
  knownSnapshotSessionIds: ReadonlySet<string> = new Set(),
  replaceCurrent = false,
  closeSuppressedSessionIds: ReadonlySet<string> = new Set(),
): FileSession[] {
  const visibleIncoming = filterFileSessionsByActiveSources(
    incoming,
    activeSourceSessionIds,
  )
  if (replaceCurrent) {
    return visibleIncoming.filter((session) => !closeSuppressedSessionIds.has(session.id))
  }
  return reconcileAuthoritativeFileSessionSnapshot(
    current,
    visibleIncoming,
    revisionBaseline,
    latestRevisions,
    knownSnapshotSessionIds,
    closeSuppressedSessionIds,
  )
}

export function affectedFileSessionIds(
  current: FileSession[],
  next: FileSession[],
): string[] {
  return Array.from(new Set([
    ...current.map((session) => session.id),
    ...next.map((session) => session.id),
  ]))
}

function fileSessionChangedSinceSnapshot(
  sessionId: string,
  baseline: ReadonlyMap<string, number>,
  latest: ReadonlyMap<string, number>,
) {
  return (baseline.get(sessionId) ?? 0) !== (latest.get(sessionId) ?? 0)
}

import type { FileSession } from '../types/domain'

export function mergeFileSessionSnapshot(
  current: FileSession | null | undefined,
  next: FileSession,
) {
  if (current?.id === next.id && isOlderFileSessionSnapshot(current, next)) {
    return current
  }
  return next
}

export function replaceFileSessionSnapshot(
  current: FileSession[],
  next: FileSession,
  replacedSessionId = '',
) {
  const retained = replacedSessionId && replacedSessionId !== next.id
    ? current.filter((session) => session.id !== replacedSessionId)
    : current
  const existing = retained.find((session) => session.id === next.id)
  if (!existing) {
    return [next, ...retained]
  }
  const resolved = mergeFileSessionSnapshot(existing, next)
  if (resolved === existing && retained === current) {
    return current
  }
  return retained.map((session) => (session.id === next.id ? resolved : session))
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

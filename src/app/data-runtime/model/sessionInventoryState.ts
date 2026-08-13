import type { Session } from './sessionTypes'

export interface SessionInventoryResponseGuard {
  sessionId: string
  responseSessionId: string
  requestRevision: number
  latestRequestRevision: number
  baselineEventRevision: number
  latestEventRevision: number
  aborted: boolean
}

export function shouldApplySessionInventoryResponse(guard: SessionInventoryResponseGuard): boolean {
  return Boolean(
    !guard.aborted &&
      guard.sessionId === guard.responseSessionId &&
      guard.requestRevision === guard.latestRequestRevision &&
      guard.baselineEventRevision === guard.latestEventRevision,
  )
}

export function sessionChangedSince(
  sessionId: string,
  baseline: ReadonlyMap<string, number>,
  latest: ReadonlyMap<string, number>,
): boolean {
  return (baseline.get(sessionId) ?? 0) !== (latest.get(sessionId) ?? 0)
}

export function mergeSessionReloadSnapshot(
  current: Session[],
  incoming: Session[],
  baseline: ReadonlyMap<string, number>,
  latest: ReadonlyMap<string, number>,
): Session[] {
  const currentById = new Map(current.map((session) => [session.id, session]))
  const incomingIds = new Set(incoming.map((session) => session.id))
  const merged: Session[] = []

  incoming.forEach((session) => {
    if (!sessionChangedSince(session.id, baseline, latest)) {
      merged.push(session)
      return
    }
    const currentSession = currentById.get(session.id)
    if (currentSession) {
      merged.push(currentSession)
    }
  })
  current.forEach((session) => {
    if (!incomingIds.has(session.id) && sessionChangedSince(session.id, baseline, latest)) {
      merged.push(session)
    }
  })
  return merged
}

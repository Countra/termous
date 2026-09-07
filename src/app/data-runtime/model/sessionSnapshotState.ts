import type { SessionSnapshotEvent } from '#entities/session'
import type { Session } from './sessionTypes'
import {
  decideAuthoritativeSnapshot,
  initialAuthoritativeSnapshotCursor,
  type AuthoritativeSnapshotCursor,
  type AuthoritativeSnapshotDecision,
} from './authoritativeSnapshotState.ts'

export type SessionSnapshotCursor = AuthoritativeSnapshotCursor

export type SessionSnapshotDecision = AuthoritativeSnapshotDecision

export const initialSessionSnapshotCursor: SessionSnapshotCursor = {
  ...initialAuthoritativeSnapshotCursor,
}

export function decideSessionSnapshot(
  current: SessionSnapshotCursor,
  event: SessionSnapshotEvent,
  generation: number,
): SessionSnapshotDecision {
  return decideAuthoritativeSnapshot(current, event, generation)
}

export function affectedSessionIds(current: Session[], next: Session[]): string[] {
  return Array.from(new Set([
    ...current.map((session) => session.id),
    ...next.map((session) => session.id),
  ]))
}

import type { SessionSnapshotEvent } from '#entities/session'
import type { Session } from './sessionTypes'

export interface SessionSnapshotCursor {
  generation: number
  instanceId: string | null
  revision: number
}

export interface SessionSnapshotDecision {
  accepted: boolean
  cursor: SessionSnapshotCursor
}

export const initialSessionSnapshotCursor: SessionSnapshotCursor = {
  generation: 0,
  instanceId: null,
  revision: -1,
}

export function decideSessionSnapshot(
  current: SessionSnapshotCursor,
  event: SessionSnapshotEvent,
  generation: number,
): SessionSnapshotDecision {
  if (generation < current.generation) {
    return { accepted: false, cursor: current }
  }

  const nextGeneration = Math.max(current.generation, generation)
  if (
    current.instanceId === event.instance_id
    && event.revision <= current.revision
  ) {
    return {
      accepted: false,
      cursor: { ...current, generation: nextGeneration },
    }
  }

  return {
    accepted: true,
    cursor: {
      generation: nextGeneration,
      instanceId: event.instance_id,
      revision: event.revision,
    },
  }
}

export function affectedSessionIds(current: Session[], next: Session[]): string[] {
  return Array.from(new Set([
    ...current.map((session) => session.id),
    ...next.map((session) => session.id),
  ]))
}

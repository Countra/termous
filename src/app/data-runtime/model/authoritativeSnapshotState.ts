export interface AuthoritativeSnapshotCursor {
  generation: number
  instanceId: string | null
  revision: number
}

export interface AuthoritativeSnapshotIdentity {
  instance_id: string
  revision: number
}

export interface AuthoritativeSnapshotDecision {
  accepted: boolean
  cursor: AuthoritativeSnapshotCursor
}

export const initialAuthoritativeSnapshotCursor: AuthoritativeSnapshotCursor = {
  generation: 0,
  instanceId: null,
  revision: -1,
}

export function decideAuthoritativeSnapshot(
  current: AuthoritativeSnapshotCursor,
  event: AuthoritativeSnapshotIdentity,
  generation: number,
): AuthoritativeSnapshotDecision {
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

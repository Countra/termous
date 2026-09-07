export interface SnippetRuntimeCursor {
  eventRevision: number | null
  generation: number
  requestId: number
}

export interface SnippetReloadCheckpoint {
  generation: number
  requestId: number
  previousEventRevision: number | null
}

export const initialSnippetRuntimeCursor: SnippetRuntimeCursor = {
  eventRevision: null,
  generation: 0,
  requestId: 0,
}

export function beginSnippetReload(
  cursor: SnippetRuntimeCursor,
  eventRevision: number | null,
): {
  cursor: SnippetRuntimeCursor
  checkpoint: SnippetReloadCheckpoint | null
} {
  if (
    eventRevision !== null
    && cursor.eventRevision !== null
    && eventRevision <= cursor.eventRevision
  ) {
    return { cursor, checkpoint: null }
  }
  const next = {
    eventRevision,
    generation: cursor.generation + 1,
    requestId: cursor.requestId + 1,
  }
  return {
    cursor: next,
    checkpoint: {
      generation: next.generation,
      requestId: next.requestId,
      previousEventRevision: cursor.eventRevision,
    },
  }
}

export function resetSnippetEventRevision(
  cursor: SnippetRuntimeCursor,
): SnippetRuntimeCursor {
  return {
    eventRevision: null,
    generation: cursor.generation + 1,
    requestId: cursor.requestId + 1,
  }
}

export function canApplySnippetReload(
  cursor: SnippetRuntimeCursor,
  checkpoint: SnippetReloadCheckpoint,
) {
  return cursor.generation === checkpoint.generation
    && cursor.requestId === checkpoint.requestId
}

export function recoverFailedSnippetReload(
  cursor: SnippetRuntimeCursor,
  checkpoint: SnippetReloadCheckpoint,
): SnippetRuntimeCursor {
  if (!canApplySnippetReload(cursor, checkpoint)) {
    return cursor
  }
  return {
    ...cursor,
    eventRevision: checkpoint.previousEventRevision,
  }
}

export function snippetStateChangedSince(
  cursor: SnippetRuntimeCursor,
  generation: number,
) {
  return cursor.generation !== generation
}

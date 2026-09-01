import type { AgentQueuedTurnMovePlacement } from '#entities/agent'

export interface QueuedTurnMove {
  sourceId: string
  targetId: string
  placement: AgentQueuedTurnMovePlacement
  orderedIds: string[]
}

export function moveQueuedTurnIDs(
  ids: readonly string[],
  sourceId: string,
  targetId: string,
  placement: AgentQueuedTurnMovePlacement,
): QueuedTurnMove | undefined {
  const sourceIndex = ids.indexOf(sourceId)
  if (sourceIndex < 0 || sourceId === targetId) return undefined
  const orderedIds = [...ids]
  orderedIds.splice(sourceIndex, 1)
  const targetIndex = orderedIds.indexOf(targetId)
  if (targetIndex < 0) return undefined
  orderedIds.splice(placement === 'before' ? targetIndex : targetIndex + 1, 0, sourceId)
  if (orderedIds.every((id, index) => id === ids[index])) return undefined
  return { sourceId, targetId, placement, orderedIds }
}

export function stepQueuedTurn(
  ids: readonly string[],
  sourceId: string,
  direction: -1 | 1,
): QueuedTurnMove | undefined {
  const sourceIndex = ids.indexOf(sourceId)
  const targetIndex = sourceIndex + direction
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= ids.length) return undefined
  return moveQueuedTurnIDs(
    ids,
    sourceId,
    ids[targetIndex]!,
    direction < 0 ? 'before' : 'after',
  )
}

export function applyOptimisticQueuedTurnOrder<T extends { id: string }>(
  turns: readonly T[],
  orderedIds?: readonly string[],
) {
  if (!orderedIds) return [...turns]
  const byID = new Map(turns.map((turn) => [turn.id, turn]))
  const ordered = orderedIds.flatMap((id) => {
    const turn = byID.get(id)
    if (!turn) return []
    byID.delete(id)
    return [turn]
  })
  for (const turn of turns) {
    if (byID.delete(turn.id)) ordered.push(turn)
  }
  return ordered
}

export class SerialMutationQueue {
  private tail: Promise<void> = Promise.resolve()

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export interface MutationReloadCheckpoint {
  generation: number
  hadPendingWrites: boolean
}

export function canApplyReloadedValue(
  checkpoint: MutationReloadCheckpoint,
  currentGeneration: number,
  pendingWrites: number,
) {
  return (
    !checkpoint.hadPendingWrites
    && checkpoint.generation === currentGeneration
    && pendingWrites === 0
  )
}

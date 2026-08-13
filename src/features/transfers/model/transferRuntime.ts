import { createContext, useContext } from 'react'
import type { TransferTask } from '#entities/file'

const transferHistoryLimit = 200

export interface TransferRuntimeApi {
  transfers: () => Promise<TransferTask[]>
  transferEventsUrl: () => string
}

export interface TransferRuntimeValue {
  transfers: TransferTask[]
  activeTransfers: TransferTask[]
  connected: boolean
  initialized: boolean
  refresh: () => Promise<void>
  upsertTransfer: (task: TransferTask) => void
  removeTransfer: (id: string) => void
}

export const TransferRuntimeContext = createContext<TransferRuntimeValue | null>(null)

export interface TransferSnapshotToken {
  sequence: number
  eventEpoch: number
}

export class TransferSnapshotGate {
  private sequence = 0

  begin(eventEpoch: number): TransferSnapshotToken {
    this.sequence += 1
    return {
      sequence: this.sequence,
      eventEpoch,
    }
  }

  isCurrent(token: TransferSnapshotToken) {
    return token.sequence === this.sequence
  }
}

export function transferRefreshRetryDelay(failureCount: number) {
  const normalizedAttempt = Number.isSafeInteger(failureCount) && failureCount > 0
    ? failureCount
    : 1
  return Math.min(30_000, 1_000 * (3 ** Math.min(normalizedAttempt - 1, 4)))
}

export function useTransferRuntime() {
  const runtime = useContext(TransferRuntimeContext)
  if (!runtime) {
    throw new Error('useTransferRuntime 必须在 TransferRuntimeProvider 内使用')
  }
  return runtime
}

export function mergeTransferUpdate(current: TransferTask, incoming: TransferTask) {
  const currentRank = transferLifecycleRank(current.status)
  const incomingRank = transferLifecycleRank(incoming.status)
  if (incomingRank < currentRank) {
    return current
  }
  if (
    incomingRank === currentRank
    && (incoming.status === 'queued' || incoming.status === 'running')
    && (
      incoming.transferred_bytes < current.transferred_bytes
      || incoming.progress_percent < current.progress_percent
    )
  ) {
    return current
  }
  return incoming
}

export function mergeTransferSnapshot(
  current: TransferTask[],
  snapshot: TransferTask[],
  preserveCurrentIds: ReadonlySet<string>,
) {
  const currentById = new Map(current.map((task) => [task.id, task]))
  const snapshotById = new Map(snapshot.map((task) => [task.id, task]))
  const merged = snapshot.map((task) => {
    if (!preserveCurrentIds.has(task.id)) {
      return task
    }
    return currentById.get(task.id) ?? task
  })
  for (const id of preserveCurrentIds) {
    if (!snapshotById.has(id)) {
      const task = currentById.get(id)
      if (task) {
        merged.push(task)
      }
    }
  }
  return sortTransfers(merged)
}

export function sortTransfers(transfers: TransferTask[]) {
  const sorted = [...transfers].sort((left, right) => {
    const leftActive = isActiveTransfer(left)
    const rightActive = isActiveTransfer(right)
    if (leftActive !== rightActive) {
      return leftActive ? -1 : 1
    }
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  })

  const activeTransfers: TransferTask[] = []
  const historyTransfers: TransferTask[] = []
  for (const task of sorted) {
    if (isActiveTransfer(task)) {
      activeTransfers.push(task)
      continue
    }
    if (historyTransfers.length < transferHistoryLimit) {
      historyTransfers.push(task)
    }
  }
  return [...activeTransfers, ...historyTransfers]
}

function isActiveTransfer(task: TransferTask) {
  return task.status === 'queued' || task.status === 'running'
}

function transferLifecycleRank(status: TransferTask['status']) {
  if (status === 'queued') {
    return 0
  }
  if (status === 'running') {
    return 1
  }
  return 2
}

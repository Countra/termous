import type { TransferTask } from '../../types/domain'

export type TransferQueueFilter = 'all' | 'active' | 'completed' | 'failed'
export const pendingTransferHistoryLimit = 200

export interface PendingFileOperation {
  id: string
  hostId: string
  fileSessionId: string
  title: string
  description?: string
  progress: number
  status?: 'running' | 'success' | 'error'
  indeterminate?: boolean
}

export type TransferQueueItem =
  | {
      kind: 'pending'
      operation: PendingFileOperation
    }
  | {
      kind: 'task'
      task: TransferTask
    }

export interface TransferQueueSummary {
  all: number
  active: number
  completed: number
  failed: number
  clearable: number
}

export function limitPendingFileOperations(
  operations: readonly PendingFileOperation[],
  historyLimit = pendingTransferHistoryLimit,
) {
  let terminalCount = 0
  return operations.filter((operation) => {
    if (pendingStatus(operation) === 'running') {
      return true
    }
    terminalCount += 1
    return terminalCount <= Math.max(0, historyLimit)
  })
}

export function summarizeTransferQueue(
  transfers: readonly TransferTask[],
  pendingOperations: readonly PendingFileOperation[],
): TransferQueueSummary {
  const activeTransfers = transfers.filter(isActiveTransferTask).length
  const completedTransfers = transfers.filter((task) => task.status === 'completed').length
  const failedTransfers = transfers.filter((task) => task.status === 'failed').length
  const pendingActive = pendingOperations.filter((operation) => pendingStatus(operation) === 'running').length
  const pendingCompleted = pendingOperations.filter((operation) => pendingStatus(operation) === 'success').length
  const pendingFailed = pendingOperations.filter((operation) => pendingStatus(operation) === 'error').length

  return {
    all: transfers.length + pendingOperations.length,
    active: activeTransfers + pendingActive,
    completed: completedTransfers + pendingCompleted,
    failed: failedTransfers + pendingFailed,
    clearable: transfers.filter(isClearableTransferTask).length
      + pendingOperations.filter(isClearablePendingOperation).length,
  }
}

export function buildTransferQueueItems(
  transfers: readonly TransferTask[],
  pendingOperations: readonly PendingFileOperation[],
  filter: TransferQueueFilter,
): TransferQueueItem[] {
  const items: TransferQueueItem[] = [
    ...pendingOperations
      .filter((operation) => matchesPendingFilter(operation, filter))
      .map((operation) => ({ kind: 'pending' as const, operation })),
    ...transfers
      .filter((task) => matchesTransferFilter(task, filter))
      .map((task) => ({ kind: 'task' as const, task })),
  ]

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (
      transferQueueItemPriority(left.item) - transferQueueItemPriority(right.item)
      || left.index - right.index
    ))
    .map(({ item }) => item)
}

export function matchesTransferFilter(task: TransferTask, filter: TransferQueueFilter) {
  if (filter === 'all') {
    return true
  }
  if (filter === 'active') {
    return isActiveTransferTask(task)
  }
  return task.status === filter
}

export function matchesPendingFilter(
  operation: PendingFileOperation,
  filter: TransferQueueFilter,
) {
  if (filter === 'all') {
    return true
  }
  const status = pendingStatus(operation)
  if (filter === 'active') {
    return status === 'running'
  }
  if (filter === 'completed') {
    return status === 'success'
  }
  return status === 'error'
}

export function isActiveTransferTask(task: TransferTask) {
  return task.status === 'queued' || task.status === 'running'
}

export function isClearableTransferTask(task: TransferTask) {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
}

export function isClearablePendingOperation(operation: PendingFileOperation) {
  return pendingStatus(operation) !== 'running'
}

function pendingStatus(operation: PendingFileOperation) {
  return operation.status ?? 'running'
}

function transferQueueItemPriority(item: TransferQueueItem) {
  if (item.kind === 'pending') {
    const status = pendingStatus(item.operation)
    return status === 'running' ? 0 : status === 'error' ? 1 : 2
  }
  if (isActiveTransferTask(item.task)) {
    return 0
  }
  if (item.task.status === 'failed') {
    return 1
  }
  return 2
}

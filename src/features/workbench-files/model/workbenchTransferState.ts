import type { TransferTask } from '#entities/file'

export interface WorkbenchTransferSummary {
  tasks: TransferTask[]
  activeCount: number
  failedCount: number
  progress: number
  speed: number
  activeTransferredBytes: number
  activeTotalBytes: number
  eta?: number
}

export function summarizeWorkbenchTransfers(
  transfers: TransferTask[],
  fileSessionId?: string,
): WorkbenchTransferSummary {
  const tasks = fileSessionId
    ? transfers.filter((task) => task.file_session_id === fileSessionId)
    : []
  const active = tasks.filter((task) => task.status === 'queued' || task.status === 'running')
  const failedCount = tasks.filter((task) => task.status === 'failed').length
  const totalWeight = active.reduce((sum, task) => sum + Math.max(1, nonNegative(task.total_bytes)), 0)
  const progress = totalWeight === 0
    ? 0
    : active.reduce(
      (sum, task) => sum + Math.max(1, nonNegative(task.total_bytes)) * normalizedProgress(task),
      0,
    ) / totalWeight
  const activeTotalBytes = active.reduce(
    (sum, task) => sum + nonNegative(task.total_bytes),
    0,
  )
  const activeTransferredBytes = active.reduce((sum, task) => {
    const transferred = nonNegative(task.transferred_bytes)
    const total = nonNegative(task.total_bytes)
    return sum + (total > 0 ? Math.min(transferred, total) : transferred)
  }, 0)

  return {
    tasks,
    activeCount: active.length,
    failedCount,
    progress: Math.round(progress),
    speed: active.reduce((sum, task) => sum + transferSpeed(task), 0),
    activeTransferredBytes,
    activeTotalBytes,
    eta: maxDefined(active.map((task) => task.eta_seconds)),
  }
}

function normalizedProgress(task: TransferTask) {
  if (task.status === 'completed') {
    return 100
  }
  return Math.max(0, Math.min(100, task.progress_percent || 0))
}

function maxDefined(values: Array<number | undefined>) {
  const defined = values.filter((value): value is number => typeof value === 'number' && value >= 0)
  return defined.length > 0 ? Math.max(...defined) : undefined
}

function transferSpeed(task: TransferTask) {
  const current = nonNegative(task.speed_bytes_per_sec)
  return current > 0 ? current : nonNegative(task.average_speed_bytes_per_sec)
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

import type { TransferTask } from '../../types/domain'

export interface WorkbenchTransferSummary {
  tasks: TransferTask[]
  activeCount: number
  failedCount: number
  progress: number
  speed: number
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
  const totalWeight = active.reduce((sum, task) => sum + Math.max(1, task.total_bytes), 0)
  const progress = totalWeight === 0
    ? 0
    : active.reduce(
      (sum, task) => sum + Math.max(1, task.total_bytes) * normalizedProgress(task),
      0,
    ) / totalWeight

  return {
    tasks,
    activeCount: active.length,
    failedCount,
    progress: Math.round(progress),
    speed: active.reduce((sum, task) => sum + Math.max(0, task.speed_bytes_per_sec), 0),
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

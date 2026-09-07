import {
  isTransferRelatedToFileSession,
  type TransferTask,
} from '#entities/file'

export interface WorkbenchTransferSummary {
  tasks: TransferTask[]
  activeCount: number
  failedCount: number
  indeterminate: boolean
  progress: number
  speed: number
  activeTransferredBytes: number
  activeTotalBytes: number
  eta?: number
}

export interface TrackedTransferRefresh {
  fileSessionId: string
  targetPath: string
}

type CompletedTransferPaths = Map<string, Map<string, number>>

const completedTransferPathLimit = 200

export function shouldRetainTransferAfterCancel(task: TransferTask) {
  return task.type === 'remote_copy'
    && (task.status === 'queued' || task.status === 'running')
}

export function consumeCompletedTransferPath(
  completedPathsByFileSession: CompletedTransferPaths,
  fileSessionId: string,
  path: string,
) {
  const completedPaths = completedPathsByFileSession.get(fileSessionId)
  if (completedPaths?.delete(path) !== true) {
    return false
  }
  if (completedPaths.size === 0) {
    completedPathsByFileSession.delete(fileSessionId)
  }
  return true
}

export function trackCompletedTransferPath(
  completedPathsByFileSession: CompletedTransferPaths,
  fileSessionId: string,
  path: string,
  refreshesInFlight?: ReadonlySet<string>,
) {
  const completedPaths = completedPathsByFileSession.get(fileSessionId) ?? new Map<string, number>()
  completedPaths.set(path, (completedPaths.get(path) ?? 0) + 1)
  completedPathsByFileSession.set(fileSessionId, completedPaths)
  pruneCompletedTransferPaths(completedPathsByFileSession, refreshesInFlight)
}

export async function refreshCompletedTransferPath(
  completedPathsByFileSession: CompletedTransferPaths,
  refreshesInFlight: Set<string>,
  fileSessionId: string,
  path: string,
  loadDirectory: (path: string) => Promise<boolean>,
) {
  const refreshKey = completedTransferPathKey(fileSessionId, path)
  let trackedVersion = completedPathsByFileSession.get(fileSessionId)?.get(path)
  if (
    refreshesInFlight.has(refreshKey)
    || trackedVersion === undefined
  ) {
    return false
  }

  refreshesInFlight.add(refreshKey)
  try {
    while (trackedVersion !== undefined) {
      const refreshed = await loadDirectory(path)
      if (!refreshed) {
        return false
      }
      const latestVersion = completedPathsByFileSession.get(fileSessionId)?.get(path)
      if (latestVersion === trackedVersion) {
        consumeCompletedTransferPath(completedPathsByFileSession, fileSessionId, path)
        return true
      }
      trackedVersion = latestVersion
    }
    return true
  } finally {
    refreshesInFlight.delete(refreshKey)
  }
}

export function hasPendingTransferForDirectory(
  pendingTargets: Iterable<TrackedTransferRefresh>,
  fileSessionId: string,
  targetPath: string,
) {
  for (const pending of pendingTargets) {
    if (pending.fileSessionId === fileSessionId && pending.targetPath === targetPath) {
      return true
    }
  }
  return false
}

export function summarizeWorkbenchTransfers(
  transfers: TransferTask[],
  fileSessionId?: string,
): WorkbenchTransferSummary {
  const tasks = fileSessionId
    ? transfers.filter((task) => isTransferRelatedToFileSession(task, fileSessionId))
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
    indeterminate: active.some((task) => (
      task.type === 'remote_copy' && task.phase === 'scanning'
    )),
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

function pruneCompletedTransferPaths(
  completedPathsByFileSession: CompletedTransferPaths,
  refreshesInFlight?: ReadonlySet<string>,
) {
  let pathCount = 0
  completedPathsByFileSession.forEach((paths) => {
    pathCount += paths.size
  })
  if (pathCount <= completedTransferPathLimit) {
    return
  }

  for (const [fileSessionId, paths] of completedPathsByFileSession) {
    for (const path of paths.keys()) {
      if (pathCount <= completedTransferPathLimit) {
        return
      }
      if (refreshesInFlight?.has(completedTransferPathKey(fileSessionId, path))) {
        continue
      }
      paths.delete(path)
      pathCount -= 1
    }
    if (paths.size === 0) {
      completedPathsByFileSession.delete(fileSessionId)
    }
  }
}

function completedTransferPathKey(fileSessionId: string, path: string) {
  return `${fileSessionId}\u0000${path}`
}

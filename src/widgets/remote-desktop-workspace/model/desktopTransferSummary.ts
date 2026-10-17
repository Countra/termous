import type { TransferTask } from '#entities/file'
import { isActiveTransferTask } from '#features/transfers'

export function desktopSessionTransfers(transfers: TransferTask[], sessionId?: string) {
  return transfers.filter(task => task.desktop_session_id && (!sessionId || task.desktop_session_id === sessionId))
}

export function summarizeDesktopTransfers(transfers: TransferTask[], sessionId: string) {
  const active = desktopSessionTransfers(transfers, sessionId).filter(isActiveTransferTask)
  const running = active.filter(task => task.status === 'running')
  const uploads = running.filter(task => task.type === 'upload_file' || task.type === 'upload_directory')
  const downloads = running.filter(task => task.type === 'download_file' || task.type === 'download_directory')
  const totalBytes = active.reduce((total, task) => total + nonnegative(task.total_bytes), 0)
  const transferredBytes = active.reduce((total, task) => total + Math.min(nonnegative(task.transferred_bytes), nonnegative(task.total_bytes)), 0)
  // 扫描中或总量未知时不拼接一个误导性的百分比，排队任务也计入整体进度。
  const determinate = active.length > 0 && active.every(task => task.phase !== 'scanning' && task.total_bytes > 0 && Number.isFinite(task.total_bytes))
  return {
    count: active.length,
    runningCount: running.length,
    uploadCount: uploads.length,
    downloadCount: downloads.length,
    uploadRate: uploads.reduce((total, task) => total + nonnegative(task.speed_bytes_per_sec), 0),
    downloadRate: downloads.reduce((total, task) => total + nonnegative(task.speed_bytes_per_sec), 0),
    totalBytes,
    transferredBytes,
    progress: determinate ? Math.min(100, Math.floor(transferredBytes / totalBytes * 100)) : null,
  }
}

function nonnegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

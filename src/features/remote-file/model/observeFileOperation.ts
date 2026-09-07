import type { FileOperationTask } from '#entities/file'
import type { FileOperationGateway } from './fileOperationGateway'

type FileOperationObserverGateway = Pick<
  FileOperationGateway,
  'fileOperation' | 'fileOperationEventsUrl'
>

interface ObserveFileOperationOptions {
  api: FileOperationObserverGateway
  initialTask: FileOperationTask
  onTask?: (task: FileOperationTask) => void
}

export interface FileOperationObservation {
  terminal: Promise<FileOperationTask | null>
  dispose: () => void
}

export function isFileOperationTerminal(task: FileOperationTask) {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
}

export function observeFileOperation({
  api,
  initialTask,
  onTask,
}: ObserveFileOperationOptions): FileOperationObservation {
  let disposed = false
  let settled = false
  let socket: WebSocket | null = null
  let pollTimer = 0
  let lastRevision = 0
  let lastProgress = 0
  let resolveTerminal: (task: FileOperationTask | null) => void = () => undefined

  const terminal = new Promise<FileOperationTask | null>((resolve) => {
    resolveTerminal = resolve
  })

  const clearPollTimer = () => {
    if (!pollTimer) {
      return
    }
    window.clearTimeout(pollTimer)
    pollTimer = 0
  }

  const cleanup = () => {
    clearPollTimer()
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close()
    }
    socket = null
  }

  const settle = (task: FileOperationTask | null) => {
    if (settled) {
      return
    }
    settled = true
    cleanup()
    resolveTerminal(task)
  }

  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    settle(null)
  }

  const schedulePoll = (delay: number) => {
    if (disposed || settled) {
      return
    }
    clearPollTimer()
    pollTimer = window.setTimeout(() => {
      pollTimer = 0
      void api.fileOperation(initialTask.id)
        .then(handleTask)
        .catch(() => undefined)
        .finally(() => {
          if (!disposed && !settled) {
            schedulePoll(1000)
          }
        })
    }, delay)
  }

  const handleTask = (task: FileOperationTask) => {
    if (disposed || settled || task.id !== initialTask.id) {
      return
    }
    const terminalTask = isFileOperationTerminal(task)
    const revision = task.revision || 0
    if (revision > 0) {
      if (revision < lastRevision || (revision === lastRevision && !terminalTask)) {
        return
      }
      lastRevision = revision
    } else if (!terminalTask && (task.progress_percent || 0) < lastProgress) {
      return
    }

    const progress = task.status === 'completed'
      ? 100
      : Math.max(lastProgress, Math.max(0, Math.min(100, task.progress_percent || 0)))
    lastProgress = progress
    const nextTask = progress === task.progress_percent
      ? task
      : { ...task, progress_percent: progress }
    onTask?.(nextTask)

    if (terminalTask) {
      settle(nextTask)
    } else {
      schedulePoll(2000)
    }
  }

  handleTask(initialTask)
  if (!settled) {
    try {
      socket = new WebSocket(api.fileOperationEventsUrl(initialTask.file_session_id))
      socket.addEventListener('message', (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string; task?: FileOperationTask }
          if (payload.type === 'file_operation_update' && payload.task) {
            handleTask(payload.task)
          }
        } catch {
          // 单条事件异常时保留轮询兜底，避免中断任务状态同步。
        }
      })
      socket.addEventListener('close', () => schedulePoll(250))
      socket.addEventListener('error', () => schedulePoll(250))
    } catch {
      schedulePoll(250)
    }
    if (!pollTimer) {
      schedulePoll(1000)
    }
  }

  return { terminal, dispose }
}

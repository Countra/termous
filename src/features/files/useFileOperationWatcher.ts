import { useCallback, useEffect, useRef } from 'react'
import { TermousApiError } from '../../api/client'
import type { FileOperationTask } from '#entities/file'
import type { FileOperationProgressState } from './FileOperationProgress'
import type { FileOperationGateway } from './api/fileGateway'
import { formatBytes } from '#shared/format'

interface UseFileOperationWatcherOptions {
  api: FileOperationGateway
  setOperationProgress: (progress: FileOperationProgressState | null) => void
}

export function useFileOperationWatcher({ api, setOperationProgress }: UseFileOperationWatcherOptions) {
  const operationTimersRef = useRef<number[]>([])
  const operationCleanupRef = useRef<(() => void) | null>(null)
  const operationCancelRef = useRef<(() => void) | null>(null)
  const activeOperationIdRef = useRef<string | null>(null)
  const activeOperationDoneRef = useRef(false)

  const clearOperationTimers = useCallback(() => {
    operationTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    operationTimersRef.current = []
  }, [])

  const finishOperationProgress = useCallback((progress: FileOperationProgressState, clearDelay = 900) => {
    clearOperationTimers()
    setOperationProgress(progress)
    const timer = window.setTimeout(() => setOperationProgress(null), clearDelay)
    operationTimersRef.current.push(timer)
  }, [clearOperationTimers, setOperationProgress])

  const cancelActiveOperation = useCallback(() => {
    const operationId = activeOperationIdRef.current
    const done = activeOperationDoneRef.current
    const cancelWatcher = operationCancelRef.current
    operationCancelRef.current = null
    if (cancelWatcher) {
      cancelWatcher()
    } else {
      operationCleanupRef.current?.()
    }
    operationCleanupRef.current = null
    activeOperationIdRef.current = null
    activeOperationDoneRef.current = false
    if (operationId && !done) {
      void api.cancelFileOperation(operationId).catch(() => undefined)
    }
  }, [api])

  const progressFromTask = useCallback((task: FileOperationTask, title: string, successText: string, failedText: string): FileOperationProgressState => {
    const failed = task.status === 'failed' || task.status === 'cancelled'
    const completed = task.status === 'completed'
    const phaseTotal = task.phase_total_bytes || task.total_bytes || 0
    const phaseTransferred = task.phase_total_bytes > 0 ? task.phase_transferred_bytes : task.transferred_bytes
    const detail = phaseTotal > 0 && task.status === 'running'
      ? `${task.phase_label || title} · ${formatBytes(phaseTransferred)} / ${formatBytes(phaseTotal)}`
      : task.phase_label || (completed ? successText : failed ? task.error_message || failedText : title)
    return {
      title,
      description: detail,
      progress: completed ? 100 : Math.max(0, Math.min(100, task.progress_percent || 0)),
      status: completed ? 'success' : failed ? 'error' : 'running',
      indeterminate: task.status === 'running' && phaseTotal <= 0 && (task.progress_percent || 0) <= 0,
    }
  }, [])

  const watchFileOperation = useCallback((
    initialTask: FileOperationTask,
    title: string,
    successText: string,
    failedText: string,
  ) => new Promise<FileOperationTask>((resolve, reject) => {
    let settled = false
    let disposed = false
    let socket: WebSocket | null = null
    let pollTimer = 0
    let lastRevision = 0
    let lastProgress = 0
    let cancelWatcher: (() => void) | null = null

    const cleanup = () => {
      disposed = true
      clearPollTimer()
      if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
        socket.close()
      }
      if (operationCleanupRef.current === cleanup) {
        operationCleanupRef.current = null
      }
      if (operationCancelRef.current === cancelWatcher) {
        operationCancelRef.current = null
      }
    }

    const settle = (callback: () => void) => {
      if (settled) {
        return
      }
      settled = true
      activeOperationDoneRef.current = true
      activeOperationIdRef.current = null
      cleanup()
      callback()
    }

    cancelWatcher = () => {
      settle(() => reject(new TermousApiError(
        failedText,
        'FILE_OPERATION_CANCELLED',
        0,
      )))
    }

    function clearPollTimer() {
      if (pollTimer) {
        window.clearTimeout(pollTimer)
        pollTimer = 0
      }
    }

    function schedulePoll(delay: number) {
      if (disposed || settled) {
        return
      }
      clearPollTimer()
      pollTimer = window.setTimeout(poll, delay)
    }

    function poll() {
      if (disposed || settled) {
        return
      }
      pollTimer = 0
      void api.fileOperation(initialTask.id)
        .then(handleTask)
        .catch(() => undefined)
        .finally(() => {
          if (!disposed && !settled) {
            schedulePoll(1000)
          }
        })
    }

    const handleTask = (task: FileOperationTask) => {
      if (disposed || task.id !== initialTask.id) {
        return
      }
      const terminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
      const revision = task.revision || 0
      if (revision > 0) {
        if (revision < lastRevision || (revision === lastRevision && !terminal)) {
          return
        }
        lastRevision = revision
      } else if (!terminal && (task.progress_percent || 0) < lastProgress) {
        return
      }
      const nextProgress = task.status === 'completed'
        ? 100
        : Math.max(lastProgress, Math.max(0, Math.min(100, task.progress_percent || 0)))
      lastProgress = nextProgress
      const displayTask = { ...task, progress_percent: nextProgress }
      setOperationProgress(progressFromTask(displayTask, title, successText, failedText))
      if (!terminal) {
        schedulePoll(2000)
      }
      if (displayTask.status === 'completed') {
        settle(() => resolve(task))
      } else if (displayTask.status === 'failed' || displayTask.status === 'cancelled') {
        const code = displayTask.error_code || (displayTask.status === 'cancelled' ? 'FILE_OPERATION_CANCELLED' : 'FILE_OPERATION_FAILED')
        settle(() => reject(new TermousApiError(displayTask.error_message || failedText, code, 0)))
      }
    }

    operationCleanupRef.current = cleanup
    operationCancelRef.current = cancelWatcher
    activeOperationIdRef.current = initialTask.id
    activeOperationDoneRef.current = false
    handleTask(initialTask)
    if (settled) {
      return
    }
    try {
      socket = new WebSocket(api.fileOperationEventsUrl(initialTask.file_session_id))
      socket.addEventListener('message', (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string; task?: FileOperationTask }
          if (payload.type === 'file_operation_update' && payload.task) {
            handleTask(payload.task)
          }
        } catch {
          // 忽略单条异常事件，轮询会继续兜底同步状态。
        }
      })
      socket.addEventListener('close', () => {
        if (!disposed && !settled) {
          schedulePoll(250)
        }
      })
      socket.addEventListener('error', () => {
        if (!disposed && !settled) {
          schedulePoll(250)
        }
      })
    } catch {
      schedulePoll(250)
    }
    if (!pollTimer) {
      schedulePoll(1000)
    }
  }), [api, progressFromTask, setOperationProgress])

  useEffect(() => () => {
    cancelActiveOperation()
    clearOperationTimers()
    setOperationProgress(null)
  }, [cancelActiveOperation, clearOperationTimers, setOperationProgress])

  return {
    cancelActiveOperation,
    clearOperationTimers,
    finishOperationProgress,
    watchFileOperation,
  }
}

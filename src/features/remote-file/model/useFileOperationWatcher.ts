import { useCallback, useEffect, useRef } from 'react'
import { TermousApiError } from '#shared/api'
import type { FileOperationTask } from '#entities/file'
import type { FileOperationProgressState } from '../ui/FileOperationProgress'
import { formatBytes } from '#shared/format'
import type { FileOperationGateway } from './fileOperationGateway'
import { observeFileOperation } from './observeFileOperation'

interface UseFileOperationWatcherOptions {
  api: FileOperationGateway
  setOperationProgress: (progress: FileOperationProgressState | null) => void
}

export function useFileOperationWatcher({ api, setOperationProgress }: UseFileOperationWatcherOptions) {
  const operationTimersRef = useRef<number[]>([])
  const operationCleanupRef = useRef<(() => void) | null>(null)
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
    operationCleanupRef.current?.()
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
  ) => {
    const observation = observeFileOperation({
      api,
      initialTask,
      onTask: (task) => {
        setOperationProgress(progressFromTask(task, title, successText, failedText))
      },
    })
    operationCleanupRef.current = observation.dispose
    activeOperationIdRef.current = initialTask.id
    activeOperationDoneRef.current = false
    return observation.terminal.then((task) => {
      const isCurrentObservation = operationCleanupRef.current === observation.dispose
      if (isCurrentObservation) {
        operationCleanupRef.current = null
        activeOperationDoneRef.current = true
        activeOperationIdRef.current = null
      }
      if (!task) {
        throw new TermousApiError(failedText, 'FILE_OPERATION_CANCELLED', 0)
      }
      if (task.status === 'completed') {
        return task
      }
      const code = task.error_code
        || (task.status === 'cancelled' ? 'FILE_OPERATION_CANCELLED' : 'FILE_OPERATION_FAILED')
      throw new TermousApiError(task.error_message || failedText, code, 0)
    })
  }, [api, progressFromTask, setOperationProgress])

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

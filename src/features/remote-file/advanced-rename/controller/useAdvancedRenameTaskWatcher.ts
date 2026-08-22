import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileOperationTask } from '#entities/file'
import type { FileOperationGateway } from '../../model/fileOperationGateway'
import { isFileOperationTerminal, observeFileOperation } from '../../model/observeFileOperation'

export function useAdvancedRenameTaskWatcher(api: FileOperationGateway) {
  const [task, setTask] = useState<FileOperationTask | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const taskRef = useRef<FileOperationTask | null>(null)
  taskRef.current = task

  const stopWatching = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
  }, [])

  const watch = useCallback((initialTask: FileOperationTask) => {
    stopWatching()
    setCancelling(false)
    taskRef.current = initialTask
    setTask(initialTask)
    const observation = observeFileOperation({
      api,
      initialTask,
      onTask: (nextTask) => {
        taskRef.current = nextTask
        setTask(nextTask)
      },
    })
    cleanupRef.current = observation.dispose
    return observation.terminal.then((terminalTask) => {
      if (cleanupRef.current === observation.dispose) {
        cleanupRef.current = null
      }
      if (terminalTask) {
        setCancelling(false)
      }
      return terminalTask
    })
  }, [api, stopWatching])

  const cancel = useCallback(async () => {
    const current = taskRef.current
    if (!current || isFileOperationTerminal(current) || !current.cancellable || cancelling) {
      return
    }
    setCancelling(true)
    try {
      await api.cancelFileOperation(current.id)
    } catch (error) {
      setCancelling(false)
      throw error
    }
  }, [api, cancelling])

  const reset = useCallback(() => {
    stopWatching()
    taskRef.current = null
    setTask(null)
    setCancelling(false)
  }, [stopWatching])

  useEffect(() => () => {
    const current = taskRef.current
    stopWatching()
    if (current && !isFileOperationTerminal(current) && current.cancellable) {
      void api.cancelFileOperation(current.id).catch(() => undefined)
    }
  }, [api, stopWatching])

  return { task, cancelling, watch, cancel, reset }
}

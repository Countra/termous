import { useCallback, useEffect, useReducer, useRef } from 'react'
import { TermousApiError, type TermousApi } from '../../api/client'
import type { AliasSyncTask, AliasSyncTaskInput } from '../../types/domain'
import { retireWebSocket } from '../../shared/webSocketLifecycle'
import {
  aliasSyncTaskReducer,
  createAliasSyncTaskViewState,
  isAliasSyncTaskTerminal,
  parseAliasSyncTaskEvent,
  reconcileAliasSyncTask,
  type AliasSyncTaskViewAction,
} from './aliasSyncTaskState'

interface UseAliasSyncTaskOptions {
  api: TermousApi
  enabled: boolean
}

interface AliasSyncTerminalWaiter {
  resolve: (task: AliasSyncTask) => void
  reject: (error: Error) => void
}

const ALIAS_SYNC_RECONNECT_INITIAL_DELAY = 500
const ALIAS_SYNC_RECONNECT_MAXIMUM_DELAY = 5_000

export function useAliasSyncTask({ api, enabled }: UseAliasSyncTaskOptions) {
  const [state, dispatch] = useReducer(aliasSyncTaskReducer, undefined, createAliasSyncTaskViewState)
  const taskRef = useRef<AliasSyncTask | null>(null)
  const terminalWaitersRef = useRef(new Map<string, Set<AliasSyncTerminalWaiter>>())

  const dispatchState = useCallback((action: AliasSyncTaskViewAction) => {
    if (action.type === 'reset' || (action.type === 'recover-success' && !action.task)) {
      taskRef.current = null
    }
    dispatch(action)
  }, [])

  const settleTerminalWaiters = useCallback((task: AliasSyncTask) => {
    if (!isAliasSyncTaskTerminal(task.status)) {
      return
    }
    const waiters = terminalWaitersRef.current.get(task.id)
    if (!waiters) {
      return
    }
    terminalWaitersRef.current.delete(task.id)
    waiters.forEach((waiter) => waiter.resolve(task))
  }, [])

  const acceptTask = useCallback((incoming: AliasSyncTask) => {
    const current = taskRef.current
    if (current && current.id !== incoming.id && !isAliasSyncTaskTerminal(current.status)) {
      return current
    }
    const task = reconcileAliasSyncTask(current, incoming)
    if (task === current) {
      return current
    }
    taskRef.current = task
    dispatch({ type: 'snapshot', task })
    settleTerminalWaiters(task)
    return task
  }, [settleTerminalWaiters])

  useEffect(() => () => {
    const error = new TermousApiError('别名同步监听已结束', 'REQUEST_ABORTED', 0)
    terminalWaitersRef.current.forEach((waiters) => {
      waiters.forEach((waiter) => waiter.reject(error))
    })
    terminalWaitersRef.current.clear()
  }, [])

  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    const controller = new AbortController()
    taskRef.current = null
    dispatch({ type: 'reset' })
    dispatch({ type: 'recover-start' })
    void api.activeAliasSyncTask({ signal: controller.signal })
      .then((task) => {
        if (controller.signal.aborted) {
          return
        }
        if (task) {
          acceptTask(task)
        } else {
          dispatch({ type: 'recover-success', task: null })
        }
      })
      .catch((error) => {
        if (controller.signal.aborted || isRequestAborted(error)) {
          return
        }
        const requestError = aliasSyncRequestError(error)
        dispatch({
          type: 'recover-error',
          errorCode: requestError.code,
          errorMessage: requestError.message,
        })
      })
    return () => controller.abort()
  }, [acceptTask, api, enabled])

  const taskId = state.task?.id ?? ''
  const taskTerminal = state.task ? isAliasSyncTaskTerminal(state.task.status) : true
  useEffect(() => {
    if (!enabled || !taskId || taskTerminal) {
      return undefined
    }
    let disposed = false
    let pollTimer = 0
    let reconnectTimer = 0
    let reconnectDelay = ALIAS_SYNC_RECONNECT_INITIAL_DELAY
    let socket: WebSocket | null = null
    let pollController: AbortController | null = null

    const clearPoll = () => {
      if (pollTimer) {
        window.clearTimeout(pollTimer)
        pollTimer = 0
      }
    }

    const clearReconnect = () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = 0
      }
    }

    const schedulePoll = (delay: number) => {
      if (disposed || isAliasSyncTaskTerminal(taskRef.current?.status ?? 'cancelled')) {
        return
      }
      clearPoll()
      pollTimer = window.setTimeout(poll, delay)
    }

    const handleSnapshot = (task: AliasSyncTask) => {
      if (disposed || task.id !== taskId) {
        return
      }
      const accepted = acceptTask(task)
      if (accepted && !isAliasSyncTaskTerminal(accepted.status)) {
        schedulePoll(1_500)
      }
    }

    function poll() {
      if (disposed) {
        return
      }
      pollTimer = 0
      const controller = new AbortController()
      pollController = controller
      void api.aliasSyncTask(taskId, { signal: controller.signal })
        .then(handleSnapshot)
        .catch((error) => {
          if (isRequestAborted(error)) {
            return
          }
          // WebSocket 断开或单次 GET 失败时继续轮询，避免丢失最终任务状态。
        })
        .finally(() => {
          if (pollController === controller) {
            pollController = null
          }
          if (!disposed && !isAliasSyncTaskTerminal(taskRef.current?.status ?? 'cancelled')) {
            schedulePoll(1_500)
          }
        })
    }

    const scheduleReconnect = () => {
      if (
        disposed ||
        reconnectTimer ||
        isAliasSyncTaskTerminal(taskRef.current?.status ?? 'cancelled')
      ) {
        return
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = 0
        connect()
      }, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, ALIAS_SYNC_RECONNECT_MAXIMUM_DELAY)
    }

    function connect() {
      if (disposed || socket || isAliasSyncTaskTerminal(taskRef.current?.status ?? 'cancelled')) {
        return
      }
      let nextSocket: WebSocket
      try {
        nextSocket = new WebSocket(api.aliasSyncTaskEventsUrl(taskId))
      } catch {
        schedulePoll(100)
        scheduleReconnect()
        return
      }
      socket = nextSocket
      nextSocket.addEventListener('open', () => {
        reconnectDelay = ALIAS_SYNC_RECONNECT_INITIAL_DELAY
        clearReconnect()
        schedulePoll(0)
      })
      nextSocket.addEventListener('message', (event: MessageEvent<string>) => {
        try {
          const task = parseAliasSyncTaskEvent(JSON.parse(String(event.data)))
          if (task) {
            handleSnapshot(task)
          }
        } catch {
          // 忽略单条异常事件，GET revision 对账会补齐状态。
        }
      })
      nextSocket.addEventListener('close', () => {
        if (socket === nextSocket) {
          socket = null
        }
        schedulePoll(100)
        scheduleReconnect()
      })
      nextSocket.addEventListener('error', () => {
        schedulePoll(100)
        nextSocket.close()
      })
    }

    connect()
    schedulePoll(500)

    return () => {
      disposed = true
      clearPoll()
      clearReconnect()
      pollController?.abort()
      const currentSocket = socket
      socket = null
      if (currentSocket) {
        retireWebSocket(currentSocket)
      }
    }
  }, [acceptTask, api, enabled, taskId, taskTerminal])

  const recoverActive = useCallback(async () => {
    const task = await api.activeAliasSyncTask()
    return task ? acceptTask(task) : null
  }, [acceptTask, api])

  const start = useCallback(async (sourceSessionId: string, input: AliasSyncTaskInput) => {
    const activeTask = taskRef.current
    if (activeTask && !isAliasSyncTaskTerminal(activeTask.status)) {
      throw new TermousApiError('已有别名同步任务正在进行', 'ALIAS_SYNC_TASK_ACTIVE', 409)
    }
    dispatchState({ type: 'start-start' })
    try {
      const task = await api.createSessionAliasSyncTask(sourceSessionId, input)
      acceptTask(task)
      return task
    } catch (error) {
      const requestError = aliasSyncRequestError(error)
      dispatchState({
        type: 'start-error',
        errorCode: requestError.code,
        errorMessage: requestError.message,
      })
      throw error
    }
  }, [acceptTask, api, dispatchState])

  const waitForTerminal = useCallback((taskIdToWait: string) => {
    const task = taskRef.current
    if (task?.id === taskIdToWait && isAliasSyncTaskTerminal(task.status)) {
      return Promise.resolve(task)
    }
    return new Promise<AliasSyncTask>((resolve, reject) => {
      const waiters = terminalWaitersRef.current.get(taskIdToWait) ?? new Set()
      waiters.add({ resolve, reject })
      terminalWaitersRef.current.set(taskIdToWait, waiters)
    })
  }, [])

  const cancelAndWait = useCallback(async () => {
    const current = taskRef.current
    if (!current || isAliasSyncTaskTerminal(current.status)) {
      return current
    }
    dispatchState({ type: 'cancel-start' })
    try {
      const task = await api.cancelAliasSyncTask(current.id)
      const accepted = acceptTask(task)
      if (accepted && isAliasSyncTaskTerminal(accepted.status)) {
        return accepted
      }
      return await waitForTerminal(current.id)
    } catch (error) {
      const latest = taskRef.current
      if (latest?.id === current.id && isAliasSyncTaskTerminal(latest.status)) {
        return latest
      }
      const requestError = aliasSyncRequestError(error)
      dispatchState({
        type: 'cancel-error',
        errorCode: requestError.code,
        errorMessage: requestError.message,
      })
      throw error
    }
  }, [acceptTask, api, dispatchState, waitForTerminal])

  const reset = useCallback(() => dispatchState({ type: 'reset' }), [dispatchState])

  return {
    ...state,
    active: Boolean(state.task && !isAliasSyncTaskTerminal(state.task.status)),
    start,
    recoverActive,
    cancelAndWait,
    reset,
  }
}

function aliasSyncRequestError(error: unknown) {
  if (error instanceof TermousApiError) {
    return error
  }
  return new TermousApiError(
    error instanceof Error ? error.message : '别名同步失败',
    'ALIAS_SYNC_FAILED',
    0,
  )
}

function isRequestAborted(error: unknown) {
  return error instanceof TermousApiError && error.code === 'REQUEST_ABORTED'
}

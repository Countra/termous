import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { AliasSyncTask, AliasSyncTaskInput } from '#entities/alias'
import { TermousApiError } from '#shared/api'
import { retireWebSocket } from '#shared/websocket'
import type { AliasGateway } from './contracts'
import {
  aliasSyncTaskReducer,
  aliasSyncTaskMatchesRequest,
  createAliasSyncTaskViewState,
  isAliasSyncStartOutcomeUnknown,
  isAliasSyncTaskTerminal,
  isAliasSyncTaskNotFound,
  parseAliasSyncTaskEvent,
  reconcileAliasSyncTask,
  type AliasSyncTaskViewAction,
} from './aliasSyncTaskState'
import {
  rejectAliasSyncTerminalWaiters,
  rejectAllAliasSyncTerminalWaiters,
  resolveAliasSyncTerminalWaiters,
  waitForAliasSyncTerminal,
  type AliasSyncTerminalWaiterMap,
} from './aliasSyncTerminalWaiters'

interface UseAliasSyncTaskOptions {
  api: AliasGateway
  enabled: boolean
}

const ALIAS_SYNC_RECONNECT_INITIAL_DELAY = 500
const ALIAS_SYNC_RECONNECT_MAXIMUM_DELAY = 5_000

export function useAliasSyncTask({ api, enabled }: UseAliasSyncTaskOptions) {
  const [state, dispatch] = useReducer(aliasSyncTaskReducer, undefined, createAliasSyncTaskViewState)
  const taskRef = useRef<AliasSyncTask | null>(null)
  const lostTaskIdsRef = useRef(new Set<string>())
  const terminalWaitersRef = useRef<AliasSyncTerminalWaiterMap>(new Map())

  const dispatchState = useCallback((action: AliasSyncTaskViewAction) => {
    if (
      action.type === 'reset' ||
      action.type === 'start-start' ||
      action.type === 'task-lost' ||
      (action.type === 'recover-success' && !action.task)
    ) {
      taskRef.current = null
    }
    dispatch(action)
  }, [])

  const settleTerminalWaiters = useCallback((task: AliasSyncTask) => {
    if (!isAliasSyncTaskTerminal(task.status)) {
      return
    }
    resolveAliasSyncTerminalWaiters(terminalWaitersRef.current, task)
  }, [])

  const loseTask = useCallback((taskIdToLose: string, error: TermousApiError) => {
    lostTaskIdsRef.current.add(taskIdToLose)
    if (taskRef.current?.id === taskIdToLose) {
      taskRef.current = null
      dispatch({
        type: 'task-lost',
        errorCode: error.code,
        errorMessage: error.message,
      })
    }
    rejectAliasSyncTerminalWaiters(terminalWaitersRef.current, taskIdToLose, error)
  }, [])

  const acceptTask = useCallback((incoming: AliasSyncTask) => {
    const current = taskRef.current
    if (lostTaskIdsRef.current.has(incoming.id)) {
      return null
    }
    if (current && current.id !== incoming.id && !isAliasSyncTaskTerminal(current.status)) {
      return null
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
    rejectAllAliasSyncTerminalWaiters(terminalWaitersRef.current, error)
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

    const isTrackingTask = () => {
      const current = taskRef.current
      return !disposed && current?.id === taskId && !isAliasSyncTaskTerminal(current.status)
    }

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
      if (!isTrackingTask()) {
        return
      }
      clearPoll()
      pollTimer = window.setTimeout(poll, delay)
    }

    const handleSnapshot = (task: AliasSyncTask) => {
      if (!isTrackingTask() || task.id !== taskId) {
        return
      }
      const accepted = acceptTask(task)
      if (accepted && !isAliasSyncTaskTerminal(accepted.status)) {
        schedulePoll(1_500)
      }
    }

    function poll() {
      if (!isTrackingTask() || pollController) {
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
          const requestError = aliasSyncRequestError(error)
          if (isAliasSyncTaskNotFound(requestError.code, requestError.status)) {
            loseTask(taskId, requestError)
            return
          }
          // WebSocket 断开或单次 GET 失败时继续轮询，避免丢失最终任务状态。
        })
        .finally(() => {
          if (pollController === controller) {
            pollController = null
          }
          if (isTrackingTask()) {
            schedulePoll(1_500)
          }
        })
    }

    const scheduleReconnect = () => {
      if (
        !isTrackingTask() ||
        reconnectTimer ||
        socket
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
      if (!isTrackingTask() || socket) {
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
  }, [acceptTask, api, enabled, loseTask, taskId, taskTerminal])

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
      if (isAliasSyncStartOutcomeUnknown(requestError.code, requestError.status)) {
        try {
          const activeTask = await api.activeAliasSyncTask()
          if (activeTask && aliasSyncTaskMatchesRequest(
            activeTask,
            sourceSessionId,
            input.alias_ids,
            input.target_host_ids,
          )) {
            return acceptTask(activeTask)
          }
        } catch {
          // 恢复查询失败时保留原始创建错误，避免掩盖结果不确定的请求。
        }
      }
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
    return waitForAliasSyncTerminal(
      terminalWaitersRef.current,
      taskIdToWait,
      new TermousApiError('等待别名同步任务结束超时', 'REQUEST_TIMEOUT', 0),
    )
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
      if (!accepted || isAliasSyncTaskTerminal(accepted.status)) {
        return accepted
      }
      return await waitForTerminal(current.id)
    } catch (error) {
      const latest = taskRef.current
      if (latest?.id === current.id && isAliasSyncTaskTerminal(latest.status)) {
        return latest
      }
      const requestError = aliasSyncRequestError(error)
      if (isAliasSyncTaskNotFound(requestError.code, requestError.status)) {
        loseTask(current.id, requestError)
        return null
      }
      dispatchState({
        type: 'cancel-error',
        errorCode: requestError.code,
        errorMessage: requestError.message,
      })
      throw error
    }
  }, [acceptTask, api, dispatchState, loseTask, waitForTerminal])

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

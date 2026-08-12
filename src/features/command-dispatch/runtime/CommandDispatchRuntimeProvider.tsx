import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import type {
  CommandDispatchTask,
  CommandDispatchTaskInput,
} from '#entities/command-dispatch'
import { TermousApiError } from '#shared/api'
import { retireWebSocket } from '#shared/websocket'
import { decodeTerminalOutputFrame } from '#features/terminal'
import type { CommandDispatchGateway } from '../api/commandDispatchGateway'
import { CommandDispatchOutputStore } from '../model/commandDispatchOutputStore'
import {
  commandDispatchTaskMatchesInput,
  commandDispatchTaskReducer,
  createCommandDispatchTaskViewState,
  isCommandDispatchTargetTerminal,
  isCommandDispatchTaskTerminal,
  reconcileCommandDispatchTask,
} from '../model/commandDispatchTaskState'
import { decodeCommandDispatchTaskEvent } from '../model/commandDispatchProtocol'
import {
  CommandDispatchRuntimeContext,
  type CommandDispatchRuntimeContextValue,
} from './commandDispatchContext'

interface CommandDispatchRuntimeProviderProps {
  api: CommandDispatchGateway
  children: ReactNode
}

const reconnectInitialDelay = 500
const reconnectMaximumDelay = 5_000

export function CommandDispatchRuntimeProvider({
  api,
  children,
}: CommandDispatchRuntimeProviderProps) {
  const [state, dispatch] = useReducer(
    commandDispatchTaskReducer,
    undefined,
    createCommandDispatchTaskViewState,
  )
  const taskRef = useRef<CommandDispatchTask | null>(null)
  const activityGenerationRef = useRef(0)
  const recoveryTokenRef = useRef<object | null>({})
  const startInFlightRef = useRef<Promise<CommandDispatchTask> | null>(null)
  const outputStore = useMemo(
    () => new CommandDispatchOutputStore(api, decodeTerminalOutputFrame),
    [api],
  )

  const acceptTask = useCallback((incoming: CommandDispatchTask) => {
    const task = reconcileCommandDispatchTask(taskRef.current, incoming)
    if (task === taskRef.current) {
      return task
    }
    taskRef.current = task
    outputStore.retainTask(task)
    dispatch({ type: 'snapshot', task })
    return task
  }, [outputStore])

  useEffect(() => {
    const controller = new AbortController()
    const recoveryToken = {}
    recoveryTokenRef.current = recoveryToken
    const recoveryGeneration = activityGenerationRef.current
    dispatch({ type: 'recover-start' })
    void api.latestTask({ signal: controller.signal })
      .then((task) => {
        if (
          controller.signal.aborted
          || activityGenerationRef.current !== recoveryGeneration
        ) {
          return
        }
        taskRef.current = task
        outputStore.retainTask(task)
        dispatch({ type: 'recover-success', task })
      })
      .catch((error) => {
        if (
          controller.signal.aborted
          || activityGenerationRef.current !== recoveryGeneration
          || requestAborted(error)
        ) {
          return
        }
        const requestError = commandDispatchRequestError(error)
        dispatch({
          type: 'recover-error',
          errorCode: requestError.code,
          errorMessage: requestError.message,
        })
      })
      .finally(() => {
        if (recoveryTokenRef.current === recoveryToken) {
          recoveryTokenRef.current = null
        }
      })
    return () => {
      controller.abort()
      if (recoveryTokenRef.current === recoveryToken) {
        recoveryTokenRef.current = null
      }
    }
  }, [api, outputStore])

  const taskId = state.task?.id ?? ''
  const taskTerminal = state.task ? isCommandDispatchTaskTerminal(state.task.status) : true
  useEffect(() => {
    if (!taskId || taskTerminal) {
      return undefined
    }
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let pollTimer = 0
    let reconnectDelay = reconnectInitialDelay
    let pollController: AbortController | null = null

    const tracking = () => (
      !disposed
      && taskRef.current?.id === taskId
      && !isCommandDispatchTaskTerminal(taskRef.current.status)
    )
    const schedulePoll = (delay: number) => {
      if (!tracking()) return
      window.clearTimeout(pollTimer)
      pollTimer = window.setTimeout(poll, delay)
    }
    function poll() {
      if (!tracking() || pollController) return
      const controller = new AbortController()
      pollController = controller
      void api.task(taskId, { signal: controller.signal })
        .then((task) => {
          if (tracking()) acceptTask(task)
        })
        .catch((error) => {
          if (!tracking()) return
          const requestError = commandDispatchRequestError(error)
          if (requestError.status !== 404) return
          activityGenerationRef.current += 1
          taskRef.current = null
          outputStore.retainTask(null)
          dispatch({
            type: 'task-lost',
            errorCode: requestError.code,
            errorMessage: requestError.message,
          })
        })
        .finally(() => {
          if (pollController === controller) pollController = null
          if (tracking()) schedulePoll(1_500)
        })
    }
    const scheduleReconnect = () => {
      if (!tracking() || socket || reconnectTimer) return
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = 0
        connect()
      }, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaximumDelay)
    }
    function connect() {
      if (!tracking() || socket) return
      let nextSocket: WebSocket
      try {
        nextSocket = new WebSocket(api.taskEventsUrl(taskId))
      } catch {
        schedulePoll(100)
        scheduleReconnect()
        return
      }
      socket = nextSocket
      nextSocket.addEventListener('open', () => {
        reconnectDelay = reconnectInitialDelay
        schedulePoll(0)
      })
      nextSocket.addEventListener('message', (event: MessageEvent<string>) => {
        try {
          const taskEvent = decodeCommandDispatchTaskEvent(JSON.parse(String(event.data)))
          if (tracking() && taskEvent?.task.id === taskId) {
            acceptTask(taskEvent.task)
          }
        } catch {
          // 异常事件由周期 GET revision 对账补齐，不中断后续合法事件。
        }
      })
      nextSocket.addEventListener('close', () => {
        if (socket === nextSocket) socket = null
        schedulePoll(100)
        scheduleReconnect()
      })
      nextSocket.addEventListener('error', () => nextSocket.close())
    }
    connect()
    schedulePoll(500)
    return () => {
      disposed = true
      window.clearTimeout(reconnectTimer)
      window.clearTimeout(pollTimer)
      pollController?.abort()
      const currentSocket = socket
      socket = null
      if (currentSocket) retireWebSocket(currentSocket)
    }
  }, [acceptTask, api, outputStore, taskId, taskTerminal])

  useEffect(() => () => outputStore.dispose(), [outputStore])

  const start = useCallback((input: CommandDispatchTaskInput) => {
    if (recoveryTokenRef.current) {
      return Promise.reject(new TermousApiError(
        '正在恢复最近的会话命令任务',
        'COMMAND_DISPATCH_TASK_RECOVERING',
        409,
      ))
    }
    if (startInFlightRef.current) {
      return Promise.reject(new TermousApiError(
        '会话命令任务正在创建',
        'COMMAND_DISPATCH_TASK_STARTING',
        409,
      ))
    }
    const activeTask = taskRef.current
    if (activeTask && !isCommandDispatchTaskTerminal(activeTask.status)) {
      return Promise.reject(new TermousApiError(
        '已有会话命令任务正在执行',
        'COMMAND_DISPATCH_TASK_ACTIVE',
        409,
      ))
    }
    activityGenerationRef.current += 1
    dispatch({ type: 'start-start' })
    const operation = (async () => {
      try {
        return acceptTask(await api.createTask(input))
      } catch (error) {
        const requestError = commandDispatchRequestError(error)
        if (requestError.status === 0) {
          try {
            const latest = await api.latestTask({ fresh: true })
            if (latest && commandDispatchTaskMatchesInput(latest, input)) {
              return acceptTask(latest)
            }
          } catch {
            // 保留原始创建错误，避免恢复查询失败掩盖未知提交结果。
          }
        }
        dispatch({
          type: 'start-error',
          errorCode: requestError.code,
          errorMessage: requestError.message,
        })
        throw error
      }
    })()
    startInFlightRef.current = operation
    void operation.then(
      () => clearStartInFlight(startInFlightRef, operation),
      () => clearStartInFlight(startInFlightRef, operation),
    )
    return operation
  }, [acceptTask, api])

  const interruptTask = useCallback(async () => {
    const task = taskRef.current
    if (!task || isCommandDispatchTaskTerminal(task.status) || !task.interruptible) {
      return task
    }
    dispatch({ type: 'interrupt-task-start' })
    try {
      const result = await api.interruptTask(task.id)
      return taskRef.current?.id === task.id ? acceptTask(result) : taskRef.current
    } catch (error) {
      if (taskRef.current?.id !== task.id) {
        return taskRef.current
      }
      const requestError = commandDispatchRequestError(error)
      dispatch({
        type: 'interrupt-error',
        errorCode: requestError.code,
        errorMessage: requestError.message,
      })
      throw error
    }
  }, [acceptTask, api])

  const interruptTarget = useCallback(async (sessionId: string) => {
    const task = taskRef.current
    const target = task?.targets.find((item) => item.session_id === sessionId)
    if (!task || !target || isCommandDispatchTargetTerminal(target.status)) {
      return task
    }
    dispatch({ type: 'interrupt-target-start', sessionId })
    try {
      const result = await api.interruptTarget(task.id, sessionId)
      return taskRef.current?.id === task.id ? acceptTask(result) : taskRef.current
    } catch (error) {
      if (taskRef.current?.id !== task.id) {
        return taskRef.current
      }
      const requestError = commandDispatchRequestError(error)
      dispatch({
        type: 'interrupt-error',
        sessionId,
        errorCode: requestError.code,
        errorMessage: requestError.message,
      })
      throw error
    }
  }, [acceptTask, api])

  const value = useMemo<CommandDispatchRuntimeContextValue>(() => ({
    state,
    start,
    interruptTask,
    interruptTarget,
    subscribeTargetOutput: (id, sessionId, listener) => outputStore.subscribe(id, sessionId, listener),
    getTargetOutputSnapshot: (id, sessionId) => outputStore.getSnapshot(id, sessionId),
  }), [interruptTarget, interruptTask, outputStore, start, state])

  return (
    <CommandDispatchRuntimeContext.Provider value={value}>
      {children}
    </CommandDispatchRuntimeContext.Provider>
  )
}

function commandDispatchRequestError(error: unknown) {
  return error instanceof TermousApiError
    ? error
    : new TermousApiError(
        error instanceof Error ? error.message : '会话命令请求失败',
        'COMMAND_DISPATCH_REQUEST_FAILED',
        0,
      )
}

function requestAborted(error: unknown) {
  return error instanceof TermousApiError && error.code === 'REQUEST_ABORTED'
}

function clearStartInFlight(
  ref: { current: Promise<CommandDispatchTask> | null },
  operation: Promise<CommandDispatchTask>,
) {
  if (ref.current === operation) {
    ref.current = null
  }
}

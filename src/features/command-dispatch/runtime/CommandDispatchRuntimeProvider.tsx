import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
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
import {
  decodeCommandDispatchCollectionEvent,
  decodeCommandDispatchTaskEvent,
} from '../model/commandDispatchProtocol'
import {
  CommandDispatchRuntimeContext,
  type CommandDispatchRuntimeContextValue,
} from './commandDispatchContext'

interface CommandDispatchRuntimeProviderProps {
  api: CommandDispatchGateway
  enabled?: boolean
  children: ReactNode
}

const reconnectInitialDelay = 500
const reconnectMaximumDelay = 5_000

export function CommandDispatchRuntimeProvider({
  api,
  enabled = true,
  children,
}: CommandDispatchRuntimeProviderProps) {
  const [state, dispatch] = useReducer(
    commandDispatchTaskReducer,
    undefined,
    createCommandDispatchTaskViewState,
  )
  const [tasks, setTasks] = useState<CommandDispatchTask[]>([])
  const tasksRef = useRef<CommandDispatchTask[]>([])
  const taskRef = useRef<CommandDispatchTask | null>(null)
  const unconfirmedTasksRef = useRef(new Set<string>())
  const refreshCollectionRef = useRef<() => void>(() => undefined)
  const activityGenerationRef = useRef(0)
  const recoveryTokenRef = useRef<object | null>({})
  const startInFlightRef = useRef<Promise<CommandDispatchTask> | null>(null)
  const outputStore = useMemo(
    () => new CommandDispatchOutputStore(api, decodeTerminalOutputFrame),
    [api],
  )

  const selectSnapshot = useCallback((task: CommandDispatchTask | null) => {
    activityGenerationRef.current += 1
    taskRef.current = task
    outputStore.retainTask(task)
    dispatch({ type: 'recover-success', task })
  }, [outputStore])

  const acceptTask = useCallback((incoming: CommandDispatchTask, select = false) => {
    const task = reconcileCommandDispatchTask(tasksRef.current.find(({ id }) => id === incoming.id) ?? null, incoming)
    tasksRef.current = [task, ...tasksRef.current.filter(({ id }) => id !== task.id)]
      .sort((left, right) => -compareTaskCreation(left, right)).slice(0, 49)
    setTasks(tasksRef.current)
    if (select || !taskRef.current) selectSnapshot(task)
    else if (taskRef.current.id === task.id) {
      taskRef.current = task
      outputStore.retainTask(task)
      dispatch({ type: 'snapshot', task })
    }
    return task
  }, [outputStore, selectSnapshot])

  const selectTask = useCallback((id: string) => {
    const task = tasksRef.current.find((entry) => entry.id === id)
    if (task) selectSnapshot(task)
  }, [selectSnapshot])

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let socket: WebSocket | null = null
    let timer = 0
    let revision = -1
    let connection = 0
    let reconcileController: AbortController | null = null
    const token = {}
    recoveryTokenRef.current = token
    dispatch({ type: 'recover-start' })
    const acceptCollection = (collection: { revision: number; items: CommandDispatchTask[] }, authoritativeRead = false) => {
      if (disposed || collection.revision < revision) return
      revision = collection.revision
      if (authoritativeRead) unconfirmedTasksRef.current.clear()
      for (const item of collection.items) unconfirmedTasksRef.current.delete(item.id)
      const unconfirmed = tasksRef.current.filter(({ id }) => unconfirmedTasksRef.current.has(id))
      tasksRef.current = [...unconfirmed, ...collection.items.map((incoming) => reconcileCommandDispatchTask(
        tasksRef.current.find(({ id }) => id === incoming.id) ?? null, incoming))
      ]
      setTasks(tasksRef.current)
      const selected = tasksRef.current.find(({ id }) => id === taskRef.current?.id) ?? tasksRef.current[0] ?? null
      if (selected?.id !== taskRef.current?.id) selectSnapshot(selected)
      else if (selected) acceptTask(selected)
      else dispatch({ type: 'recover-success', task: null })
      if (recoveryTokenRef.current === token) recoveryTokenRef.current = null
    }
    const reconcile = () => {
      reconcileController?.abort()
      const controller = new AbortController()
      reconcileController = controller
      const epoch = connection
      const activity = activityGenerationRef.current
      void api.tasks({ signal: controller.signal }).then((collection) => {
        if (!controller.signal.aborted && epoch === connection && activity === activityGenerationRef.current) acceptCollection(collection, true)
      }).catch((error) => {
        if (disposed || controller.signal.aborted) return
        const failure = commandDispatchRequestError(error)
        dispatch({ type: 'recover-error', errorCode: failure.code, errorMessage: failure.message })
      })
    }
    refreshCollectionRef.current = reconcile
    const connect = () => {
      if (disposed) return
      connection += 1
      revision = -1
      reconcile()
      try { socket = new WebSocket(api.tasksEventsUrl()) }
      catch { timer = window.setTimeout(connect, reconnectInitialDelay); return }
      const current = socket
      current.addEventListener('open', () => { if (socket === current && !disposed) reconcile() })
      current.addEventListener('message', (message: MessageEvent<string>) => {
        if (socket !== current || disposed) return
        try { acceptCollection(decodeCommandDispatchCollectionEvent(JSON.parse(String(message.data)))) }
        catch { reconcile() }
      })
      current.addEventListener('error', () => current.close())
      current.addEventListener('close', () => {
        if (disposed || socket !== current) return
        socket = null
        timer = window.setTimeout(connect, reconnectInitialDelay)
      })
    }
    connect()
    return () => {
      disposed = true
      refreshCollectionRef.current = () => undefined
      window.clearTimeout(timer)
      reconcileController?.abort()
      if (socket) retireWebSocket(socket)
      if (recoveryTokenRef.current === token) recoveryTokenRef.current = null
    }
  }, [acceptTask, api, enabled, selectSnapshot])

  const taskId = state.task?.id ?? ''
  const taskTerminal = state.task ? isCommandDispatchTaskTerminal(state.task.status) : true
  useEffect(() => {
    if (!enabled || !taskId || taskTerminal) {
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
  }, [acceptTask, api, enabled, outputStore, taskId, taskTerminal])

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
    activityGenerationRef.current += 1
    dispatch({ type: 'start-start' })
    const operation = (async () => {
      try {
        const task = await api.createTask(input)
        unconfirmedTasksRef.current.add(task.id)
        const accepted = acceptTask(task, true)
        refreshCollectionRef.current()
        return accepted
      } catch (error) {
        const requestError = commandDispatchRequestError(error)
        if (requestError.status === 0) {
          try {
            const recovered = (await api.tasks({ clientRequestId: input.client_request_id })).items.find((task) => commandDispatchTaskMatchesInput(task, input))
            if (recovered) {
              unconfirmedTasksRef.current.add(recovered.id)
              const accepted = acceptTask(recovered, true)
              refreshCollectionRef.current()
              return accepted
            }
          } catch {
            // 保留原始创建错误，避免恢复查询失败掩盖未知提交结果。
          }
        }
        const failure = requestError.status === 0
          ? new TermousApiError('命令提交结果未知，请检查任务列表后再决定是否重新执行', 'COMMAND_DISPATCH_RESULT_UNKNOWN', 0, { client_request_id: input.client_request_id })
          : requestError
        dispatch({
          type: 'start-error',
          errorCode: failure.code,
          errorMessage: failure.message,
        })
        throw failure
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
    tasks,
    selectTask,
    start,
    interruptTask,
    interruptTarget,
    subscribeTargetOutput: (id, sessionId, listener) => outputStore.subscribe(id, sessionId, listener),
    getTargetOutputSnapshot: (id, sessionId) => outputStore.getSnapshot(id, sessionId),
  }), [interruptTarget, interruptTask, outputStore, start, state, tasks, selectTask])

  return (
    <CommandDispatchRuntimeContext.Provider value={value}>
      {children}
    </CommandDispatchRuntimeContext.Provider>
  )
}

function compareTaskCreation(left: CommandDispatchTask, right: CommandDispatchTask) {
  const leftMilliseconds = Date.parse(left.created_at)
  const rightMilliseconds = Date.parse(right.created_at)
  if (!Number.isFinite(leftMilliseconds) || !Number.isFinite(rightMilliseconds)) return 0
  if (leftMilliseconds !== rightMilliseconds) return leftMilliseconds < rightMilliseconds ? -1 : 1
  const leftNanoseconds = timestampFractionNanoseconds(left.created_at)
  const rightNanoseconds = timestampFractionNanoseconds(right.created_at)
  return leftNanoseconds === rightNanoseconds ? 0 : leftNanoseconds < rightNanoseconds ? -1 : 1
}

function timestampFractionNanoseconds(timestamp: string) {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(timestamp)?.[1] ?? ''
  return Number(`${fraction.slice(0, 9)}000000000`.slice(0, 9))
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

function clearStartInFlight(
  ref: { current: Promise<CommandDispatchTask> | null },
  operation: Promise<CommandDispatchTask>,
) {
  if (ref.current === operation) {
    ref.current = null
  }
}

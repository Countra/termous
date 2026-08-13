import type {
  CommandDispatchTarget,
  CommandDispatchTargetStatus,
  CommandDispatchTask,
  CommandDispatchTaskInput,
  CommandDispatchTaskStatus,
} from '#entities/command-dispatch'

export type CommandDispatchExitCodeDisplay =
  | { kind: 'known'; code: number }
  | { kind: 'unknown' }
  | null

export interface CommandDispatchTaskViewState {
  task: CommandDispatchTask | null
  recovering: boolean
  starting: boolean
  interruptingTask: boolean
  interruptingSessionIds: ReadonlySet<string>
  errorCode: string
  errorMessage: string
}

export type CommandDispatchTaskViewAction =
  | { type: 'recover-start' }
  | { type: 'recover-success'; task: CommandDispatchTask | null }
  | { type: 'recover-error'; errorCode: string; errorMessage: string }
  | { type: 'task-lost'; errorCode: string; errorMessage: string }
  | { type: 'start-start' }
  | { type: 'start-error'; errorCode: string; errorMessage: string }
  | { type: 'snapshot'; task: CommandDispatchTask }
  | { type: 'interrupt-task-start' }
  | { type: 'interrupt-target-start'; sessionId: string }
  | { type: 'interrupt-error'; sessionId?: string; errorCode: string; errorMessage: string }

export function createCommandDispatchTaskViewState(): CommandDispatchTaskViewState {
  return {
    task: null,
    recovering: false,
    starting: false,
    interruptingTask: false,
    interruptingSessionIds: new Set(),
    errorCode: '',
    errorMessage: '',
  }
}

export function isCommandDispatchTaskTerminal(status: CommandDispatchTaskStatus) {
  return status === 'completed'
    || status === 'partial_failed'
    || status === 'failed'
    || status === 'interrupted'
}

export function isCommandDispatchTargetTerminal(status: CommandDispatchTargetStatus) {
  return status === 'succeeded'
    || status === 'failed'
    || status === 'interrupted'
    || status === 'rejected'
    || status === 'disconnected'
    || status === 'uncertain'
    || status === 'completed_unknown'
}

export function commandDispatchExitCodeDisplay(
  target: CommandDispatchTarget,
): CommandDispatchExitCodeDisplay {
  if (target.status === 'completed_unknown') {
    return { kind: 'unknown' }
  }
  if (
    (target.status === 'succeeded' || target.status === 'failed')
    && target.exit_code_known
    && target.exit_code !== undefined
  ) {
    return { kind: 'known', code: target.exit_code }
  }
  return null
}

export function reconcileCommandDispatchTask(
  current: CommandDispatchTask | null,
  incoming: CommandDispatchTask,
) {
  if (!current || current.id !== incoming.id) {
    return incoming
  }
  if (incoming.revision < current.revision) {
    return current
  }
  if (
    incoming.revision === current.revision
    && isCommandDispatchTaskTerminal(current.status)
    && !isCommandDispatchTaskTerminal(incoming.status)
  ) {
    return current
  }
  return incoming
}

export function commandDispatchTaskMatchesInput(
  task: CommandDispatchTask,
  input: CommandDispatchTaskInput,
) {
  return task.client_request_id === input.client_request_id
    && task.scope === input.scope
    && task.command === input.command
    && equalStringArrays(task.target_session_ids, input.target_session_ids)
}

function equalStringArrays(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function commandDispatchTaskReducer(
  state: CommandDispatchTaskViewState,
  action: CommandDispatchTaskViewAction,
): CommandDispatchTaskViewState {
  switch (action.type) {
    case 'recover-start':
      return { ...state, recovering: true, errorCode: '', errorMessage: '' }
    case 'recover-success':
      return {
        ...state,
        task: action.task,
        recovering: false,
        starting: false,
        interruptingTask: false,
        interruptingSessionIds: new Set(),
        errorCode: '',
        errorMessage: '',
      }
    case 'recover-error':
      return {
        ...state,
        recovering: false,
        errorCode: action.errorCode,
        errorMessage: action.errorMessage,
      }
    case 'task-lost':
      return {
        ...state,
        task: null,
        recovering: false,
        starting: false,
        interruptingTask: false,
        interruptingSessionIds: new Set(),
        errorCode: action.errorCode,
        errorMessage: action.errorMessage,
      }
    case 'start-start':
      return {
        ...state,
        recovering: false,
        starting: true,
        errorCode: '',
        errorMessage: '',
      }
    case 'start-error':
      return {
        ...state,
        starting: false,
        errorCode: action.errorCode,
        errorMessage: action.errorMessage,
      }
    case 'snapshot': {
      const task = reconcileCommandDispatchTask(state.task, action.task)
      const activeSessionIds = new Set(
        task.targets
          .filter((target) => !isCommandDispatchTargetTerminal(target.status))
          .map((target) => target.session_id),
      )
      return {
        ...state,
        task,
        recovering: false,
        starting: false,
        interruptingTask: state.interruptingTask && !isCommandDispatchTaskTerminal(task.status),
        interruptingSessionIds: new Set(
          [...state.interruptingSessionIds].filter((sessionId) => activeSessionIds.has(sessionId)),
        ),
        errorCode: '',
        errorMessage: '',
      }
    }
    case 'interrupt-task-start':
      return { ...state, interruptingTask: true, errorCode: '', errorMessage: '' }
    case 'interrupt-target-start':
      return {
        ...state,
        interruptingSessionIds: new Set([...state.interruptingSessionIds, action.sessionId]),
        errorCode: '',
        errorMessage: '',
      }
    case 'interrupt-error': {
      const nextSessionIds = new Set(state.interruptingSessionIds)
      if (action.sessionId) {
        nextSessionIds.delete(action.sessionId)
      }
      return {
        ...state,
        interruptingTask: action.sessionId ? state.interruptingTask : false,
        interruptingSessionIds: nextSessionIds,
        errorCode: action.errorCode,
        errorMessage: action.errorMessage,
      }
    }
  }
}

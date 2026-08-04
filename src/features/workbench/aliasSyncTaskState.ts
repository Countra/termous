import type {
  AliasSyncTask,
  AliasSyncTaskEvent,
  AliasSyncTaskStatus,
  AliasSyncTargetStatus,
} from '../../types/domain'

export interface AliasSyncTaskViewState {
  task: AliasSyncTask | null
  recovering: boolean
  starting: boolean
  cancelling: boolean
  errorCode: string
  errorMessage: string
}

export type AliasSyncTaskViewAction =
  | { type: 'recover-start' }
  | { type: 'recover-success'; task: AliasSyncTask | null }
  | { type: 'recover-error'; errorCode: string; errorMessage: string }
  | { type: 'start-start' }
  | { type: 'start-error'; errorCode: string; errorMessage: string }
  | { type: 'snapshot'; task: AliasSyncTask }
  | { type: 'cancel-start' }
  | { type: 'cancel-error'; errorCode: string; errorMessage: string }
  | { type: 'reset' }

export function createAliasSyncTaskViewState(): AliasSyncTaskViewState {
  return {
    task: null,
    recovering: false,
    starting: false,
    cancelling: false,
    errorCode: '',
    errorMessage: '',
  }
}

export function isAliasSyncTaskTerminal(status: AliasSyncTaskStatus) {
  return status === 'completed'
    || status === 'partial_failed'
    || status === 'failed'
    || status === 'cancelled'
}

export function isAliasSyncTargetTerminal(status: AliasSyncTargetStatus) {
  return status === 'succeeded'
    || status === 'skipped'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'uncertain'
}

export function aliasSyncCloseNeedsCancellation(
  starting: boolean,
  status?: AliasSyncTaskStatus,
) {
  return starting || Boolean(status && !isAliasSyncTaskTerminal(status))
}

export function reconcileAliasSyncTask(
  current: AliasSyncTask | null,
  incoming: AliasSyncTask,
): AliasSyncTask {
  if (!current || current.id !== incoming.id) {
    return incoming
  }
  if (incoming.revision < current.revision) {
    return current
  }
  if (
    incoming.revision === current.revision &&
    isAliasSyncTaskTerminal(current.status) &&
    !isAliasSyncTaskTerminal(incoming.status)
  ) {
    return current
  }
  return incoming
}

export function aliasSyncTaskReducer(
  state: AliasSyncTaskViewState,
  action: AliasSyncTaskViewAction,
): AliasSyncTaskViewState {
  switch (action.type) {
    case 'recover-start':
      return {
        ...state,
        recovering: true,
        errorCode: '',
        errorMessage: '',
      }
    case 'recover-success':
      return {
        ...state,
        task: action.task,
        recovering: false,
        starting: false,
        cancelling: false,
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
    case 'start-start':
      return {
        ...state,
        task: null,
        starting: true,
        cancelling: false,
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
      const task = reconcileAliasSyncTask(state.task, action.task)
      const terminal = isAliasSyncTaskTerminal(task.status)
      return {
        ...state,
        task,
        recovering: false,
        starting: false,
        cancelling: terminal ? false : state.cancelling,
        errorCode: '',
        errorMessage: '',
      }
    }
    case 'cancel-start':
      return {
        ...state,
        cancelling: true,
        errorCode: '',
        errorMessage: '',
      }
    case 'cancel-error':
      return {
        ...state,
        cancelling: false,
        errorCode: action.errorCode,
        errorMessage: action.errorMessage,
      }
    case 'reset':
      return createAliasSyncTaskViewState()
  }
}

export function aliasSyncProgress(task: AliasSyncTask | null) {
  if (!task) {
    return 0
  }
  if (task.status === 'completed') {
    return 100
  }
  return Math.max(0, Math.min(100, task.progress_percent || 0))
}

export function aliasSyncSelectedTargetIds(
  hostIds: readonly string[],
  sourceHostId: string | undefined,
) {
  const seen = new Set<string>()
  return hostIds.filter((hostId) => {
    if (!hostId || hostId === sourceHostId || seen.has(hostId)) {
      return false
    }
    seen.add(hostId)
    return true
  })
}

export function aliasSyncTaskMatchesRequest(
  task: AliasSyncTask,
  sourceSessionId: string,
  aliasIds: readonly string[],
  targetHostIds: readonly string[],
) {
  return task.source.session_id === sourceSessionId
    && equalStringSequence(task.alias_ids, aliasIds)
    && equalStringSequence(task.target_host_ids, targetHostIds)
}

export function parseAliasSyncTaskEvent(value: unknown): AliasSyncTask | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const event = value as Partial<AliasSyncTaskEvent>
  if (
    event.type !== 'alias_sync_task_update' ||
    !event.task ||
    typeof event.task.id !== 'string' ||
    typeof event.task.revision !== 'number'
  ) {
    return null
  }
  return event.task
}

function equalStringSequence(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

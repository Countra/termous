import type {
  AliasApplyStatus,
  AliasWorkspace,
  ShellAlias,
  ShellAliasInput,
  ShellAliasPatch,
} from '../../types/domain'

export type AliasMutationKind = 'create' | 'update' | 'delete' | 'repair'

const aliasReconnectSessionLimit = 512
const aliasReconnectSessionIDLimit = 256

export function aliasPanelControlScope(sessionId: string | undefined) {
  return `workbench-alias-${encodeURIComponent(sessionId || 'inactive')}`
}

export function parseAliasReconnectSessionIds(value: string | null): string[] {
  if (!value) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }
    const result: string[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (
        typeof item !== 'string' ||
        item.length === 0 ||
        item.length > aliasReconnectSessionIDLimit ||
        seen.has(item)
      ) {
        continue
      }
      result.push(item)
      seen.add(item)
      if (result.length >= aliasReconnectSessionLimit) {
        break
      }
    }
    return result
  } catch {
    return []
  }
}

export function serializeAliasReconnectSessionIds(sessionIds: Iterable<string>): string {
  return JSON.stringify(parseAliasReconnectSessionIds(JSON.stringify(Array.from(sessionIds))))
}

export interface AliasSessionViewState {
  requestSequence: number
  workspace: AliasWorkspace | null
  loading: boolean
  refreshing: boolean
  mutation: AliasMutationKind | null
  mutatingAliasId: string
  reconnectRequired: boolean
  errorCode: string
  errorMessage: string
  lastLoadedAt: number
}

export type AliasSessionViewStates = Record<string, AliasSessionViewState>

export type AliasSessionViewAction =
  | {
    type: 'load-start'
    sessionId: string
    sequence: number
    quiet: boolean
  }
  | {
    type: 'load-success'
    sessionId: string
    sequence: number
    workspace: AliasWorkspace
    loadedAt: number
  }
  | {
    type: 'load-error'
    sessionId: string
    sequence: number
    errorCode: string
    errorMessage: string
  }
  | {
    type: 'mutation-start'
    sessionId: string
    sequence: number
    mutation: AliasMutationKind
    aliasId: string
  }
  | {
    type: 'mutation-success'
    sessionId: string
    sequence: number
    workspace: AliasWorkspace
    applyStatus: AliasApplyStatus
  }
  | {
    type: 'mutation-error'
    sessionId: string
    sequence: number
    errorCode: string
    errorMessage: string
  }
  | { type: 'retire'; sessionId: string; sequence: number }

export function createAliasSessionViewState(): AliasSessionViewState {
  return {
    requestSequence: 0,
    workspace: null,
    loading: false,
    refreshing: false,
    mutation: null,
    mutatingAliasId: '',
    reconnectRequired: false,
    errorCode: '',
    errorMessage: '',
    lastLoadedAt: 0,
  }
}

export function aliasSessionViewReducer(
  states: AliasSessionViewStates,
  action: AliasSessionViewAction,
): AliasSessionViewStates {
  const current = states[action.sessionId] ?? createAliasSessionViewState()
  const startsOperation =
    action.type === 'load-start' ||
    action.type === 'mutation-start' ||
    action.type === 'retire'
  if (!startsOperation && action.sequence !== current.requestSequence) {
    return states
  }
  if (startsOperation && action.sequence <= current.requestSequence) {
    return states
  }

  let next: AliasSessionViewState
  switch (action.type) {
    case 'load-start':
      next = {
        ...current,
        requestSequence: action.sequence,
        loading: action.quiet ? current.loading : !current.workspace,
        refreshing: action.quiet || Boolean(current.workspace),
        errorCode: '',
        errorMessage: '',
      }
      break
    case 'load-success':
      next = {
        ...current,
        workspace: action.workspace,
        loading: false,
        refreshing: false,
        reconnectRequired:
          current.reconnectRequired,
        errorCode: '',
        errorMessage: '',
        lastLoadedAt: action.loadedAt,
      }
      break
    case 'load-error':
      next = {
        ...current,
        loading: false,
        refreshing: false,
        errorCode: action.errorCode,
        errorMessage: action.errorMessage,
      }
      break
    case 'mutation-start':
      next = {
        ...current,
        requestSequence: action.sequence,
        loading: false,
        refreshing: false,
        mutation: action.mutation,
        mutatingAliasId: action.aliasId,
        errorCode: '',
        errorMessage: '',
      }
      break
    case 'mutation-success':
      next = {
        ...current,
        workspace: action.workspace,
        mutation: null,
        mutatingAliasId: '',
        reconnectRequired:
          current.reconnectRequired || action.applyStatus === 'reconnect_required',
        errorCode: '',
        errorMessage: '',
      }
      break
    case 'mutation-error':
      next = {
        ...current,
        mutation: null,
        mutatingAliasId: '',
        errorCode: action.errorCode,
        errorMessage: action.errorMessage,
      }
      break
    case 'retire':
      next = {
        ...current,
        requestSequence: action.sequence,
        loading: false,
        refreshing: false,
        mutation: null,
        mutatingAliasId: '',
      }
      break
  }
  return { ...states, [action.sessionId]: next }
}

export function retainAliasSessionStates(
  states: AliasSessionViewStates,
  retainedSessionIds: ReadonlySet<string>,
): AliasSessionViewStates {
  const entries = Object.entries(states).filter(([sessionId]) =>
    retainedSessionIds.has(sessionId))
  if (entries.length === Object.keys(states).length) {
    return states
  }
  return Object.fromEntries(entries)
}

export function isCurrentAliasOperation<T extends object>(current: T | null, completed: T) {
  return current === completed
}

export function filterShellAliases(items: ShellAlias[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) {
    return items
  }
  return items.filter((item) =>
    [item.name, item.command, item.description]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery)),
  )
}

export function buildShellAliasPatch(
  current: ShellAlias,
  next: ShellAliasInput,
): ShellAliasPatch {
  const patch: ShellAliasPatch = {}
  if (next.name !== current.name) {
    patch.name = next.name
  }
  if (next.command !== current.command) {
    patch.command = next.command
  }
  if (next.description !== (current.description ?? '')) {
    patch.description = next.description
  }
  if (next.enabled !== current.enabled) {
    patch.enabled = next.enabled
  }
  return patch
}

export function shellAliasTone(alias: ShellAlias): 'ready' | 'muted' {
  return alias.enabled ? 'ready' : 'muted'
}

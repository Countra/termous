import {
  agentSlashCommandIds,
  type AgentSlashCandidate,
  type AgentSlashCandidateCatalog,
  type AgentSlashCommandId,
  type AgentSlashResourceKind,
} from '#entities/agent'

export interface AgentSlashCapture {
  owner: string
  start: number
  end: number
  raw_fragment: string
}

export interface AgentSlashParseResult {
  query: string
  exact_command_id?: AgentSlashCommandId
  matching_command_ids: AgentSlashCommandId[]
  capture: AgentSlashCapture
}

export type AgentSlashMenuState =
  | { level: 'closed' }
  | {
      level: 'root'
      capture: AgentSlashCapture
      query: string
      matching_command_ids: AgentSlashCommandId[]
      active_id?: AgentSlashCommandId
    }
  | {
      level: 'kind'
      capture: AgentSlashCapture
      command_id: Exclude<AgentSlashCommandId, 'compact'>
      active_id?: AgentSlashResourceKind
    }
  | {
      level: 'resource'
      capture: AgentSlashCapture
      command_id: Exclude<AgentSlashCommandId, 'compact'>
      resource_kind: AgentSlashResourceKind
      query: string
      active_id?: string
    }

export type AgentSlashMenuAction =
  | { type: 'close' }
  | { type: 'open'; parsed: AgentSlashParseResult; active_id?: AgentSlashCommandId }
  | { type: 'sync_root'; parsed: AgentSlashParseResult; active_id?: AgentSlashCommandId }
  | { type: 'set_active'; active_id?: string }
  | { type: 'open_kind'; command_id: Exclude<AgentSlashCommandId, 'compact'>; active_id?: AgentSlashResourceKind }
  | { type: 'open_resource'; resource_kind: AgentSlashResourceKind; active_id?: string }
  | { type: 'search'; query: string; active_id?: string }
  | { type: 'back'; active_id?: string }

export function parseAgentSlashInput(value: string, owner: string): AgentSlashParseResult | null {
  const match = /^\/([a-z]*)/.exec(value)
  if (!match) return null
  const query = match[1]!
  const tokenEnd = match[0].length
  const separator = value.slice(tokenEnd, tokenEnd + 2)
  const nextCharacter = value[tokenEnd]
  const hasAllowedBoundary = nextCharacter === undefined
    || nextCharacter === ' '
    || nextCharacter === '\n'
    || separator === '\r\n'
  if (!hasAllowedBoundary) return null

  const matchingCommandIds = agentSlashCommandIds.filter((commandId) => commandId.startsWith(query))
  if (matchingCommandIds.length === 0) return null
  const exactCommandId = agentSlashCommandIds.find((commandId) => commandId === query)
  if (nextCharacter !== undefined && !exactCommandId) return null

  let end = tokenEnd
  if (separator === '\r\n') end += 2
  else if (nextCharacter === ' ' || nextCharacter === '\n') end += 1
  return {
    query,
    exact_command_id: exactCommandId,
    matching_command_ids: [...matchingCommandIds],
    capture: { owner, start: 0, end, raw_fragment: value.slice(0, end) },
  }
}

export function isAgentSlashInsertTextActivation({
  value,
  owner,
  start,
  end,
  data,
  inputType,
  isComposing,
}: {
  value: string
  owner: string
  start: number
  end: number
  data: string | null
  inputType: string
  isComposing: boolean
}) {
  if (inputType !== 'insertText' || isComposing || data !== '/' || start !== 0) return false
  const nextValue = value.slice(0, start) + data + value.slice(end)
  const parsed = parseAgentSlashInput(nextValue, owner)
  return Boolean(parsed)
}

export function agentSlashMenuReducer(
  state: AgentSlashMenuState,
  action: AgentSlashMenuAction,
): AgentSlashMenuState {
  switch (action.type) {
    case 'close':
      return { level: 'closed' }
    case 'open':
    case 'sync_root':
      return {
        level: 'root',
        capture: action.parsed.capture,
        query: action.parsed.query,
        matching_command_ids: action.parsed.matching_command_ids,
        active_id: action.active_id,
      }
    case 'set_active':
      if (state.level === 'closed') return state
      if (state.level === 'root') return { ...state, active_id: action.active_id as AgentSlashCommandId | undefined }
      if (state.level === 'kind') return { ...state, active_id: action.active_id as AgentSlashResourceKind | undefined }
      return { ...state, active_id: action.active_id }
    case 'open_kind':
      if (state.level !== 'root') return state
      return {
        level: 'kind',
        capture: state.capture,
        command_id: action.command_id,
        active_id: action.active_id,
      }
    case 'open_resource':
      if (state.level !== 'kind') return state
      return {
        level: 'resource',
        capture: state.capture,
        command_id: state.command_id,
        resource_kind: action.resource_kind,
        query: '',
        active_id: action.active_id,
      }
    case 'search':
      if (state.level !== 'resource') return state
      return { ...state, query: action.query, active_id: action.active_id }
    case 'back':
      if (state.level === 'resource') {
        return {
          level: 'kind',
          capture: state.capture,
          command_id: state.command_id,
          active_id: action.active_id as AgentSlashResourceKind | undefined,
        }
      }
      if (state.level === 'kind') {
        const parsed = parseAgentSlashInput(state.capture.raw_fragment, state.capture.owner)
        return {
          level: 'root',
          capture: state.capture,
          query: parsed?.query ?? state.command_id,
          matching_command_ids: parsed?.matching_command_ids ?? [state.command_id],
          active_id: state.command_id,
        }
      }
      return { level: 'closed' }
  }
}

export function agentSlashCandidates(
  catalog: AgentSlashCandidateCatalog,
  commandId: Exclude<AgentSlashCommandId, 'compact'>,
  resourceKind: AgentSlashResourceKind,
): AgentSlashCandidate[] {
  return catalog[commandId][resourceKind]
}

export function filterAgentSlashCandidates(
  candidates: readonly AgentSlashCandidate[],
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return [...candidates]
  return candidates.filter((candidate) => candidateSearchText(candidate).includes(normalizedQuery))
}

export function moveAgentSlashActiveId(
  selectableIds: readonly string[],
  activeId: string | undefined,
  direction: 'next' | 'previous' | 'first' | 'last',
) {
  if (selectableIds.length === 0) return undefined
  if (direction === 'first') return selectableIds[0]
  if (direction === 'last') return selectableIds[selectableIds.length - 1]
  const currentIndex = selectableIds.indexOf(activeId ?? '')
  if (currentIndex < 0) return direction === 'next' ? selectableIds[0] : selectableIds[selectableIds.length - 1]
  const offset = direction === 'next' ? 1 : -1
  return selectableIds[(currentIndex + offset + selectableIds.length) % selectableIds.length]
}

export function agentSlashMenuAvailableHeight(anchorTop: number, workspaceTop: number) {
  const topBoundary = Math.max(12, workspaceTop + 12)
  return Math.max(0, Math.min(360, Math.floor(anchorTop - topBoundary - 8)))
}

export function consumeAgentSlashCapture(value: string, owner: string, capture: AgentSlashCapture) {
  if (capture.owner !== owner || value.slice(capture.start, capture.end) !== capture.raw_fragment) return null
  return value.slice(0, capture.start) + value.slice(capture.end)
}

function candidateSearchText(candidate: AgentSlashCandidate) {
  const identity = candidate.kind === 'ssh_session'
    ? candidate.session_id
    : candidate.kind === 'file_session'
      ? candidate.representative_session_id
      : candidate.profile_id
  return [candidate.host_name, candidate.profile_name, candidate.id, candidate.profile_id, identity]
    .join('\n')
    .toLocaleLowerCase()
}

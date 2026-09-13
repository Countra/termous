import {
  agentSlashResourceKinds,
  type AgentSlashCandidate,
  type AgentSlashCandidateCatalog,
  type AgentSlashCommandId,
  type AgentSlashResourceKind,
} from '#entities/agent'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import type {
  AgentWorkspaceSlashAvailability,
  AgentWorkspaceSlashExecution,
} from './types.ts'
import {
  agentSlashCandidates,
  agentSlashMenuReducer,
  consumeAgentSlashCapture,
  filterAgentSlashCandidates,
  isAgentSlashInsertTextActivation,
  moveAgentSlashActiveId,
  parseAgentSlashInput,
  type AgentSlashMenuState,
} from './agentSlashCommands.ts'

const emptyCatalog: AgentSlashCandidateCatalog = {
  session: { ssh: [], file: [] },
  profile: { ssh: [], file: [] },
}

export function useAgentSlashCommands({
  value,
  owner,
  editing,
  active = true,
  containerRef,
  catalog = emptyCatalog,
  availability,
  onChange,
  onExecute,
}: {
  value: string
  owner: string
  editing: boolean
  active?: boolean
  containerRef: RefObject<HTMLElement | null>
  catalog?: AgentSlashCandidateCatalog
  availability?: AgentWorkspaceSlashAvailability
  onChange: (value: string) => void
  onExecute?: (execution: AgentWorkspaceSlashExecution) => Promise<boolean>
}) {
  const [state, dispatch] = useReducer(agentSlashMenuReducer, { level: 'closed' })
  const [executing, setExecuting] = useState(false)
  const executingRef = useRef(false)
  const stateRef = useRef<AgentSlashMenuState>(state)
  const valueRef = useRef(value)
  const ownerRef = useRef(owner)
  const acceptedValueRef = useRef(value)
  const activationRef = useRef(false)
  const restoreFocusRef = useRef(false)
  const executionSequenceRef = useRef(0)
  const enabled = Boolean(availability && onExecute) && !editing && active
  const menuId = `agent-slash-${useId().replace(/:/g, '')}`
  stateRef.current = state
  valueRef.current = value
  ownerRef.current = owner

  const close = useCallback((restoreFocus = false) => {
    activationRef.current = false
    restoreFocusRef.current = restoreFocus
    dispatch({ type: 'close' })
  }, [])

  useEffect(() => {
    if (value === acceptedValueRef.current) return
    acceptedValueRef.current = value
    close()
  }, [close, value])

  useEffect(() => {
    acceptedValueRef.current = valueRef.current
    executionSequenceRef.current += 1
    executingRef.current = false
    setExecuting(false)
    close()
  }, [active, close, editing, owner])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [close, containerRef])

  const rootCommandIds = state.level === 'root' ? state.matching_command_ids : []
  const resourceCandidates = useMemo(() => {
    if (state.level !== 'resource') return []
    return filterAgentSlashCandidates(
      agentSlashCandidates(catalog, state.command_id, state.resource_kind),
      state.query,
    )
  }, [catalog, state])

  useEffect(() => {
    if (state.level === 'root') {
      const visible = state.matching_command_ids
      if (visible.includes(state.active_id as AgentSlashCommandId)) return
      const activeId = initialCommandId(visible, availability)
      if (activeId !== state.active_id) dispatch({ type: 'set_active', active_id: activeId })
      return
    }
    if (state.level === 'kind') {
      if (state.active_id && agentSlashResourceKinds.includes(state.active_id)
        && resourceKindAvailability(availability, state.command_id, state.active_id).enabled) return
      const activeId = initialResourceKind(state.command_id, availability)
      if (activeId !== state.active_id) dispatch({ type: 'set_active', active_id: activeId })
      return
    }
    if (state.level !== 'resource') return
    if (resourceCandidates.some(({ id }) => id === state.active_id)) return
    const activeId = initialCandidateId(resourceCandidates)
    if (activeId !== state.active_id) dispatch({ type: 'set_active', active_id: activeId })
  }, [availability, resourceCandidates, state])

  const onNativeBeforeInput = useCallback((event: InputEvent) => {
    activationRef.current = false
    if (!enabled || executingRef.current) return
    if (!(event.target instanceof HTMLTextAreaElement)) return
    const textarea = event.target
    if (event.inputType !== 'insertText' || event.isComposing || event.data == null) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    activationRef.current = isAgentSlashInsertTextActivation({
      value: textarea.value,
      owner: ownerRef.current,
      start,
      end,
      data: event.data,
      inputType: event.inputType,
      isComposing: event.isComposing,
    })
  }, [enabled])

  const onInputValueChange = useCallback((nextValue: string) => {
    valueRef.current = nextValue
    acceptedValueRef.current = nextValue
    const currentState = stateRef.current
    const parsed = parseAgentSlashInput(nextValue, ownerRef.current)
    if (currentState.level === 'root') {
      if (!parsed) close()
      else dispatch({
        type: 'sync_root',
        parsed,
        active_id: initialCommandId(parsed.matching_command_ids, availability),
      })
    } else if (currentState.level === 'closed' && activationRef.current && parsed) {
      dispatch({
        type: 'open',
        parsed,
        active_id: initialCommandId(parsed.matching_command_ids, availability),
      })
    } else if (currentState.level !== 'closed') close()
    activationRef.current = false
    onChange(nextValue)
  }, [availability, close, onChange])

  const execute = useCallback(async (
    commandId: AgentSlashCommandId,
    resourceKind?: AgentSlashResourceKind,
    candidate?: AgentSlashCandidate,
  ) => {
    const currentState = stateRef.current
    if (executingRef.current || !onExecute || currentState.level === 'closed') return
    const commandAvailability = availability?.[commandId]
    const kindAvailability = resourceKind
      ? resourceKindAvailability(availability, commandId, resourceKind)
      : undefined
    if (!commandAvailability?.enabled || kindAvailability?.enabled === false || candidate?.disabled_reason) return
    const capture = currentState.capture
    const ownerAtStart = ownerRef.current
    const sequence = executionSequenceRef.current + 1
    executionSequenceRef.current = sequence
    executingRef.current = true
    setExecuting(true)
    let accepted: boolean
    try {
      accepted = await onExecute({
        command_id: commandId,
        resource_kind: resourceKind,
        candidate,
        capture,
      })
    } catch {
      accepted = false
    }
    if (sequence !== executionSequenceRef.current) return
    executingRef.current = false
    setExecuting(false)
    if (!accepted) return
    const nextValue = consumeAgentSlashCapture(valueRef.current, ownerRef.current, capture)
    if (nextValue == null || ownerRef.current !== ownerAtStart) {
      close()
      return
    }
    close(true)
    valueRef.current = nextValue
    acceptedValueRef.current = nextValue
    onChange(nextValue)
  }, [availability, close, onChange, onExecute])

  const confirmRoot = useCallback(() => {
    const currentState = stateRef.current
    if (currentState.level !== 'root' || !currentState.active_id) return
    const commandId = currentState.active_id
    if (!availability?.[commandId]?.enabled) return
    if (commandId === 'compact') {
      void execute(commandId)
      return
    }
    dispatch({ type: 'open_kind', command_id: commandId, active_id: initialResourceKind(commandId, availability) })
  }, [availability, execute])

  const confirmKind = useCallback(() => {
    const currentState = stateRef.current
    if (currentState.level !== 'kind' || !currentState.active_id) return
    if (!resourceKindAvailability(availability, currentState.command_id, currentState.active_id).enabled) return
    const candidates = agentSlashCandidates(catalog, currentState.command_id, currentState.active_id)
    dispatch({
      type: 'open_resource',
      resource_kind: currentState.active_id,
      active_id: initialCandidateId(candidates),
    })
  }, [availability, catalog])

  const confirmResource = useCallback(() => {
    const currentState = stateRef.current
    if (currentState.level !== 'resource' || !currentState.active_id) return
    const candidate = resourceCandidates.find(({ id }) => id === currentState.active_id)
    if (!candidate || candidate.disabled_reason) return
    void execute(currentState.command_id, currentState.resource_kind, candidate)
  }, [execute, resourceCandidates])

  const move = useCallback((direction: 'next' | 'previous' | 'first' | 'last') => {
    const currentState = stateRef.current
    if (currentState.level === 'closed') return
    let ids: string[]
    if (currentState.level === 'root') {
      ids = currentState.matching_command_ids.filter((commandId) => availability?.[commandId]?.enabled)
    } else if (currentState.level === 'kind') {
      ids = agentSlashResourceKinds.filter((kind) => (
        resourceKindAvailability(availability, currentState.command_id, kind).enabled
      ))
    } else {
      ids = resourceCandidates.filter(({ disabled_reason: reason }) => !reason).map(({ id }) => id)
    }
    dispatch({
      type: 'set_active',
      active_id: moveAgentSlashActiveId(ids, currentState.active_id, direction),
    })
  }, [availability, resourceCandidates])

  const onTextareaKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (stateRef.current.level !== 'root' || isModifiedOrComposing(event)) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return true
    }
    const direction = keyDirection(event.key)
    if (direction) {
      event.preventDefault()
      move(direction)
      return true
    }
    if (event.key !== 'Enter' || event.shiftKey) return false
    event.preventDefault()
    confirmRoot()
    return true
  }, [close, confirmRoot, move])

  const onMenuKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (stateRef.current.level === 'closed' || isModifiedOrComposing(event)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      dispatch({ type: 'back', active_id: backActiveId(stateRef.current) })
      return
    }
    const direction = keyDirection(event.key)
    if (direction) {
      event.preventDefault()
      move(direction)
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (stateRef.current.level === 'kind') confirmKind()
    else if (stateRef.current.level === 'resource') confirmResource()
  }, [confirmKind, confirmResource, move])

  const onSelectCommand = useCallback((commandId: AgentSlashCommandId) => {
    dispatch({ type: 'set_active', active_id: commandId })
    const commandAvailability = availability?.[commandId]
    if (!commandAvailability?.enabled) return
    if (commandId === 'compact') void execute(commandId)
    else dispatch({
      type: 'open_kind',
      command_id: commandId,
      active_id: initialResourceKind(commandId, availability),
    })
  }, [availability, execute])

  const onSelectKind = useCallback((resourceKind: AgentSlashResourceKind) => {
    const currentState = stateRef.current
    if (currentState.level !== 'kind') return
    if (!resourceKindAvailability(availability, currentState.command_id, resourceKind).enabled) return
    dispatch({ type: 'set_active', active_id: resourceKind })
    const candidates = agentSlashCandidates(catalog, currentState.command_id, resourceKind)
    dispatch({ type: 'open_resource', resource_kind: resourceKind, active_id: initialCandidateId(candidates) })
  }, [availability, catalog])

  const onSelectCandidate = useCallback((candidate: AgentSlashCandidate) => {
    const currentState = stateRef.current
    if (currentState.level !== 'resource' || candidate.disabled_reason) return
    dispatch({ type: 'set_active', active_id: candidate.id })
    void execute(currentState.command_id, currentState.resource_kind, candidate)
  }, [execute])

  const onSearch = useCallback((query: string) => {
    const currentState = stateRef.current
    if (currentState.level !== 'resource') return
    const filtered = filterAgentSlashCandidates(
      agentSlashCandidates(catalog, currentState.command_id, currentState.resource_kind),
      query,
    )
    dispatch({ type: 'search', query, active_id: initialCandidateId(filtered) })
  }, [catalog])

  const back = useCallback(() => {
    const currentState = stateRef.current
    if (currentState.level === 'closed') return
    dispatch({ type: 'back', active_id: backActiveId(currentState) })
  }, [])

  const suppressActivation = useCallback(() => {
    activationRef.current = false
    close()
  }, [close])

  const takeFocusRestore = useCallback(() => {
    const restore = restoreFocusRef.current
    restoreFocusRef.current = false
    return restore
  }, [])

  const activeOptionId = state.level === 'closed' || !state.active_id
    ? undefined
    : agentSlashOptionId(menuId, state.level, state.active_id)

  return {
    state,
    executing,
    menuId,
    activeOptionId,
    rootCommandIds,
    resourceCandidates,
    availability,
    onNativeBeforeInput,
    onInputValueChange,
    onTextareaKeyDown,
    onMenuKeyDown,
    onSelectCommand,
    onSelectKind,
    onSelectCandidate,
    onSearch,
    onSetActive: (activeId: string) => dispatch({ type: 'set_active', active_id: activeId }),
    resourceKindAvailability: (commandId: Exclude<AgentSlashCommandId, 'compact'>, resourceKind: AgentSlashResourceKind) => (
      resourceKindAvailability(availability, commandId, resourceKind)
    ),
    takeFocusRestore,
    back,
    close,
    suppressActivation,
  }
}

export type AgentSlashCommandController = ReturnType<typeof useAgentSlashCommands>

function initialCommandId(
  commandIds: readonly AgentSlashCommandId[],
  availability: AgentWorkspaceSlashAvailability | undefined,
) {
  return commandIds.find((commandId) => availability?.[commandId]?.enabled) ?? commandIds[0]
}

function initialCandidateId(candidates: readonly AgentSlashCandidate[]) {
  return candidates.find(({ disabled_reason: reason }) => !reason)?.id ?? candidates[0]?.id
}

function initialResourceKind(
  commandId: Exclude<AgentSlashCommandId, 'compact'>,
  availability: AgentWorkspaceSlashAvailability | undefined,
) {
  return agentSlashResourceKinds.find((kind) => resourceKindAvailability(availability, commandId, kind).enabled)
    ?? agentSlashResourceKinds[0]
}

function resourceKindAvailability(
  availability: AgentWorkspaceSlashAvailability | undefined,
  commandId: AgentSlashCommandId,
  resourceKind: AgentSlashResourceKind,
) {
  return availability?.[commandId]?.resource_kinds?.[resourceKind]
    ?? availability?.[commandId]
    ?? { enabled: false }
}

function keyDirection(key: string) {
  if (key === 'ArrowDown') return 'next' as const
  if (key === 'ArrowUp') return 'previous' as const
  if (key === 'Home') return 'first' as const
  if (key === 'End') return 'last' as const
  return undefined
}

function isModifiedOrComposing(event: KeyboardEvent<HTMLElement>) {
  return event.nativeEvent.isComposing
    || event.nativeEvent.keyCode === 229
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
}

function backActiveId(state: Exclude<AgentSlashMenuState, { level: 'closed' }>) {
  if (state.level === 'resource') return state.resource_kind
  if (state.level === 'kind') return state.command_id
  return undefined
}

export function agentSlashOptionId(menuId: string, level: string, id: string) {
  return `${menuId}-${level}-${id}`.replace(/[^a-zA-Z0-9_-]/g, '-')
}

import type {
  CompletionItem,
  CompletionProviderState,
  CompletionQuery,
  CompletionResult,
} from '../../types/domain'
import {
  applyTerminalCompletionData,
  applyTerminalCompletionPaste,
  applyTerminalCompletionProgrammaticInput,
  beginTerminalCompletionComposition,
  createTerminalCompletionInputState,
  endTerminalCompletionComposition,
  insertTerminalCompletionText,
  invalidateTerminalCompletionInput,
  resetTerminalCompletionInput,
  type TerminalCompletionInputDisposition,
  type TerminalCompletionInputState,
} from './terminalCompletionInput.ts'
import type { TerminalPromptBoundary } from './terminalProtocol'
import type { TerminalTransportState } from './terminalTransport'

export type TerminalCompletionReadiness =
  | 'disabled'
  | 'waiting_prompt'
  | 'ready'
  | 'unavailable'

export type TerminalCompletionQueryState =
  | 'idle'
  | 'debouncing'
  | 'loading'
  | 'ready'
  | 'error'

export interface TerminalCompletionSessionSnapshot {
  sessionId: string
  readiness: TerminalCompletionReadiness
  boundary: TerminalPromptBoundary | null
  input: TerminalCompletionInputState
  queryState: TerminalCompletionQueryState
  items: readonly CompletionItem[]
  selectedIndex: number
  isIncomplete: boolean
  indexGeneration: number
  providerStates: readonly CompletionProviderState[]
  errorCode?: string
}

export interface TerminalCompletionAcceptance {
  item: CompletionItem
  text: string
  inputRevision: number
}

export type TerminalCompletionQueryExecutor = (
  sessionId: string,
  query: CompletionQuery,
  signal: AbortSignal,
) => Promise<CompletionResult>

export interface TerminalCompletionRuntimeOptions {
  debounceMs?: number
  incompleteRetryMs?: number
  maximumIncompleteRetries?: number
  maximumItems?: number
  query?: TerminalCompletionQueryExecutor
  requestId?: () => string
  schedule?: (callback: () => void, delayMs: number) => () => void
}

interface BoundaryFloor {
  sourceGeneration: number
  minimumInputEpoch: number
}

interface TerminalCompletionSessionState {
  sessionId: string
  readiness: Exclude<TerminalCompletionReadiness, 'disabled'>
  boundary: TerminalPromptBoundary | null
  input: TerminalCompletionInputState
  queryState: TerminalCompletionQueryState
  items: CompletionItem[]
  selectedIndex: number
  isIncomplete: boolean
  indexGeneration: number
  providerStates: CompletionProviderState[]
  errorCode?: string
  alternateScreen: boolean
  querySequence: number
  incompleteRetries: number
  cancelScheduledQuery?: () => void
  queryAbort?: AbortController
  boundaryFloor?: BoundaryFloor
  unanchoredInput: boolean
  suppressedInputRevision?: number
  snapshot: TerminalCompletionSessionSnapshot
}

const defaultDebounceMs = 100
const defaultIncompleteRetryMs = 500
const defaultMaximumIncompleteRetries = 3
const defaultMaximumItems = 20
const maximumQueryBytes = 4 * 1024
const terminalCompletionTextEncoder = new TextEncoder()

export class TerminalCompletionRuntime {
  private enabled: boolean
  private queryExecutor?: TerminalCompletionQueryExecutor
  private readonly debounceMs: number
  private readonly incompleteRetryMs: number
  private readonly maximumIncompleteRetries: number
  private readonly maximumItems: number
  private readonly requestId: () => string
  private readonly schedule: (callback: () => void, delayMs: number) => () => void
  private readonly sessions = new Map<string, TerminalCompletionSessionState>()
  private readonly fallbackSnapshots = new Map<string, TerminalCompletionSessionSnapshot>()
  private readonly fallbackReadiness = new Map<
    string,
    Exclude<TerminalCompletionReadiness, 'disabled'>
  >()
  private readonly subscribers = new Map<string, Set<() => void>>()

  constructor(enabled = true, options: TerminalCompletionRuntimeOptions = {}) {
    this.enabled = enabled
    this.queryExecutor = options.query
    this.debounceMs = normalizeDelay(options.debounceMs, defaultDebounceMs)
    this.incompleteRetryMs = normalizeDelay(
      options.incompleteRetryMs,
      defaultIncompleteRetryMs,
    )
    this.maximumIncompleteRetries = normalizeCount(
      options.maximumIncompleteRetries,
      defaultMaximumIncompleteRetries,
    )
    this.maximumItems = Math.min(
      defaultMaximumItems,
      normalizePositiveCount(options.maximumItems, defaultMaximumItems),
    )
    this.requestId = options.requestId ?? createRequestId
    this.schedule = options.schedule ?? scheduleWithTimeout
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) {
      return
    }
    this.enabled = enabled
    for (const sessionId of this.fallbackSnapshots.keys()) {
      this.fallbackSnapshots.set(
        sessionId,
        createFallbackSnapshot(
          sessionId,
          enabled,
          this.fallbackReadiness.get(sessionId) ?? 'waiting_prompt',
        ),
      )
    }
    for (const state of this.sessions.values()) {
      this.cancelQuery(state)
      this.clearQueryResult(state)
      this.publish(state)
      if (enabled) {
        this.scheduleTypingQuery(state)
      }
    }
  }

  setQueryExecutor(query?: TerminalCompletionQueryExecutor | null) {
    const nextQuery = query ?? undefined
    if (this.queryExecutor === nextQuery) {
      return
    }
    this.queryExecutor = nextQuery
    for (const state of this.sessions.values()) {
      this.cancelQuery(state)
      this.clearQueryResult(state)
      this.publish(state)
      this.scheduleTypingQuery(state)
    }
  }

  subscribe(sessionId: string, listener: () => void) {
    const listeners = this.subscribers.get(sessionId) ?? new Set<() => void>()
    listeners.add(listener)
    this.subscribers.set(sessionId, listeners)
    return () => {
      const current = this.subscribers.get(sessionId)
      current?.delete(listener)
      if (current?.size === 0) {
        this.subscribers.delete(sessionId)
        if (!this.sessions.has(sessionId)) {
          this.fallbackSnapshots.delete(sessionId)
          this.fallbackReadiness.delete(sessionId)
        }
      }
    }
  }

  applyTransportState(sessionId: string, transportState: TerminalTransportState) {
    if (transportState === 'disposed' || transportState === 'ended') {
      this.disposeSession(sessionId)
      return
    }
    const state = this.ensureSession(sessionId)
    if (transportState === 'live') {
      if (state.readiness === 'unavailable') {
        state.readiness = 'waiting_prompt'
        this.publish(state)
      }
      return
    }
    const readiness = transportState === 'idle' ? 'waiting_prompt' : 'unavailable'
    this.resetSessionTrust(state, readiness)
  }

  applyPromptBoundary(sessionId: string, boundary: TerminalPromptBoundary) {
    const state = this.ensureSession(sessionId)
    if (state.boundary && !canAdvanceBoundary(state.boundary, boundary)) {
      return false
    }
    if (state.unanchoredInput) {
      state.unanchoredInput = false
      state.boundaryFloor = {
        sourceGeneration: boundary.source_generation,
        minimumInputEpoch: boundary.input_epoch + 1,
      }
      return false
    }
    if (!satisfiesBoundaryFloor(state.boundaryFloor, boundary)) {
      return false
    }
    if (state.boundary && sameBoundary(state.boundary, boundary)) {
      if (state.readiness !== 'ready') {
        state.readiness = 'ready'
        this.publish(state)
        return true
      }
      return false
    }

    this.cancelQuery(state)
    state.readiness = 'ready'
    state.boundary = { ...boundary }
    state.input = resetTerminalCompletionInput(state.input, 'trusted')
    state.alternateScreen = false
    state.boundaryFloor = undefined
    state.unanchoredInput = false
    state.suppressedInputRevision = undefined
    state.incompleteRetries = 0
    this.clearQueryResult(state)
    this.publish(state)
    return true
  }

  applyUserData(sessionId: string, data: string): TerminalCompletionInputDisposition {
    const state = this.ensureSession(sessionId)
    const update = applyTerminalCompletionData(state.input, data)
    return this.applyInputUpdate(state, update.state, update.disposition)
  }

  applyPaste(sessionId: string, text: string): TerminalCompletionInputDisposition {
    const state = this.ensureSession(sessionId)
    const update = applyTerminalCompletionPaste(state.input, text)
    return this.applyInputUpdate(state, update.state, update.disposition)
  }

  applyProgrammaticInput(
    sessionId: string,
    text: string,
    options: { execute?: boolean } = {},
  ): TerminalCompletionInputDisposition {
    const state = this.ensureSession(sessionId)
    const update = applyTerminalCompletionProgrammaticInput(
      state.input,
      text,
      options.execute === true,
    )
    return this.applyInputUpdate(state, update.state, update.disposition)
  }

  applyBinaryInput(sessionId: string) {
    this.markUncertain(sessionId)
  }

  startComposition(sessionId: string) {
    const state = this.ensureSession(sessionId)
    const input = beginTerminalCompletionComposition(state.input)
    if (input === state.input) {
      return
    }
    this.cancelQuery(state)
    state.input = input
    this.clearQueryResult(state)
    this.publish(state)
  }

  endComposition(sessionId: string) {
    const state = this.ensureSession(sessionId)
    const input = endTerminalCompletionComposition(state.input)
    if (input === state.input) {
      return
    }
    state.input = input
    this.publish(state)
    this.scheduleTypingQuery(state)
  }

  setAlternateScreen(sessionId: string, active: boolean) {
    const state = this.ensureSession(sessionId)
    if (state.alternateScreen === active) {
      return
    }
    state.alternateScreen = active
    this.markStateUncertain(state)
  }

  markUncertain(sessionId: string) {
    this.markStateUncertain(this.ensureSession(sessionId))
  }

  invalidateSession(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) {
      return
    }
    this.resetSessionTrust(state, 'unavailable')
  }

  closeSuggestions(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) {
      return
    }
    this.cancelQuery(state)
    state.suppressedInputRevision = state.input.revision
    this.clearQueryResult(state)
    this.publish(state)
  }

  moveSelection(sessionId: string, delta: number) {
    const state = this.sessions.get(sessionId)
    if (!state || state.items.length === 0 || !Number.isFinite(delta)) {
      return false
    }
    const current = state.selectedIndex >= 0 ? state.selectedIndex : 0
    state.selectedIndex = modulo(current + Math.trunc(delta), state.items.length)
    this.publish(state)
    return true
  }

  selectIndex(sessionId: string, index: number) {
    const state = this.sessions.get(sessionId)
    if (
      !state
      || !Number.isSafeInteger(index)
      || index < 0
      || index >= state.items.length
      || index === state.selectedIndex
    ) {
      return false
    }
    state.selectedIndex = index
    this.publish(state)
    return true
  }

  acceptSelection(sessionId: string): TerminalCompletionAcceptance | null {
    const state = this.sessions.get(sessionId)
    if (!state || state.input.trust !== 'trusted' || state.input.composing) {
      return null
    }
    const item = state.items[state.selectedIndex]
    const appendText = item ? appendTextForCandidate(state.input, item) : null
    if (!item || appendText === null || appendText.length === 0) {
      return null
    }

    this.cancelQuery(state)
    state.input = insertTerminalCompletionText(state.input, appendText)
    this.clearQueryResult(state)
    state.suppressedInputRevision = state.input.revision
    this.publish(state)
    if (item.kind === 'directory' && item.insert_text.endsWith('/')) {
      state.suppressedInputRevision = undefined
      this.scheduleTypingQuery(state)
    }
    return {
      item,
      text: appendText,
      inputRevision: state.input.revision,
    }
  }

  getSnapshot(sessionId: string): TerminalCompletionSessionSnapshot {
    return this.sessions.get(sessionId)?.snapshot ?? this.getFallbackSnapshot(sessionId)
  }

  disposeSession(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) {
      return
    }
    this.cancelQuery(state)
    this.sessions.delete(sessionId)
    if (this.subscribers.has(sessionId)) {
      this.fallbackReadiness.set(sessionId, 'unavailable')
      this.fallbackSnapshots.set(
        sessionId,
        createFallbackSnapshot(sessionId, this.enabled, 'unavailable'),
      )
    } else {
      this.fallbackReadiness.delete(sessionId)
      this.fallbackSnapshots.delete(sessionId)
    }
    this.notify(sessionId)
  }

  clear() {
    const sessionIds = [...this.sessions.keys()]
    for (const state of this.sessions.values()) {
      this.cancelQuery(state)
      if (this.subscribers.has(state.sessionId)) {
        this.fallbackReadiness.set(state.sessionId, 'unavailable')
        this.fallbackSnapshots.set(
          state.sessionId,
          createFallbackSnapshot(state.sessionId, this.enabled, 'unavailable'),
        )
      }
    }
    this.sessions.clear()
    for (const sessionId of sessionIds) {
      this.notify(sessionId)
    }
  }

  private applyInputUpdate(
    state: TerminalCompletionSessionState,
    input: TerminalCompletionInputState,
    disposition: TerminalCompletionInputDisposition,
  ) {
    if (input === state.input) {
      return disposition
    }
    this.cancelQuery(state)
    state.input = input
    state.suppressedInputRevision = undefined
    state.incompleteRetries = 0
    this.clearQueryResult(state)
    if (disposition === 'invalidated') {
      this.raiseBoundaryFloor(state)
    }
    this.publish(state)
    if (disposition === 'tracked') {
      this.scheduleTypingQuery(state)
    }
    return disposition
  }

  private markStateUncertain(state: TerminalCompletionSessionState) {
    this.cancelQuery(state)
    this.raiseBoundaryFloor(state)
    const input = invalidateTerminalCompletionInput(state.input)
    const changed = input !== state.input || state.items.length > 0 || state.queryState !== 'idle'
    state.input = input
    state.suppressedInputRevision = undefined
    state.incompleteRetries = 0
    this.clearQueryResult(state)
    if (changed) {
      this.publish(state)
    }
  }

  private resetSessionTrust(
    state: TerminalCompletionSessionState,
    readiness: Exclude<TerminalCompletionReadiness, 'disabled'>,
  ) {
    this.cancelQuery(state)
    state.readiness = readiness
    state.boundary = null
    state.input = resetTerminalCompletionInput(state.input, 'waiting_prompt')
    state.alternateScreen = false
    state.boundaryFloor = undefined
    state.unanchoredInput = false
    state.suppressedInputRevision = undefined
    state.incompleteRetries = 0
    this.clearQueryResult(state)
    this.publish(state)
  }

  private raiseBoundaryFloor(state: TerminalCompletionSessionState) {
    const boundary = state.boundary
    if (!boundary) {
      state.unanchoredInput = true
      return
    }
    const minimumInputEpoch = boundary.input_epoch + 1
    if (
      !state.boundaryFloor
      || state.boundaryFloor.sourceGeneration !== boundary.source_generation
      || state.boundaryFloor.minimumInputEpoch < minimumInputEpoch
    ) {
      state.boundaryFloor = {
        sourceGeneration: boundary.source_generation,
        minimumInputEpoch,
      }
    }
  }

  private scheduleTypingQuery(state: TerminalCompletionSessionState) {
    if (!this.canQuery(state) || state.suppressedInputRevision === state.input.revision) {
      return
    }
    this.cancelQuery(state)
    this.clearQueryResult(state)
    state.queryState = 'debouncing'
    const sequence = ++state.querySequence
    state.cancelScheduledQuery = this.schedule(() => {
      state.cancelScheduledQuery = undefined
      void this.executeQuery(state, sequence)
    }, this.debounceMs)
    this.publish(state)
  }

  private scheduleIncompleteRetry(state: TerminalCompletionSessionState) {
    if (
      !this.canQuery(state)
      || state.incompleteRetries >= this.maximumIncompleteRetries
    ) {
      return
    }
    const retryIndex = state.incompleteRetries
    state.incompleteRetries += 1
    const sequence = ++state.querySequence
    state.cancelScheduledQuery = this.schedule(() => {
      state.cancelScheduledQuery = undefined
      void this.executeQuery(state, sequence, true)
    }, incompleteRetryDelay(this.incompleteRetryMs, retryIndex))
  }

  private async executeQuery(
    state: TerminalCompletionSessionState,
    sequence: number,
    preserveCurrentResult = false,
  ) {
    const executor = this.queryExecutor
    const boundary = state.boundary
    if (!executor || !boundary || !this.canQuery(state) || sequence !== state.querySequence) {
      return
    }
    const inputRevision = state.input.revision
    const requestId = this.requestId()
    const controller = new AbortController()
    state.queryAbort = controller
    state.queryState = 'loading'
    state.errorCode = undefined
    this.publish(state)
    try {
      const result = await executor(state.sessionId, {
        request_id: requestId,
        source_generation: boundary.source_generation,
        shell_id: boundary.shell_id,
        prompt_generation: boundary.prompt_generation,
        line: state.input.line,
        cursor_utf16: state.input.cursorUtf16,
        trigger: 'typing',
        max_items: this.maximumItems,
      }, controller.signal)
      if (!this.isCurrentQuery(
        state,
        sequence,
        inputRevision,
        boundary,
      )) {
        return
      }
      if (
        result.request_id !== requestId
        || result.source_generation !== boundary.source_generation
      ) {
        state.queryAbort = undefined
        state.queryState = preserveCurrentResult ? 'ready' : 'error'
        if (!preserveCurrentResult) {
          state.items = []
          state.selectedIndex = -1
        }
        state.isIncomplete = false
        state.errorCode = 'COMPLETION_UNAVAILABLE'
        this.publish(state)
        return
      }
      state.queryAbort = undefined
      state.queryState = 'ready'
      const previousSelection = state.items[state.selectedIndex]
      const nextItems = result.items
        .filter((item) => appendTextForCandidate(state.input, item) !== null)
        .slice(0, this.maximumItems)
      state.items = nextItems
      const preservedIndex = previousSelection
        ? nextItems.findIndex((item) => (
            item.id === previousSelection.id
            && item.insert_text === previousSelection.insert_text
          ))
        : -1
      state.selectedIndex = preservedIndex >= 0
        ? preservedIndex
        : nextItems.length > 0 ? 0 : -1
      state.isIncomplete = result.is_incomplete
      state.indexGeneration = result.index_generation
      state.providerStates = result.provider_states.map((provider) => ({ ...provider }))
      state.errorCode = undefined
      this.publish(state)
      if (completionResultNeedsRetry(result)) {
        this.scheduleIncompleteRetry(state)
      }
    } catch (error) {
      if (controller.signal.aborted || sequence !== state.querySequence) {
        return
      }
      state.queryAbort = undefined
      state.queryState = preserveCurrentResult ? 'ready' : 'error'
      if (!preserveCurrentResult) {
        state.items = []
        state.selectedIndex = -1
      }
      state.isIncomplete = false
      state.errorCode = completionErrorCode(error)
      this.publish(state)
    }
  }

  private isCurrentQuery(
    state: TerminalCompletionSessionState,
    sequence: number,
    inputRevision: number,
    boundary: TerminalPromptBoundary,
  ) {
    return (
      sequence === state.querySequence
      && inputRevision === state.input.revision
      && state.input.trust === 'trusted'
      && state.boundary !== null
      && sameBoundary(state.boundary, boundary)
      && !state.alternateScreen
    )
  }

  private canQuery(state: TerminalCompletionSessionState) {
    return (
      this.enabled
      && this.queryExecutor !== undefined
      && state.readiness === 'ready'
      && state.boundary !== null
      && state.input.trust === 'trusted'
      && !state.input.composing
      && !state.alternateScreen
      && state.input.line.length >= 1
      && completionLineWithinByteLimit(state.input.line)
      && state.input.cursorUtf16 === state.input.line.length
    )
  }

  private cancelQuery(state: TerminalCompletionSessionState) {
    state.cancelScheduledQuery?.()
    state.cancelScheduledQuery = undefined
    state.queryAbort?.abort()
    state.queryAbort = undefined
    state.querySequence += 1
  }

  private clearQueryResult(state: TerminalCompletionSessionState) {
    state.queryState = 'idle'
    state.items = []
    state.selectedIndex = -1
    state.isIncomplete = false
    state.providerStates = []
    state.errorCode = undefined
  }

  private ensureSession(sessionId: string) {
    const existing = this.sessions.get(sessionId)
    if (existing) {
      return existing
    }
    const input = createTerminalCompletionInputState()
    const state: TerminalCompletionSessionState = {
      sessionId,
      readiness: 'waiting_prompt',
      boundary: null,
      input,
      queryState: 'idle',
      items: [],
      selectedIndex: -1,
      isIncomplete: false,
      indexGeneration: 0,
      providerStates: [],
      alternateScreen: false,
      querySequence: 0,
      incompleteRetries: 0,
      unanchoredInput: false,
      snapshot: undefined as unknown as TerminalCompletionSessionSnapshot,
    }
    state.snapshot = this.createSnapshot(state)
    this.fallbackSnapshots.delete(sessionId)
    this.fallbackReadiness.delete(sessionId)
    this.sessions.set(sessionId, state)
    return state
  }

  private getFallbackSnapshot(sessionId: string) {
    const existing = this.fallbackSnapshots.get(sessionId)
    if (existing) {
      return existing
    }
    const readiness = this.fallbackReadiness.get(sessionId) ?? 'waiting_prompt'
    this.fallbackReadiness.set(sessionId, readiness)
    const snapshot = createFallbackSnapshot(sessionId, this.enabled, readiness)
    this.fallbackSnapshots.set(sessionId, snapshot)
    return snapshot
  }

  private publish(state: TerminalCompletionSessionState) {
    state.snapshot = this.createSnapshot(state)
    this.notify(state.sessionId)
  }

  private createSnapshot(state: TerminalCompletionSessionState): TerminalCompletionSessionSnapshot {
    return {
      sessionId: state.sessionId,
      readiness: this.enabled ? state.readiness : 'disabled',
      boundary: state.boundary ? { ...state.boundary } : null,
      input: { ...state.input },
      queryState: state.queryState,
      items: state.items.map((item) => ({ ...item, sources: [...item.sources] })),
      selectedIndex: state.selectedIndex,
      isIncomplete: state.isIncomplete,
      indexGeneration: state.indexGeneration,
      providerStates: state.providerStates.map((provider) => ({ ...provider })),
      errorCode: state.errorCode,
    }
  }

  private notify(sessionId: string) {
    for (const listener of this.subscribers.get(sessionId) ?? []) {
      listener()
    }
  }
}

function appendTextForCandidate(
  input: TerminalCompletionInputState,
  item: CompletionItem,
) {
  const start = item.replace_start_utf16
  const end = item.replace_end_utf16
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || end !== input.cursorUtf16
    || end > input.line.length
    || !isUtf16Boundary(input.line, start)
    || !isUtf16Boundary(input.line, end)
  ) {
    return null
  }
  const current = input.line.slice(start, end)
  if (!item.insert_text.startsWith(current)) {
    return null
  }
  const appendText = item.insert_text.slice(current.length)
  return appendText.length > 0 && isSafeCandidateAppend(appendText)
    ? appendText
    : null
}

function isUtf16Boundary(value: string, offset: number) {
  if (offset <= 0 || offset >= value.length) {
    return true
  }
  const previous = value.charCodeAt(offset - 1)
  const next = value.charCodeAt(offset)
  return !(
    previous >= 0xd800
    && previous <= 0xdbff
    && next >= 0xdc00
    && next <= 0xdfff
  )
}

function canAdvanceBoundary(
  current: TerminalPromptBoundary,
  next: TerminalPromptBoundary,
) {
  if (next.source_generation !== current.source_generation) {
    return next.source_generation > current.source_generation
  }
  if (next.shell_id !== current.shell_id) {
    // 嵌套 Shell 可令 prompt generation 重置，input epoch 是跨 Shell 的顺序边界。
    return next.input_epoch > current.input_epoch
  }
  if (next.input_epoch < current.input_epoch) {
    return false
  }
  if (next.prompt_generation !== current.prompt_generation) {
    return next.prompt_generation > current.prompt_generation
  }
  return next.input_epoch === current.input_epoch
}

function sameBoundary(left: TerminalPromptBoundary, right: TerminalPromptBoundary) {
  return (
    left.source_generation === right.source_generation
    && left.shell_id === right.shell_id
    && left.prompt_generation === right.prompt_generation
    && left.input_epoch === right.input_epoch
    && left.shell === right.shell
    && left.cwd === right.cwd
  )
}

function satisfiesBoundaryFloor(
  floor: BoundaryFloor | undefined,
  boundary: TerminalPromptBoundary,
) {
  return (
    !floor
    || boundary.source_generation !== floor.sourceGeneration
    || boundary.input_epoch >= floor.minimumInputEpoch
  )
}

function completionErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) {
      return code
    }
  }
  return 'COMPLETION_UNAVAILABLE'
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `completion-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function scheduleWithTimeout(callback: () => void, delayMs: number) {
  const timeout = globalThis.setTimeout(callback, delayMs)
  return () => globalThis.clearTimeout(timeout)
}

function normalizeDelay(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : fallback
}

function normalizeCount(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback
}

function completionLineWithinByteLimit(value: string) {
  if (value.length > maximumQueryBytes) {
    return false
  }
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      return terminalCompletionTextEncoder.encode(value).byteLength <= maximumQueryBytes
    }
  }
  return true
}

function incompleteRetryDelay(baseDelayMs: number, retryIndex: number) {
  return Math.min(5_000, baseDelayMs * (2 ** Math.min(retryIndex, 8)))
}

function completionResultNeedsRetry(result: CompletionResult) {
  if (!result.is_incomplete) {
    return false
  }
  if (result.status === 'building') {
    return true
  }
  return result.provider_states.some(
    (provider) => provider.status === 'idle' || provider.status === 'building',
  )
}

function createFallbackSnapshot(
  sessionId: string,
  enabled: boolean,
  readiness: Exclude<TerminalCompletionReadiness, 'disabled'>,
): TerminalCompletionSessionSnapshot {
  return {
    sessionId,
    readiness: enabled ? readiness : 'disabled',
    boundary: null,
    input: createTerminalCompletionInputState(),
    queryState: 'idle',
    items: [],
    selectedIndex: -1,
    isIncomplete: false,
    indexGeneration: 0,
    providerStates: [],
  }
}

function normalizePositiveCount(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function isSafeCandidateAppend(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return false
    }
  }
  return true
}

function modulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor
}

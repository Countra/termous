import {
  isAgentRunActive,
  type AgentMessage,
  type AgentRun,
  type AgentRunEvent,
  type AgentSession,
} from '#entities/agent'
import type { AgentRuntimeStatus } from '#common/contracts'
import type { AgentWorkspaceEvent } from './agentRuntimeProtocol.ts'
import type { AgentWorkspaceSessionContextState } from './agentWorkspaceContextTypes.ts'
import type { AgentWorkspaceSessionUsageState } from './agentWorkspaceUsageTypes.ts'

export type AgentWorkspacePhase = 'idle' | 'loading' | 'ready' | 'reconnecting' | 'degraded'

export interface AgentComposerDraft {
  text: string
  updated_at: number
}

export interface AgentWorkspaceState {
  phase: AgentWorkspacePhase
  snapshot_complete: boolean
  revision: number
  sessions: AgentSession[]
  runs: Record<string, AgentRun>
  active_run_id?: string
  messages: Record<string, AgentMessage[]>
  run_events: Record<string, AgentRunEvent[]>
  run_event_sequences: Record<string, number>
  run_part_overlays: Record<string, Record<string, AgentMessage['parts'][number]>>
  drafts: Record<string, AgentComposerDraft>
  session_contexts: Record<string, AgentWorkspaceSessionContextState>
  session_usages: Record<string, AgentWorkspaceSessionUsageState>
  selected_session_id?: string
  new_session_selected: boolean
  selection_intent_revision: number
  runtime_status?: AgentRuntimeStatus
  error_code?: string
}

export interface AgentWorkspaceMergeResult {
  state: AgentWorkspaceState
  reconcile_run?: { id: string; generation: number }
}

export function createAgentWorkspaceState(): AgentWorkspaceState {
  return {
    phase: 'idle',
    snapshot_complete: false,
    revision: 0,
    sessions: [],
    runs: {},
    messages: {},
    run_events: {},
    run_event_sequences: {},
    run_part_overlays: {},
    drafts: {},
    session_contexts: {},
    session_usages: {},
    new_session_selected: false,
    selection_intent_revision: 0,
  }
}

export function applyAgentWorkspaceEvent(
  current: AgentWorkspaceState,
  event: AgentWorkspaceEvent,
): AgentWorkspaceMergeResult {
  if (event.type === 'snapshot') return applySnapshot(current, event)
  if (event.revision <= current.revision) return { state: current }
  if (event.type === 'removed') {
    return { state: removeEntity({ ...current, revision: event.revision }, event.entity, event.id) }
  }
  if (event.session) {
    return { state: upsertSession({ ...current, revision: event.revision }, event.session) }
  }
  if (event.message) {
    return { state: upsertMessage({ ...current, revision: event.revision }, event.message) }
  }
  if (event.run) {
    const state = upsertRun({ ...current, revision: event.revision }, event.run)
    return { state }
  }
  if (event.run_event) {
    const merged = appendRunEvent({ ...current, revision: event.revision }, event.run_event)
    return merged.gap ? {
      state: merged.state,
      reconcile_run: { id: event.run_event.run_id, generation: event.run_event.generation },
    } : { state: merged.state }
  }
  return { state: current }
}

export function replaceAgentSessions(
  current: AgentWorkspaceState,
  sessions: AgentSession[],
): AgentWorkspaceState {
  const sorted = sortSessions(dedupeByID(sessions, preferSession))
  const selection = reconcileSessionSelection(current, sorted)
  const sessionIDs = new Set(sorted.map(({ id }) => id))
  return {
    ...current,
    sessions: sorted,
    session_contexts: Object.fromEntries(Object.entries(current.session_contexts).filter(([id]) => sessionIDs.has(id))),
    session_usages: Object.fromEntries(Object.entries(current.session_usages).filter(([id]) => sessionIDs.has(id))),
    ...selection,
  }
}

export function mergeAgentMessages(
  current: AgentWorkspaceState,
  sessionId: string,
  incoming: AgentMessage[],
): AgentWorkspaceState {
  if (incoming.some(({ session_id }) => session_id !== sessionId)) return current
  const merged = dedupeByID([...(current.messages[sessionId] ?? []), ...incoming], preferMessage)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  return { ...current, messages: { ...current.messages, [sessionId]: merged } }
}

export function replaceAgentMessages(
  current: AgentWorkspaceState,
  sessionId: string,
  incoming: AgentMessage[],
): AgentWorkspaceState {
  if (incoming.some(({ session_id }) => session_id !== sessionId)) return current
  const messages = dedupeByID(incoming, preferMessage)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  return replayRuntimeMessageProjection({
    ...current,
    messages: { ...current.messages, [sessionId]: messages },
  }, sessionId)
}

export function replaceAgentRun(
  current: AgentWorkspaceState,
  run: AgentRun,
): AgentWorkspaceState {
  return upsertRun(current, run)
}

export function mergeAgentRunEvents(
  current: AgentWorkspaceState,
  run: AgentRun,
  incoming: AgentRunEvent[],
): AgentWorkspaceMergeResult {
  let state = upsertRun(current, run)
  for (const event of incoming) {
    const merged = appendRunEvent(state, event)
    state = merged.state
    if (merged.gap) {
      return {
        state,
        reconcile_run: { id: run.id, generation: run.generation },
      }
    }
  }
  return { state }
}

export function setAgentDraft(
  current: AgentWorkspaceState,
  sessionId: string,
  text: string,
  now = Date.now(),
): AgentWorkspaceState {
  if (!text) {
    return { ...current, drafts: withoutKey(current.drafts, sessionId) }
  }
  return {
    ...current,
    drafts: { ...current.drafts, [sessionId]: { text, updated_at: now } },
  }
}

export function selectAgentSession(current: AgentWorkspaceState, sessionId?: string) {
  if (sessionId !== undefined && !current.sessions.some(({ id, archived_at }) => id === sessionId && !archived_at)) {
    return current
  }
  return {
    ...current,
    selected_session_id: sessionId,
    new_session_selected: sessionId === undefined,
    selection_intent_revision: current.selection_intent_revision + 1,
  }
}

export function activeAgentRun(current: AgentWorkspaceState) {
  const run = current.active_run_id ? current.runs[current.active_run_id] : undefined
  return run && isAgentRunActive(run.status) ? run : undefined
}

function applySnapshot(
  current: AgentWorkspaceState,
  event: Extract<AgentWorkspaceEvent, { type: 'snapshot' }>,
): AgentWorkspaceMergeResult {
  let state = replaceAgentSessions({ ...current, revision: event.revision }, event.sessions)
  const sessionIDs = new Set(state.sessions.map(({ id }) => id))
  const terminalRuns = Object.fromEntries(Object.entries(state.runs).filter(([, run]) => (
    sessionIDs.has(run.session_id) && !isAgentRunActive(run.status)
  )))
  state = { ...state, runs: terminalRuns, active_run_id: undefined }
  for (const run of event.active_runs) state = upsertRun(state, run)
  const run = event.active_runs[0]
  return run && runRequiresReconcile(state, run) ? {
    state,
    reconcile_run: { id: run.id, generation: run.generation },
  } : { state }
}

function upsertSession(current: AgentWorkspaceState, session: AgentSession) {
  const existing = current.sessions.find((item) => item.id === session.id)
  if (existing && existing.revision >= session.revision) return current
  const sessions = sortSessions([
    session,
    ...current.sessions.filter((item) => item.id !== session.id),
  ])
  const selection = reconcileSessionSelection(current, sessions)
  return {
    ...current,
    sessions,
    ...selection,
  }
}

function upsertMessage(current: AgentWorkspaceState, message: AgentMessage) {
  return mergeAgentMessages(current, message.session_id, [message])
}

function upsertRun(current: AgentWorkspaceState, run: AgentRun) {
  const existing = current.runs[run.id]
  if (existing && (
    existing.generation > run.generation
    || (existing.generation === run.generation && existing.revision >= run.revision)
  )) return current
  const generationChanged = existing !== undefined && existing.generation !== run.generation
  const runs = { ...current.runs, [run.id]: run }
  let activeRunId = current.active_run_id
  const supersededRunIDs: string[] = []
  if (isAgentRunActive(run.status)) {
    for (const [id, candidate] of Object.entries(runs)) {
      if (id !== run.id && isAgentRunActive(candidate.status)) {
        delete runs[id]
        supersededRunIDs.push(id)
      }
    }
    activeRunId = run.id
  } else if (activeRunId === run.id) {
    activeRunId = undefined
  }
  if (!generationChanged && supersededRunIDs.length === 0) {
    return applyRunMessageStatus({ ...current, runs, active_run_id: activeRunId }, run)
  }
  const clearedRunIDs = generationChanged ? [...supersededRunIDs, run.id] : supersededRunIDs
  return applyRunMessageStatus({
    ...current,
    runs,
    active_run_id: activeRunId,
    run_events: withoutKeys(current.run_events, clearedRunIDs),
    run_event_sequences: withoutKeys(current.run_event_sequences, clearedRunIDs),
    run_part_overlays: withoutKeys(current.run_part_overlays, clearedRunIDs),
  }, run)
}

function appendRunEvent(current: AgentWorkspaceState, event: AgentRunEvent) {
  const run = current.runs[event.run_id]
  if (!run) return { state: current, gap: true }
  if (event.generation < run.generation) return { state: current, gap: false }
  if (event.generation > run.generation) return { state: current, gap: true }
  const cursor = current.run_event_sequences[event.run_id] ?? 0
  if (event.sequence <= cursor) return { state: current, gap: false }
  if (event.sequence !== cursor + 1) return { state: current, gap: true }
  if (!runEventMessageProjectionValid(current, run, event)) return { state: current, gap: true }
  let stateWithCursor = {
    ...current,
    run_event_sequences: { ...current.run_event_sequences, [event.run_id]: event.sequence },
  }
  if (event.kind === 'message_delta') {
    stateWithCursor = applyRunEventToMessages(stateWithCursor, run, event)
    const overlay = stateWithCursor.messages[run.session_id]
      ?.find(({ id }) => id === run.assistant_message_id)
      ?.parts.find(({ id }) => id === event.payload.message_delta.part_id)
    if (overlay) {
      stateWithCursor = {
        ...stateWithCursor,
        run_part_overlays: {
          ...stateWithCursor.run_part_overlays,
          [event.run_id]: {
            ...(stateWithCursor.run_part_overlays[event.run_id] ?? {}),
            [overlay.id]: overlay,
          },
        },
      }
    }
    // 高频 delta 仅保存累计 Part 与游标，不保留逐段事件历史。
    return { state: stateWithCursor, gap: false }
  }
  if (event.kind === 'message_part') {
    stateWithCursor = {
      ...stateWithCursor,
      run_part_overlays: removeRunPartOverlay(
        current.run_part_overlays,
        event.run_id,
        event.payload.message_part.id,
      ),
    }
  }
  const state = applyRunEventToMessages({
    ...stateWithCursor,
    run_events: {
      ...current.run_events,
      [event.run_id]: [...(current.run_events[event.run_id] ?? []), event],
    },
  }, run, event)
  return {
    state,
    gap: false,
  }
}

function runRequiresReconcile(state: AgentWorkspaceState, run: AgentRun) {
  return run.event_sequence > (state.run_event_sequences[run.id] ?? 0)
}

function removeEntity(
  current: AgentWorkspaceState,
  entity: 'session' | 'run' | 'message',
  id: string,
): AgentWorkspaceState {
  if (entity === 'session') {
    const sessions = current.sessions.filter((session) => session.id !== id)
    const removedRunIDs = Object.values(current.runs)
      .filter(({ session_id }) => session_id === id)
      .map((run) => run.id)
    const selection = current.selected_session_id === id
      ? automaticSessionSelection(sessions)
      : {
          selected_session_id: current.selected_session_id,
          new_session_selected: current.new_session_selected,
        }
    return {
      ...current,
      sessions,
      runs: withoutKeys(current.runs, removedRunIDs),
      messages: withoutKey(current.messages, id),
      run_events: withoutKeys(current.run_events, removedRunIDs),
      run_event_sequences: withoutKeys(current.run_event_sequences, removedRunIDs),
      run_part_overlays: withoutKeys(current.run_part_overlays, removedRunIDs),
      drafts: withoutKey(current.drafts, id),
      session_contexts: withoutKey(current.session_contexts, id),
      session_usages: withoutKey(current.session_usages, id),
      active_run_id: current.active_run_id && removedRunIDs.includes(current.active_run_id)
        ? undefined
        : current.active_run_id,
      ...selection,
    }
  }
  if (entity === 'message') {
    return {
      ...current,
      messages: Object.fromEntries(Object.entries(current.messages).map(([sessionId, messages]) => [
        sessionId,
        messages.filter((message) => message.id !== id),
      ])),
      run_part_overlays: removeMessagePartOverlays(current.run_part_overlays, id),
    }
  }
  return {
    ...current,
    runs: withoutKey(current.runs, id),
    run_events: withoutKey(current.run_events, id),
    run_event_sequences: withoutKey(current.run_event_sequences, id),
    run_part_overlays: withoutKey(current.run_part_overlays, id),
    active_run_id: current.active_run_id === id ? undefined : current.active_run_id,
  }
}

function reconcileSessionSelection(
  current: Pick<AgentWorkspaceState, 'selected_session_id' | 'new_session_selected'>,
  sessions: AgentSession[],
) {
  if (current.selected_session_id && sessions.some(({ id, archived_at }) => (
    id === current.selected_session_id && !archived_at
  ))) {
    return {
      selected_session_id: current.selected_session_id,
      new_session_selected: false,
    }
  }
  if (current.selected_session_id === undefined && current.new_session_selected) {
    return {
      selected_session_id: undefined,
      new_session_selected: true,
    }
  }
  return automaticSessionSelection(sessions)
}

function automaticSessionSelection(sessions: AgentSession[]) {
  return {
    selected_session_id: sessions.find(({ archived_at }) => !archived_at)?.id,
    new_session_selected: false,
  }
}

function dedupeByID<Value extends { id: string }>(values: Value[], prefer: (left: Value, right: Value) => Value) {
  const items = new Map<string, Value>()
  for (const value of values) {
    const current = items.get(value.id)
    items.set(value.id, current ? prefer(current, value) : value)
  }
  return [...items.values()]
}

function preferSession(left: AgentSession, right: AgentSession) {
  return left.revision >= right.revision ? left : right
}

function preferMessage(left: AgentMessage, right: AgentMessage) {
  return left.revision >= right.revision ? left : right
}

function sortSessions(sessions: AgentSession[]) {
  return [...sessions].sort((left, right) => (
    Date.parse(right.updated_at) - Date.parse(left.updated_at) || left.id.localeCompare(right.id)
  ))
}

function replayRuntimeMessageProjection(current: AgentWorkspaceState, sessionId: string) {
  let state = current
  for (const run of Object.values(current.runs)) {
    if (run.session_id !== sessionId) continue
    for (const event of current.run_events[run.id] ?? []) {
      state = applyRunEventToMessages(state, run, event)
    }
    for (const part of Object.values(current.run_part_overlays[run.id] ?? {})) {
      state = applyPartOverlayToMessages(state, run, part)
    }
    state = applyRunMessageStatus(state, run)
  }
  return state
}

function applyPartOverlayToMessages(
  current: AgentWorkspaceState,
  run: AgentRun,
  part: AgentMessage['parts'][number],
) {
  const messages = current.messages[run.session_id]
  const messageIndex = messages?.findIndex(({ id }) => id === run.assistant_message_id) ?? -1
  if (!messages || messageIndex < 0 || part.message_id !== run.assistant_message_id) return current
  const message = messages[messageIndex]!
  const nextMessages = [...messages]
  nextMessages[messageIndex] = {
    ...message,
    status: message.status === 'pending' ? 'streaming' : message.status,
    updated_at: part.updated_at,
    parts: applyMessagePart(message.parts, part),
  }
  return { ...current, messages: { ...current.messages, [run.session_id]: nextMessages } }
}

function runEventMessageProjectionValid(
  current: AgentWorkspaceState,
  run: AgentRun,
  event: AgentRunEvent,
) {
  if (event.kind === 'message_delta') {
    const delta = event.payload.message_delta
    if (delta.message_id !== run.assistant_message_id) return false
    const message = current.messages[run.session_id]?.find(({ id }) => id === delta.message_id)
    if (!message) return false
    const part = message.parts.find(({ id }) => id === delta.part_id)
    return !part || part.kind === delta.kind
  }
  if (event.kind === 'message_part') {
    const part = event.payload.message_part
    if (part.message_id !== run.assistant_message_id) return false
    const message = current.messages[run.session_id]?.find(({ id }) => id === part.message_id)
    if (!message) return false
    const existing = message.parts.find(({ id }) => id === part.id)
    return !existing || existing.kind === part.kind
  }
  return true
}

function applyRunEventToMessages(
  current: AgentWorkspaceState,
  run: AgentRun,
  event: AgentRunEvent,
) {
  if (event.kind !== 'message_delta' && event.kind !== 'message_part') return current
  const messages = current.messages[run.session_id]
  const messageIndex = messages?.findIndex(({ id }) => id === run.assistant_message_id) ?? -1
  if (!messages || messageIndex < 0) return current
  const message = messages[messageIndex]!
  const parts = event.kind === 'message_delta'
    ? applyMessageDelta(message.parts, event)
    : applyMessagePart(message.parts, event.payload.message_part)
  const nextMessage: AgentMessage = {
    ...message,
    status: message.status === 'pending' ? 'streaming' : message.status,
    updated_at: event.created_at,
    parts,
  }
  const nextMessages = [...messages]
  nextMessages[messageIndex] = nextMessage
  return { ...current, messages: { ...current.messages, [run.session_id]: nextMessages } }
}

function applyMessageDelta(
  parts: AgentMessage['parts'],
  event: Extract<AgentRunEvent, { kind: 'message_delta' }>,
) {
  const delta = event.payload.message_delta
  const existing = parts.find((part) => part.id === delta.part_id)
  if (existing && existing.kind !== delta.kind) return parts
  const part: AgentMessage['parts'][number] = existing
    ? { ...existing, text: existing.text + delta.delta, updated_at: event.created_at }
    : {
        id: delta.part_id,
        message_id: delta.message_id,
        sequence: nextPartSequence(parts),
        revision: 1,
        created_at: event.created_at,
        updated_at: event.created_at,
        kind: delta.kind,
        text: delta.delta,
      }
  return applyMessagePart(parts, part)
}

function applyMessagePart(parts: AgentMessage['parts'], part: AgentMessage['parts'][number]) {
  return [part, ...parts.filter(({ id }) => id !== part.id)]
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
}

function nextPartSequence(parts: AgentMessage['parts']) {
  return parts.reduce((maximum, part) => Math.max(maximum, part.sequence), 0) + 1
}

function applyRunMessageStatus(current: AgentWorkspaceState, run: AgentRun) {
  const messages = current.messages[run.session_id]
  const index = messages?.findIndex(({ id }) => id === run.assistant_message_id) ?? -1
  if (!messages || index < 0 || run.status === 'queued') return current
  const status = run.status === 'completed'
    ? 'completed'
    : run.status === 'failed'
      ? 'failed'
      : run.status === 'cancelled' || run.status === 'interrupted'
        ? 'interrupted'
        : 'streaming'
  if (messages[index]!.status === status) return current
  const next = [...messages]
  next[index] = { ...messages[index]!, status, updated_at: run.updated_at }
  return { ...current, messages: { ...current.messages, [run.session_id]: next } }
}

function withoutKey<Value>(values: Record<string, Value>, key: string) {
  const next = { ...values }
  delete next[key]
  return next
}

function withoutKeys<Value>(values: Record<string, Value>, keys: string[]) {
  if (keys.length === 0) return values
  const next = { ...values }
  for (const key of keys) delete next[key]
  return next
}

function removeRunPartOverlay(
  overlays: AgentWorkspaceState['run_part_overlays'],
  runId: string,
  partId: string,
) {
  const runOverlays = overlays[runId]
  if (!runOverlays?.[partId]) return overlays
  const nextRunOverlays = withoutKey(runOverlays, partId)
  if (Object.keys(nextRunOverlays).length === 0) return withoutKey(overlays, runId)
  return { ...overlays, [runId]: nextRunOverlays }
}

function removeMessagePartOverlays(
  overlays: AgentWorkspaceState['run_part_overlays'],
  messageId: string,
) {
  let changed = false
  const next: AgentWorkspaceState['run_part_overlays'] = {}
  for (const [runId, parts] of Object.entries(overlays)) {
    const retained = Object.fromEntries(Object.entries(parts).filter(([, part]) => part.message_id !== messageId))
    if (Object.keys(retained).length !== Object.keys(parts).length) changed = true
    if (Object.keys(retained).length > 0) next[runId] = retained
  }
  return changed ? next : overlays
}

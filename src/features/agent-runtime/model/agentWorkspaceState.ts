import {
  compareAgentSessionOrder,
  isAgentRunActive,
  isAgentRunTerminal,
  mergeAgentRetryActivity,
  type AgentMessage,
  type AgentQueueState,
  type AgentQueuedTurn,
  type AgentRun,
  type AgentRunEvent,
  type AgentSession,
  type AgentSessionGroup,
} from '#entities/agent'
import type { AgentWorkspaceEvent } from './agentRuntimeProtocol.ts'
import type { AgentQueuedTurnEditDraft, AgentWorkspaceMergeResult, AgentWorkspaceState } from './agentWorkspaceStateTypes.ts'
import { mergeAgentCompactionActivity } from './agentWorkspaceCompaction.ts'
import { acceptAgentContextUsage, markAgentSessionContextPending } from './agentWorkspaceContext.ts'

export type { AgentComposerDraft, AgentQueuedTurnEditDraft, AgentWorkspaceMergeResult, AgentWorkspacePhase, AgentWorkspaceState } from './agentWorkspaceStateTypes.ts'

export function createAgentWorkspaceState(): AgentWorkspaceState {
  return {
    phase: 'idle',
    snapshot_complete: false,
    revision: 0,
    sessions: [],
    session_groups: [],
    runs: {},
    messages: {},
    run_events: {},
    run_event_sequences: {},
    run_part_overlays: {},
    drafts: {},
    queued_turns: {},
    queue_states: {},
    queued_turn_edits: {},
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
    if (event.entity === 'session_group') {
      return { state: { ...current, revision: event.revision, session_groups: current.session_groups.filter(({ id }) => id !== event.id) } }
    }
    if (event.entity === 'queued_turn') {
      return { state: removeQueuedTurn({ ...current, revision: event.revision }, event.id, event.session_id) }
    }
    return { state: removeEntity({ ...current, revision: event.revision }, event.entity, event.id) }
  }
  if (event.queued_turn) {
    return { state: upsertQueuedTurn({ ...current, revision: event.revision }, event.queued_turn) }
  }
  if (event.queue_state) {
    return { state: upsertQueueState({ ...current, revision: event.revision }, event.queue_state) }
  }
  if (event.session) {
    return { state: upsertSession({ ...current, revision: event.revision }, event.session) }
  }
  if (event.session_group) {
    return { state: mergeAgentSessionGroups({ ...current, revision: event.revision }, [event.session_group]) }
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
  let next: AgentWorkspaceState = {
    ...current,
    sessions: sorted,
    session_contexts: Object.fromEntries(Object.entries(current.session_contexts).filter(([id]) => sessionIDs.has(id))),
    session_usages: Object.fromEntries(Object.entries(current.session_usages).filter(([id]) => sessionIDs.has(id))),
    ...selection,
  }
  for (const session of sorted) {
    const previous = current.sessions.find(({ id }) => id === session.id)
    if (previous && previous.model_id !== session.model_id) {
      next = markAgentSessionContextPending(next, session.id, session.model_id, previous.model_id)
    }
  }
  return next
}

export function mergeAgentSessionGroups(current: AgentWorkspaceState, incoming: AgentSessionGroup[]): AgentWorkspaceState {
  const groups = dedupeByID([...current.session_groups, ...incoming], (left, right) => left.revision >= right.revision ? left : right)
  return { ...current, session_groups: groups.sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id)) }
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
  const previousMessages = new Map((current.messages[sessionId] ?? []).map((message) => [message.id, message]))
  const messages = dedupeByID(incoming, preferMessage).map((message) => {
    const previous = previousMessages.get(message.id)
    // 消息页与 Run 独立读取，迟到的旧列表不能抹掉已经确认的终态元数据。
    const preferred = previous?.turn_usage && !message.turn_usage && previous.revision >= message.revision ? previous : message
    const snapshot = previous ? retainResponseFailureParts(preferred, preferred === message ? previous : message) : preferred
    return previous?.retries?.length ? { ...snapshot, retries: preferMessage(previous, message).retries } : snapshot
  })
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  let overlays = current.run_part_overlays
  for (const message of incoming) {
    if (!message.turn_usage) continue
    // 增量分页也携带本地消息，保留仍直接引用 overlay 的片段；新读到的终态片段才视为已落盘。
    for (const part of message.parts) {
      if (overlays[message.turn_usage.run_id]?.[part.id] !== part) {
        overlays = removeRunPartOverlay(overlays, message.turn_usage.run_id, part.id)
      }
    }
  }
  return replayRuntimeMessageProjection({
    ...current,
    messages: { ...current.messages, [sessionId]: messages },
    run_part_overlays: overlays,
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

export function replaceAgentQueuedTurns(
  current: AgentWorkspaceState,
  sessionId: string,
  turns: AgentQueuedTurn[],
  queueState?: AgentQueueState,
): AgentWorkspaceState {
  if (turns.some((turn) => turn.session_id !== sessionId) || (queueState && queueState.session_id !== sessionId)) return current
  const currentQueueState = current.queue_states[sessionId]
  if (queueState && currentQueueState && currentQueueState.revision > queueState.revision) return current
  const queueStates = queueState
    ? currentQueueState && currentQueueState.revision === queueState.revision
      ? current.queue_states
      : { ...current.queue_states, [sessionId]: queueState }
    : withoutKey(current.queue_states, sessionId)
  const editingTurn = turns.find(({ state, editing }) => state === 'queued' && editing)
  const queuedTurnEdits = editingTurn
    ? {
        ...current.queued_turn_edits,
        [sessionId]: current.queued_turn_edits[sessionId]?.turn_id === editingTurn.id
          ? current.queued_turn_edits[sessionId]!
          : {
              turn_id: editingTurn.id,
              text: editingTurn.prompt,
              retained_attachment_ids: editingTurn.attachments.map(({ id }) => id),
            },
      }
    : withoutKey(current.queued_turn_edits, sessionId)
  return {
    ...current,
    queued_turns: { ...current.queued_turns, [sessionId]: sortQueuedTurns(turns) },
    queue_states: queueStates,
    queued_turn_edits: queuedTurnEdits,
  }
}

export function replaceAgentQueuedTurn(current: AgentWorkspaceState, turn: AgentQueuedTurn) {
  return upsertQueuedTurn(current, turn)
}

export function replaceAgentQueueState(current: AgentWorkspaceState, queueState: AgentQueueState) {
  return upsertQueueState(current, queueState)
}

export function setAgentQueuedTurnEdit(
  current: AgentWorkspaceState,
  sessionId: string,
  edit?: AgentQueuedTurnEditDraft,
) {
  return {
    ...current,
    queued_turn_edits: edit
      ? { ...current.queued_turn_edits, [sessionId]: edit }
      : withoutKey(current.queued_turn_edits, sessionId),
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
  let state = replaceAgentSessions({ ...current, revision: event.revision, session_groups: event.session_groups ?? [] }, event.sessions)
  const sessionIDs = new Set(state.sessions.map(({ id }) => id))
  const terminalRuns = Object.fromEntries(Object.entries(state.runs).filter(([, run]) => (
    sessionIDs.has(run.session_id) && !isAgentRunActive(run.status)
  )))
  state = { ...state, runs: terminalRuns, active_run_id: undefined }
  for (const run of event.active_runs) state = upsertRun(state, run)
  const queuedBySession = new Map<string, AgentQueuedTurn[]>()
  for (const turn of event.queued_turns ?? []) {
    queuedBySession.set(turn.session_id, [...(queuedBySession.get(turn.session_id) ?? []), turn])
  }
  const queueSessionIDs = new Set([...queuedBySession.keys(), ...(event.queue_state ? [event.queue_state.session_id] : [])])
  state = {
    ...state,
    queued_turns: Object.fromEntries([...queuedBySession].map(([sessionId, turns]) => [sessionId, sortQueuedTurns(turns)])),
    queue_states: event.queue_state ? { [event.queue_state.session_id]: event.queue_state } : {},
    queued_turn_edits: Object.fromEntries(Object.entries(state.queued_turn_edits).filter(([sessionId]) => queueSessionIDs.has(sessionId))),
  }
  for (const sessionId of queueSessionIDs) {
    state = replaceAgentQueuedTurns(state, sessionId, state.queued_turns[sessionId] ?? [], state.queue_states[sessionId])
  }
  const run = event.active_runs[0]
  return run && runRequiresReconcile(state, run) ? {
    state,
    reconcile_run: { id: run.id, generation: run.generation },
  } : { state }
}

function upsertSession(current: AgentWorkspaceState, session: AgentSession) {
  const existing = current.sessions.find((item) => item.id === session.id)
  if (existing && existing.revision >= session.revision) return current
  return replaceAgentSessions(current, [
    session,
    ...current.sessions.filter((item) => item.id !== session.id),
  ])
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
    const message = current.messages[run.session_id]?.find(({ id }) => id === run.assistant_message_id)
    const partId = event.payload.message_delta.part_id
    if (message?.parts.some((part) => part.id === partId && part.response_failure)) return { state: stateWithCursor, gap: false }
    // 终态 Run 可以先于片段到达；仅跳过已有完整片段且没有待完成 overlay 的旧 delta。
    if (message?.turn_usage?.run_id === run.id && message.parts.some(({ id }) => id === partId)
      && !current.run_part_overlays[run.id]?.[partId]) return { state: stateWithCursor, gap: false }
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
    state: applyAgentContextEvent(state, run, event),
    gap: false,
  }
}

function applyAgentContextEvent(current: AgentWorkspaceState, run: AgentRun, event: AgentRunEvent): AgentWorkspaceState {
  if (event.kind === 'context_usage') {
    if (!current.sessions.some(({ id }) => id === run.session_id)) return current
    // 旧任务的事件补拉仍需推进游标，但不能覆盖同会话后续任务的实时占用。
    if (Object.values(current.runs).some((candidate) => (
      candidate.session_id === run.session_id && candidate.generation > run.generation
    ))) return current
    return acceptAgentContextUsage(current, run, event.payload.context_usage)
  }
  if (event.kind !== 'compaction' && event.kind !== 'retry') return current
  const messages = current.messages[run.session_id]
  if (!messages) return current
  return { ...current, messages: { ...current.messages, [run.session_id]: messages.map((message) => (
    message.id !== run.assistant_message_id ? message
      : event.kind === 'compaction' ? mergeAgentCompactionActivity(message, event)
        : mergeRetryEvent(message, event)
  )) } }
}

function mergeRetryEvent(message: AgentMessage, event: Extract<AgentRunEvent, { kind: 'retry' }>): AgentMessage {
  const incoming = { ...event.payload.retry, created_at: event.created_at }
  if (incoming.assistant_message_id !== message.id) return message
  const retries = message.retries ?? []
  const previous = retries.find(({ retry_id }) => retry_id === incoming.retry_id)
  const merged = mergeAgentRetryActivity(previous, incoming)
  if (merged === previous) return message
  return { ...message, retries: previous
    ? retries.map((activity) => activity.retry_id === merged.retry_id ? merged : activity)
    : [...retries, merged] }
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
      queued_turns: withoutKey(current.queued_turns, id),
      queue_states: withoutKey(current.queue_states, id),
      queued_turn_edits: withoutKey(current.queued_turn_edits, id),
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

function upsertQueuedTurn(current: AgentWorkspaceState, turn: AgentQueuedTurn) {
  const turns = current.queued_turns[turn.session_id] ?? []
  const existing = turns.find(({ id }) => id === turn.id)
  if (existing && existing.revision >= turn.revision) return current
  if (turn.state !== 'queued') return removeQueuedTurn(current, turn.id, turn.session_id)
  const activeEdit = current.queued_turn_edits[turn.session_id]
  const queuedTurnEdits = turn.editing
    ? {
        ...current.queued_turn_edits,
        [turn.session_id]: activeEdit?.turn_id === turn.id
          ? activeEdit
          : {
              turn_id: turn.id,
              text: turn.prompt,
              retained_attachment_ids: turn.attachments.map(({ id }) => id),
            },
      }
    : activeEdit?.turn_id === turn.id
      ? withoutKey(current.queued_turn_edits, turn.session_id)
      : current.queued_turn_edits
  return {
    ...current,
    queued_turns: {
      ...current.queued_turns,
      [turn.session_id]: sortQueuedTurns([turn, ...turns.filter(({ id }) => id !== turn.id)]),
    },
    queued_turn_edits: queuedTurnEdits,
  }
}

function upsertQueueState(current: AgentWorkspaceState, queueState: AgentQueueState) {
  const existing = current.queue_states[queueState.session_id]
  if (existing && existing.revision >= queueState.revision) return current
  return {
    ...current,
    queue_states: { ...current.queue_states, [queueState.session_id]: queueState },
  }
}

function removeQueuedTurn(current: AgentWorkspaceState, id: string, sessionId?: string) {
  if (!sessionId) return current
  const turns = current.queued_turns[sessionId]
  if (!turns?.some((turn) => turn.id === id)) return current
  const editing = current.queued_turn_edits[sessionId]
  return {
    ...current,
    queued_turns: { ...current.queued_turns, [sessionId]: turns.filter((turn) => turn.id !== id) },
    queued_turn_edits: editing?.turn_id === id
      ? withoutKey(current.queued_turn_edits, sessionId)
      : current.queued_turn_edits,
  }
}

function sortQueuedTurns(turns: AgentQueuedTurn[]) {
  return [...turns].sort((left, right) => left.queue_sequence - right.queue_sequence || left.id.localeCompare(right.id))
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
  const snapshot = left.revision > right.revision
    || (left.revision === right.revision && (left.turn_usage !== undefined || right.turn_usage === undefined)) ? left : right
  const preferred = retainResponseFailureParts(snapshot, snapshot === left ? right : left)
  if (!left.retries?.length && !right.retries?.length) return preferred
  const retries = new Map((left.retries ?? []).map((activity) => [activity.retry_id, activity]))
  for (const activity of right.retries ?? []) retries.set(activity.retry_id, mergeAgentRetryActivity(retries.get(activity.retry_id), activity))
  return { ...preferred, retries: [...retries.values()] }
}

function retainResponseFailureParts(preferred: AgentMessage, other: AgentMessage): AgentMessage {
  let parts = preferred.parts
  // 失败片段不可恢复为活动输出；旧分页和重连快照仍需保留已经确认的失败历史。
  for (const part of other.parts) {
    if (part.response_failure) parts = applyMessagePart(parts, part)
  }
  return parts === preferred.parts ? preferred : { ...preferred, parts }
}

function sortSessions(sessions: AgentSession[]) {
  return [...sessions].sort(compareAgentSessionOrder)
}

function replayRuntimeMessageProjection(current: AgentWorkspaceState, sessionId: string) {
  let state = current
  for (const run of Object.values(current.runs)) {
    if (run.session_id !== sessionId) continue
    for (const event of current.run_events[run.id] ?? []) {
      state = applyRunEventToMessages(state, run, event)
      if (event.kind === 'compaction' || event.kind === 'retry') state = applyAgentContextEvent(state, run, event)
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
  if (event.kind === 'compaction') {
    return event.payload.compaction.assistant_message_id === run.assistant_message_id
      && Boolean(current.messages[run.session_id]?.some(({ id }) => id === run.assistant_message_id))
  }
  if (event.kind === 'retry') {
    return event.payload.retry.assistant_message_id === run.assistant_message_id
      && Boolean(current.messages[run.session_id]?.some(({ id }) => id === run.assistant_message_id))
  }
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
    if (part.response_failure && message.role !== 'assistant') return false
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
  if (existing?.response_failure) return parts
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
  const existing = parts.find(({ id }) => id === part.id)
  if (existing === part || existing?.response_failure
    && (!part.response_failure || existing.revision >= part.revision)) return parts
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
  const message = messages[index]!
  // HTTP 消息页可能比先读取的 Run 更新；同一任务已落盘的终态不能回退成流式消息。
  if (message.turn_usage?.run_id === run.id && !isAgentRunTerminal(run.status)) return current
  const status = run.status === 'completed'
    ? 'completed'
    : run.status === 'failed'
      ? 'failed'
      : run.status === 'cancelled' || run.status === 'interrupted'
        ? 'interrupted'
        : 'streaming'
  const turnUsage = isAgentRunTerminal(run.status)
    ? {
        run_id: run.id,
        usage: run.usage,
        ...(run.error_code ? { error_code: run.error_code } : {}),
        ...(run.error_message !== undefined ? { error_message: run.error_message } : {}),
        ...(run.started_at ? { started_at: run.started_at } : {}),
        ...(run.completed_at ? { completed_at: run.completed_at } : {}),
      }
    : undefined
  if (message.status === status && messageTurnUsageEqual(message.turn_usage, turnUsage)) return current
  const next = [...messages]
  next[index] = { ...message, status, updated_at: run.updated_at, turn_usage: turnUsage }
  return { ...current, messages: { ...current.messages, [run.session_id]: next } }
}

function messageTurnUsageEqual(
  left: AgentMessage['turn_usage'],
  right: AgentMessage['turn_usage'],
) {
  if (!left || !right) return left === right
  return left.run_id === right.run_id
    && left.error_code === right.error_code
    && left.error_message === right.error_message
    && left.started_at === right.started_at
    && left.completed_at === right.completed_at
    && left.usage.input_tokens === right.usage.input_tokens
    && left.usage.cache_read_tokens === right.usage.cache_read_tokens
    && left.usage.cache_write_tokens === right.usage.cache_write_tokens
    && left.usage.output_tokens === right.usage.output_tokens
    && left.usage.reasoning_tokens === right.usage.reasoning_tokens
    && left.usage.total_tokens === right.usage.total_tokens
    && left.usage.estimated === right.usage.estimated
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

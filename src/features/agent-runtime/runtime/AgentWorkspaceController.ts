import type {
  AgentMessage,
  AgentRun,
  AgentRunEvent,
  AgentSession,
  AgentSessionInput,
  AgentSessionUpdateInput,
  AgentSourceContext,
} from '#entities/agent'
import { isAgentRunTerminal } from '#entities/agent'
import type { AgentRuntimeStatus } from '#common/contracts'
import { retireWebSocket } from '#shared/websocket'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import {
  activeAgentRun,
  applyAgentWorkspaceEvent,
  createAgentWorkspaceState,
  mergeAgentRunEvents,
  replaceAgentMessages,
  replaceAgentRun,
  replaceAgentSessions,
  selectAgentSession,
  setAgentDraft,
  type AgentWorkspaceState,
} from '../model/agentWorkspaceState.ts'
import {
  acceptAgentSessionContext,
  beginAgentSessionContextLoad,
  failAgentSessionContextLoad,
  setAgentContextCompressionPending,
} from '../model/agentWorkspaceContext.ts'
import { decodeAgentWorkspaceEvent } from '../model/agentRuntimeProtocol.ts'

const reconnectInitialDelay = 500
const reconnectMaximumDelay = 5_000
const maximumPageCount = 100

export interface AgentWorkspaceControllerOptions {
  gateway: AgentWorkspaceGateway
  socketFactory?: (url: string) => WebSocket
  newClientRequestID?: () => string
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

export class AgentWorkspaceControllerError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'AgentWorkspaceControllerError'
    this.code = code
  }
}

export class AgentRuntimeStartError extends AgentWorkspaceControllerError {
  readonly run: AgentRun

  constructor(code: string, run: AgentRun) {
    super(code)
    this.name = 'AgentRuntimeStartError'
    this.run = run
  }
}

export class AgentWorkspaceController {
  private state = createAgentWorkspaceState()
  private readonly listeners = new Set<() => void>()
  private readonly gateway: AgentWorkspaceGateway
  private readonly socketFactory: (url: string) => WebSocket
  private readonly newClientRequestID: () => string
  private readonly setTimer: NonNullable<AgentWorkspaceControllerOptions['setTimer']>
  private readonly clearTimer: NonNullable<AgentWorkspaceControllerOptions['clearTimer']>
  private socket: WebSocket | null = null
  private snapshotSocket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectDelay = reconnectInitialDelay
  private disposed = true
  private authorityVersion = 0
  private hydrateController: AbortController | null = null
  private readonly runHydrations = new Map<string, {
    controller: AbortController
    dirty: boolean
    promise: Promise<void>
  }>()
  private readonly messageHydrations = new Map<string, AbortController>()
  private readonly contextHydrations = new Map<string, {
    controller: AbortController
    dirty: boolean
    promise: Promise<void>
  }>()
  private mutation: Promise<unknown> | null = null
  private unsubscribeRuntime?: () => void

  constructor(options: AgentWorkspaceControllerOptions) {
    this.gateway = options.gateway
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url))
    this.newClientRequestID = options.newClientRequestID ?? defaultClientRequestID
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
    this.clearTimer = options.clearTimer ?? clearTimeout
  }

  getSnapshot = () => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start() {
    if (!this.disposed) return
    this.disposed = false
    this.commit({ ...this.state, phase: 'loading', snapshot_complete: false, error_code: undefined })
    this.observeRuntime()
    void this.reload().catch((error) => this.captureError(error))
    this.connect()
  }

  close() {
    if (this.disposed) return
    this.disposed = true
    this.authorityVersion += 1
    this.hydrateController?.abort()
    this.hydrateController = null
    for (const hydration of this.runHydrations.values()) hydration.controller.abort()
    this.runHydrations.clear()
    for (const controller of this.messageHydrations.values()) controller.abort()
    this.messageHydrations.clear()
    for (const hydration of this.contextHydrations.values()) hydration.controller.abort()
    this.contextHydrations.clear()
    if (this.reconnectTimer !== undefined) {
      this.clearTimer(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    const socket = this.socket
    this.socket = null
    this.snapshotSocket = null
    if (socket) retireWebSocket(socket)
    this.unsubscribeRuntime?.()
    this.unsubscribeRuntime = undefined
    this.commit({ ...this.state, phase: 'idle', snapshot_complete: false })
  }

  selectSession(sessionId?: string) {
    this.commit(selectAgentSession(this.state, sessionId))
    for (const [id, hydration] of this.contextHydrations) {
      if (id === sessionId) continue
      hydration.controller.abort()
      this.contextHydrations.delete(id)
    }
    if (sessionId) {
      void this.hydrateMessages(sessionId, true).catch((error) => this.captureError(error))
      void this.hydrateContext(sessionId)
    }
  }

  updateDraft(sessionId: string, text: string) {
    this.commit(setAgentDraft(this.state, sessionId, text))
  }

  setContextCompressionPending(sessionId: string, pending: boolean) {
    if (activeAgentRun(this.state)) throw new AgentWorkspaceControllerError('AGENT_RUN_ACTIVE')
    if (!this.state.sessions.some(({ id, archived_at }) => id === sessionId && !archived_at)) {
      throw new AgentWorkspaceControllerError('AGENT_SESSION_NOT_FOUND')
    }
    const context = this.state.session_contexts[sessionId]
    if (pending && !context?.value?.compression_available) {
      throw new AgentWorkspaceControllerError('AGENT_CONTEXT_COMPRESSION_UNAVAILABLE')
    }
    this.commit(setAgentContextCompressionPending(this.state, sessionId, pending))
  }

  reloadContext(sessionId: string) {
    return this.hydrateContext(sessionId)
  }

  async createSession(input: AgentSessionInput) {
    return await this.runMutation(async () => {
      const session = await this.gateway.createSession(input)
      this.acceptSession(session)
      return session
    })
  }

  async updateSession(id: string, input: AgentSessionUpdateInput) {
    return await this.runMutation(async () => {
      const previousModelProfileId = this.state.sessions.find((session) => session.id === id)?.model_profile_id
      const session = await this.gateway.updateSession(id, input)
      this.acceptSession(session)
      if (previousModelProfileId && previousModelProfileId !== session.model_profile_id) {
        void this.hydrateContext(id, 'restart')
      }
      return session
    })
  }

  async deleteSession(id: string, expectedRevision: number) {
    await this.runMutation(async () => {
      await this.gateway.deleteSession(id, expectedRevision)
      await this.hydrateSessions()
    })
  }

  async startRun(
    sessionId: string,
    prompt: string,
    attachmentIds: string[] = [],
    sourceContext?: AgentSourceContext,
  ) {
    return await this.runMutation(async () => {
      if (activeAgentRun(this.state)) throw new AgentWorkspaceControllerError('AGENT_RUN_ACTIVE')
      if (!this.state.sessions.some(({ id }) => id === sessionId)) {
        throw new AgentWorkspaceControllerError('AGENT_SESSION_NOT_FOUND')
      }
      if (!prompt.trim()) throw new AgentWorkspaceControllerError('AGENT_PROMPT_EMPTY')
      const submittedDraft = this.state.drafts[sessionId]
      const forceContextCompression = this.state.session_contexts[sessionId]?.compression_pending === true
      const run = await this.gateway.createRun(sessionId, {
        client_request_id: this.newClientRequestID(),
        prompt,
        attachment_ids: attachmentIds,
        source_context: sourceContext,
        force_context_compression: forceContextCompression,
      })
      this.commit(replaceAgentRun(this.state, run))
      if (this.state.drafts[sessionId] === submittedDraft) {
        this.commit(setAgentDraft(this.state, sessionId, ''))
      }
      let result
      try {
        result = await this.gateway.startRuntime(run)
      } catch (error) {
        await this.cancelRejectedRuntimeStart(run)
        throw new AgentRuntimeStartError(runtimeStartErrorCode(error), run)
      }
      if (!result.accepted) {
        await this.cancelRejectedRuntimeStart(run)
        throw new AgentRuntimeStartError(
          result.error_code ?? 'AGENT_RUNTIME_START_REJECTED',
          run,
        )
      }
      if (forceContextCompression) {
        this.commit(setAgentContextCompressionPending(this.state, sessionId, false))
      }
      return run
    })
  }

  async stopActiveRun() {
    return await this.runMutation(async () => {
      const run = activeAgentRun(this.state)
      if (!run) return undefined
      const stopping = await this.gateway.stopRun(run.id, run.revision)
      this.commit(replaceAgentRun(this.state, stopping))
      if (isAgentRunTerminal(stopping.status)) return stopping
      const result = await this.gateway.stopRuntime(stopping)
      if (!result.accepted) {
        void this.hydrateRun(run.id).catch((error) => this.captureError(error))
        if (result.error_code === 'AGENT_RUNTIME_RUN_NOT_ACTIVE') return stopping
        throw new AgentWorkspaceControllerError(result.error_code ?? 'AGENT_RUNTIME_STOP_REJECTED')
      }
      return stopping
    })
  }

  async steerActiveRun(message: string) {
    return await this.runMutation(async () => {
      const run = activeAgentRun(this.state)
      if (!run) throw new AgentWorkspaceControllerError('AGENT_RUN_NOT_ACTIVE')
      if (!message.trim()) throw new AgentWorkspaceControllerError('AGENT_STEER_EMPTY')
      const result = await this.gateway.steerRuntime(run, message)
      if (!result.accepted) {
        throw new AgentWorkspaceControllerError(result.error_code ?? 'AGENT_RUNTIME_STEER_REJECTED')
      }
      return result
    })
  }

  async reload() {
    const recoverySocket = this.socket
    const recoveryAuthority = this.authorityVersion
    await this.hydrateSessions()
    const run = activeAgentRun(this.state)
    if (run) await this.hydrateRun(run.id)
    const selected = this.state.selected_session_id
    await Promise.all([
      selected && selected !== run?.session_id
        ? this.hydrateMessages(selected, true)
        : Promise.resolve(),
      selected ? this.hydrateContext(selected) : Promise.resolve(),
    ])
    if (!this.disposed
      && recoverySocket
      && this.socket === recoverySocket
      && this.snapshotSocket === recoverySocket
      && this.authorityVersion === recoveryAuthority) {
      this.commit({ ...this.state, phase: 'ready', error_code: undefined })
    }
  }

  private connect() {
    if (this.disposed || this.socket) return
    let socket: WebSocket
    try {
      socket = this.socketFactory(this.gateway.eventsUrl())
    } catch (error) {
      this.captureError(error, 'reconnecting')
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    this.snapshotSocket = null
    socket.addEventListener('open', () => {
      if (this.disposed || this.socket !== socket) return
      this.reconnectDelay = reconnectInitialDelay
      void this.reload().catch((error) => this.captureError(error))
    })
    socket.addEventListener('message', (message: MessageEvent<string>) => {
      if (this.disposed || this.socket !== socket) return
      try {
        const event = decodeAgentWorkspaceEvent(JSON.parse(String(message.data)))
        if (event.type !== 'snapshot' && this.snapshotSocket !== socket) {
          throw new AgentWorkspaceControllerError('AGENT_WORKSPACE_SNAPSHOT_REQUIRED')
        }
        if (event.type !== 'snapshot' && event.revision <= this.state.revision) return
        const revisionGap = event.type !== 'snapshot'
          && event.revision > this.state.revision + 1
        if (revisionGap) {
          this.invalidateHydrations()
          this.captureError(
            new AgentWorkspaceControllerError('AGENT_WORKSPACE_REVISION_GAP'),
            'reconnecting',
          )
          socket.close()
          return
        }
        this.authorityVersion += 1
        for (const hydration of this.runHydrations.values()) hydration.dirty = true
        const previousActiveRun = activeAgentRun(this.state)
        const result = applyAgentWorkspaceEvent(this.state, event)
        const changedContextModels = changedContextModelSessions(this.state, result.state)
        if (event.type === 'snapshot') this.snapshotSocket = socket
        this.commit(event.type === 'snapshot'
          ? { ...result.state, phase: 'ready', snapshot_complete: true, error_code: undefined }
          : result.state)
        for (const sessionId of changedContextModels) {
          void this.hydrateContext(sessionId, 'restart')
        }
        const nextActiveRun = activeAgentRun(result.state)
        if (previousActiveRun && previousActiveRun.id !== nextActiveRun?.id) {
          void this.hydrateContext(previousActiveRun.session_id, 'refresh')
        }
        if (result.reconcile_run) {
          void this.hydrateRun(result.reconcile_run.id).catch((error) => this.captureError(error))
        }
      } catch (error) {
        this.invalidateHydrations()
        this.captureError(error, 'reconnecting')
        socket.close()
      }
    })
    socket.addEventListener('error', () => socket.close())
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null
      if (this.snapshotSocket === socket) this.snapshotSocket = null
      if (!this.disposed) {
        this.commit({ ...this.state, phase: 'reconnecting', snapshot_complete: false })
        this.scheduleReconnect()
      }
    })
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer !== undefined) return
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, reconnectMaximumDelay)
  }

  private async hydrateSessions() {
    this.hydrateController?.abort()
    const controller = new AbortController()
    this.hydrateController = controller
    const authority = this.authorityVersion
    try {
      const sessions: AgentSession[] = []
      const cursors = new Set<string>()
      let cursor: string | undefined
      for (let page = 0; page < maximumPageCount; page += 1) {
        const result = await this.gateway.sessions({
          archived: false,
          cursor,
          limit: 200,
          signal: controller.signal,
        })
        sessions.push(...result.items)
        if (!result.next_cursor) break
        if (cursors.has(result.next_cursor)) throw new AgentWorkspaceControllerError('AGENT_SESSION_CURSOR_INVALID')
        cursors.add(result.next_cursor)
        cursor = result.next_cursor
        if (page === maximumPageCount - 1) throw new AgentWorkspaceControllerError('AGENT_SESSION_PAGE_LIMIT')
      }
      if (!this.disposed && authority === this.authorityVersion) {
        this.commit(replaceAgentSessions(this.state, sessions))
      }
    } finally {
      if (this.hydrateController === controller) this.hydrateController = null
    }
  }

  private hydrateRun(runId: string) {
    const current = this.runHydrations.get(runId)
    if (current) {
      current.dirty = true
      return current.promise
    }
    const entry = {
      controller: new AbortController(),
      dirty: false,
      promise: Promise.resolve(),
    }
    entry.promise = (async () => {
      do {
        entry.dirty = false
        await this.performRunHydration(runId, entry.controller.signal)
      } while (!this.disposed && !entry.controller.signal.aborted && entry.dirty)
    })().finally(() => {
      if (this.runHydrations.get(runId) === entry) this.runHydrations.delete(runId)
    })
    this.runHydrations.set(runId, entry)
    return entry.promise
  }

  private async performRunHydration(runId: string, signal: AbortSignal) {
    const authority = this.authorityVersion
    const run = await this.gateway.run(runId, signal)
    if (this.disposed || authority !== this.authorityVersion) return
    const currentRun = this.state.runs[run.id]
    const afterSequence = currentRun?.generation === run.generation
      ? this.state.run_event_sequences[run.id] ?? 0
      : 0
    const [events, messages] = await Promise.all([
      this.loadRunEvents(run, afterSequence, signal),
      this.loadMessages(run.session_id, 0, signal),
    ])
    if (this.disposed || authority !== this.authorityVersion) return
    let merged = replaceAgentRun(this.state, run)
    merged = replaceAgentMessages(merged, run.session_id, messages)
    const result = mergeAgentRunEvents(merged, run, events)
    if (result.reconcile_run) {
      throw new AgentWorkspaceControllerError('AGENT_RUN_EVENT_GAP')
    }
    this.commit(result.state)
    if (isAgentRunTerminal(run.status)) void this.hydrateContext(run.session_id, 'refresh')
  }

  private async hydrateMessages(sessionId: string, authoritative: boolean) {
    this.messageHydrations.get(sessionId)?.abort()
    const controller = new AbortController()
    this.messageHydrations.set(sessionId, controller)
    const authority = this.authorityVersion
    const after = authoritative ? 0 : lastMessageSequence(this.state.messages[sessionId] ?? [])
    try {
      const messages = await this.loadMessages(sessionId, after, controller.signal)
      if (this.disposed || authority !== this.authorityVersion) return
      this.commit(authoritative
        ? replaceAgentMessages(this.state, sessionId, messages)
        : replaceAgentMessages(this.state, sessionId, [
            ...(this.state.messages[sessionId] ?? []),
            ...messages,
          ]))
    } finally {
      if (this.messageHydrations.get(sessionId) === controller) {
        this.messageHydrations.delete(sessionId)
      }
    }
  }

  private hydrateContext(
    sessionId: string,
    mode: 'coalesce' | 'refresh' | 'restart' = 'coalesce',
  ) {
    if (this.disposed) return
    const current = this.contextHydrations.get(sessionId)
    if (current && mode !== 'restart') {
      if (mode === 'refresh') current.dirty = true
      return current.promise
    }
    current?.controller.abort()
    const controller = new AbortController()
    const entry = { controller, dirty: false, promise: Promise.resolve() }
    entry.promise = (async () => {
      this.commit(beginAgentSessionContextLoad(this.state, sessionId))
      do {
        entry.dirty = false
        try {
          const context = await this.gateway.context(sessionId, controller.signal)
          if (this.disposed || this.contextHydrations.get(sessionId) !== entry) return
          if (!entry.dirty) this.commit(acceptAgentSessionContext(this.state, context))
        } catch (error) {
          if (
            !this.disposed
            && this.contextHydrations.get(sessionId) === entry
            && !isAbortError(error)
            && !entry.dirty
          ) {
            this.commit(failAgentSessionContextLoad(this.state, sessionId, errorCode(error)))
          }
        }
      } while (!this.disposed && !controller.signal.aborted && entry.dirty)
    })().finally(() => {
      if (this.contextHydrations.get(sessionId) === entry) {
        this.contextHydrations.delete(sessionId)
      }
    })
    this.contextHydrations.set(sessionId, entry)
    return entry.promise
  }

  private async loadMessages(sessionId: string, afterSequence: number, signal?: AbortSignal) {
    const messages: AgentMessage[] = []
    let cursor = afterSequence
    for (let page = 0; page < maximumPageCount; page += 1) {
      const result = await this.gateway.messages(sessionId, { afterSequence: cursor, limit: 200, signal })
      messages.push(...result.items)
      if (!result.next_after_sequence) break
      if (result.next_after_sequence <= cursor) throw new AgentWorkspaceControllerError('AGENT_MESSAGE_CURSOR_INVALID')
      cursor = result.next_after_sequence
      if (page === maximumPageCount - 1) throw new AgentWorkspaceControllerError('AGENT_MESSAGE_PAGE_LIMIT')
    }
    return messages
  }

  private async loadRunEvents(run: AgentRun, afterSequence: number, signal?: AbortSignal) {
    const events: AgentRunEvent[] = []
    let cursor = afterSequence
    for (let page = 0; page < maximumPageCount; page += 1) {
      const result = await this.gateway.runEvents(run.id, {
        generation: run.generation,
        afterSequence: cursor,
        limit: 200,
        signal,
      })
      if (result.items.some((event) => (
        event.run_id !== run.id || event.generation !== run.generation
      ))) {
        throw new AgentWorkspaceControllerError('AGENT_RUN_EVENT_OWNER_INVALID')
      }
      if (result.items[0] && result.items[0].sequence !== cursor + 1) {
        throw new AgentWorkspaceControllerError('AGENT_RUN_EVENT_GAP')
      }
      events.push(...result.items)
      if (!result.next_after_sequence) break
      if (result.next_after_sequence <= cursor) throw new AgentWorkspaceControllerError('AGENT_RUN_EVENT_CURSOR_INVALID')
      if (result.items[result.items.length - 1]?.sequence !== result.next_after_sequence) {
        throw new AgentWorkspaceControllerError('AGENT_RUN_EVENT_CURSOR_INVALID')
      }
      cursor = result.next_after_sequence
      if (page === maximumPageCount - 1) throw new AgentWorkspaceControllerError('AGENT_RUN_EVENT_PAGE_LIMIT')
    }
    return events
  }

  private observeRuntime() {
    void Promise.resolve()
      .then(() => this.gateway.runtimeStatus())
      .then((status) => this.acceptRuntimeStatus(status))
      .catch(() => undefined)
    try {
      this.unsubscribeRuntime = this.gateway.onRuntimeStatus((status) => this.acceptRuntimeStatus(status))
    } catch {
      this.unsubscribeRuntime = undefined
    }
  }

  private acceptRuntimeStatus(status: AgentRuntimeStatus) {
    if (!this.disposed) this.commit({ ...this.state, runtime_status: status })
  }

  private acceptSession(session: AgentSession) {
    this.commit(replaceAgentSessions(this.state, [
      session,
      ...this.state.sessions.filter(({ id }) => id !== session.id),
    ]))
  }

  private async cancelRejectedRuntimeStart(run: AgentRun) {
    let current = this.state.runs[run.id] ?? run
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (isAgentRunTerminal(current.status)) return
      try {
        const stopped = await this.gateway.stopRun(current.id, current.revision)
        this.commit(replaceAgentRun(this.state, stopped))
        if (stopped.status === 'stopping') {
          const result = await this.gateway.stopRuntime(stopped)
          if (!result.accepted && result.error_code !== 'AGENT_RUNTIME_RUN_NOT_ACTIVE') {
            void this.hydrateRun(run.id).catch((error) => this.captureError(error))
          }
        }
        return
      } catch {
        if (attempt === 0) {
          try {
            current = await this.gateway.run(run.id)
            this.commit(replaceAgentRun(this.state, current))
            continue
          } catch {
            // 启动错误仍按原始原因返回，后台水合负责恢复权威任务状态。
          }
        }
        void this.hydrateRun(run.id).catch((error) => this.captureError(error))
        return
      }
    }
  }

  private runMutation<Result>(operation: () => Promise<Result>) {
    if (this.mutation) return Promise.reject(new AgentWorkspaceControllerError('AGENT_MUTATION_IN_PROGRESS'))
    const promise = operation()
    this.mutation = promise
    void promise.then(
      () => { if (this.mutation === promise) this.mutation = null },
      () => { if (this.mutation === promise) this.mutation = null },
    )
    return promise
  }

  private captureError(error: unknown, phase: AgentWorkspaceState['phase'] = 'degraded') {
    if (this.disposed || isAbortError(error)) return
    this.commit({ ...this.state, phase, error_code: errorCode(error) })
  }

  private invalidateHydrations() {
    this.authorityVersion += 1
    this.hydrateController?.abort()
    for (const hydration of this.runHydrations.values()) hydration.controller.abort()
    this.runHydrations.clear()
    for (const controller of this.messageHydrations.values()) controller.abort()
    this.messageHydrations.clear()
    for (const hydration of this.contextHydrations.values()) hydration.controller.abort()
    this.contextHydrations.clear()
  }

  private commit(next: AgentWorkspaceState) {
    if (next === this.state) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

function lastMessageSequence(messages: AgentMessage[]) {
  return messages.reduce((maximum, message) => Math.max(maximum, message.sequence), 0)
}

function defaultClientRequestID() {
  return `agent-renderer-${crypto.randomUUID()}`
}

function errorCode(error: unknown) {
  if (error && typeof error === 'object') {
    const code = Reflect.get(error, 'code')
    if (typeof code === 'string' && code) return code
  }
  return error instanceof AgentWorkspaceControllerError ? error.code : 'AGENT_WORKSPACE_UNAVAILABLE'
}

function runtimeStartErrorCode(error: unknown) {
  const code = errorCode(error)
  if (code !== 'AGENT_WORKSPACE_UNAVAILABLE') return code
  if (error instanceof Error && error.message === 'AGENT_RUNTIME_BRIDGE_UNAVAILABLE') {
    return error.message
  }
  return 'AGENT_RUNTIME_START_FAILED'
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return errorCode(error) === 'REQUEST_ABORTED'
}

function changedContextModelSessions(
  previous: AgentWorkspaceState,
  next: AgentWorkspaceState,
) {
  const previousModels = new Map(previous.sessions.map((session) => [
    session.id,
    session.model_profile_id,
  ]))
  return next.sessions
    .filter((session) => (
      !session.archived_at
      && previousModels.has(session.id)
      && previousModels.get(session.id) !== session.model_profile_id
      && (next.selected_session_id === session.id || next.session_contexts[session.id] !== undefined)
    ))
    .map(({ id }) => id)
}

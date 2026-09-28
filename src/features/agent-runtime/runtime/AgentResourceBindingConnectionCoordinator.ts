import {
  agentResourceBindingKey,
  getAgentResourceBindingBySlot,
  isAgentResourceConnectionActive,
  type AgentResourceConnectionInput,
  type AgentResourceConnectionOperation,
  type AgentResourceConnectionView,
  type AgentSession,
} from '#entities/agent'
import { TermousApiError } from '#shared/api'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'

type ConnectionGateway = Pick<AgentWorkspaceGateway,
  'connectResourceBinding' | 'resourceBindingConnection' | 'cancelResourceBindingConnection'>

interface PendingConnectionRequest {
  input: AgentResourceConnectionInput
  sourceBindingKey: string
}

export interface AgentResourceBindingConnectionState {
  view?: AgentResourceConnectionView
  checking: boolean
  submitting: boolean
  uncertain: boolean
  reconciling: boolean
  error_code?: string
}

const emptyState: AgentResourceBindingConnectionState = {
  checking: false,
  submitting: false,
  uncertain: false,
  reconciling: false,
}

export function isAgentResourceBindingConnectionBlocking(
  state: AgentResourceBindingConnectionState | undefined,
) {
  return Boolean(state && (state.submitting || state.uncertain || state.reconciling
    || state.checking && !state.view
    || isAgentResourceConnectionActive(state.view?.operation)))
}

export class AgentResourceBindingConnectionCoordinator {
  private state: Record<string, AgentResourceBindingConnectionState> = {}
  private readonly listeners = new Set<() => void>()
  private readonly sessions = new Map<string, AgentSession>()
  private readonly pending = new Map<string, PendingConnectionRequest>()
  private readonly queries = new Map<string, AbortController>()
  private readonly queryVersions = new Map<string, number>()
  private readonly mutations = new Set<string>()
  private readonly applied = new Set<string>()
  private readonly completed = new Set<string>()
  private readonly retiredInstances = new Set<string>()
  private instanceId?: string
  private activeSessionId?: string
  private timer?: ReturnType<typeof setTimeout>
  private pollingDelay = 1000
  private disposed = false

  constructor(
    private readonly gateway: ConnectionGateway,
    private readonly onConnected: (session: AgentSession) => void,
    private readonly requestID: () => string = () => crypto.randomUUID(),
    private readonly onCompleted?: (session: AgentSession) => void,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = () => this.state

  observe(session: AgentSession | undefined, active: boolean) {
    this.disposed = false
    if (session) {
      this.rememberSession(session)
      this.updateReconciliation(session.id)
    }
    this.clearTimer()
    const previous = this.activeSessionId
    this.activeSessionId = active && session ? session.id : undefined
    if (previous !== this.activeSessionId) {
      this.queries.get(previous ?? '')?.abort()
      this.pollingDelay = 1000
    }
    if (this.activeSessionId) void this.refresh(this.activeSessionId)
  }

  async refresh(sessionId: string, duringMutation = false): Promise<AgentResourceConnectionView | undefined> {
    if (this.disposed) return
    if (this.mutations.has(sessionId) && !duringMutation) return
    this.queries.get(sessionId)?.abort()
    const controller = new AbortController()
    const version = (this.queryVersions.get(sessionId) ?? 0) + 1
    this.queryVersions.set(sessionId, version)
    this.queries.set(sessionId, controller)
    this.patch(sessionId, { checking: !this.state[sessionId]?.view })
    try {
      const request = this.pending.get(sessionId)
      const view = await this.gateway.resourceBindingConnection(
        sessionId,
        request?.input.client_request_id,
        controller.signal,
      )
      if (this.disposed || controller.signal.aborted || this.queryVersions.get(sessionId) !== version) return
      this.accept(sessionId, view, true)
      return view
    } catch (error) {
      if (!this.disposed && !controller.signal.aborted) {
        this.patch(sessionId, {
          error_code: connectionErrorCode(error, 'AGENT_RESOURCE_CONNECTION_QUERY_FAILED'),
          uncertain: !this.state[sessionId]?.view || this.pending.has(sessionId)
            || isAgentResourceConnectionActive(this.state[sessionId]?.view?.operation),
        })
      }
    } finally {
      if (this.queries.get(sessionId) === controller) {
        this.queries.delete(sessionId)
        this.patch(sessionId, { checking: false })
        this.schedule(sessionId)
      }
    }
  }

  async connect(session: AgentSession, sshProfileId: string): Promise<boolean> {
    const observedSession = this.sessions.get(session.id)
    if (observedSession && observedSession.revision > session.revision) session = observedSession
    const invocationSourceBindingKey = agentResourceBindingKey(
      getAgentResourceBindingBySlot(session.resource_bindings, 'ssh'),
    )
    this.rememberSession(session)
    if (this.disposed || this.mutations.has(session.id)) return false
    this.mutations.add(session.id)
    this.queries.get(session.id)?.abort()
    this.patch(session.id, { submitting: true, error_code: undefined })
    try {
      let request = this.pending.get(session.id)
      if (request && request.input.ssh_profile_id !== sshProfileId) return false
      const requestBeforeRefresh = request

      const baseline = await this.refresh(session.id, true)
      if (!baseline) return false
      // Core 实例切换或终态查询可能在 accept 中退休旧请求，后续只能使用当前索引。
      request = this.pending.get(session.id)
      const observed = baseline.operation
      if (request && observed?.client_request_id === request.input.client_request_id) {
        return this.acceptedRequest(session.id, request)
      }
      // 重试查询可能直接发现原请求已成功；此时不得再创建第二个连接操作。
      if (requestBeforeRefresh && observed?.client_request_id === requestBeforeRefresh.input.client_request_id
        && observed.status === 'succeeded') {
        return this.acceptedRequest(session.id, requestBeforeRefresh)
      }
      if (!request && isAgentResourceConnectionActive(observed)) return false

      const latestSession = this.sessions.get(session.id) ?? session
      const latestSourceBindingKey = agentResourceBindingKey(
        getAgentResourceBindingBySlot(latestSession.resource_bindings, 'ssh'),
      )
      if (latestSession.archived_at
        || latestSourceBindingKey !== (request?.sourceBindingKey ?? invocationSourceBindingKey)) {
        if (request) {
          this.pending.delete(session.id)
          this.patch(session.id, {
            view: undefined,
            uncertain: false,
            reconciling: false,
            error_code: 'AGENT_REVISION_CONFLICT',
          })
        }
        return false
      }
      if (!request) {
        this.clearTimer()
        this.pollingDelay = 1000
        request = {
          input: {
            kind: 'ssh_session',
            ssh_profile_id: sshProfileId,
            expected_revision: latestSession.revision,
            expected_instance_id: baseline.instance_id,
            client_request_id: this.requestID(),
          },
          sourceBindingKey: latestSourceBindingKey,
        }
        this.pending.set(session.id, request)
        // 新请求不得继续展示或重试 baseline 返回的旧终态操作。
        this.patch(session.id, {
          view: undefined,
          uncertain: false,
          reconciling: false,
          error_code: undefined,
        })
      }

      try {
        const view = await this.gateway.connectResourceBinding(session.id, request.input)
        this.accept(session.id, view)
        const acceptedOperation = this.state[session.id]?.view?.operation
        if (acceptedOperation?.instance_id === view.instance_id
          && acceptedOperation.client_request_id === request.input.client_request_id) {
          return this.acceptedRequest(session.id, request)
        }
        // 已知回执因源引用变化被拒绝时结果是确定的，不应留下永久对账门禁。
        if (!this.pending.has(session.id)) return false
        this.patch(session.id, { uncertain: true })
      } catch (error) {
        const deterministic = error instanceof TermousApiError && error.status >= 400 && error.status < 500
        if (deterministic) {
          this.pending.delete(session.id)
          this.patch(session.id, {
            uncertain: false,
            error_code: connectionErrorCode(error, 'AGENT_RESOURCE_CONNECTION_FAILED'),
          })
          return false
        }
        this.patch(session.id, {
          uncertain: true,
          error_code: connectionErrorCode(error, 'AGENT_RESOURCE_CONNECTION_FAILED'),
        })
      }

      // POST 响应不确定时立即精确查询；只有查到同一请求才向草稿消费方报告已受理。
      await this.refresh(session.id, true)
      return this.acceptedRequest(session.id, request)
    } finally {
      this.mutations.delete(session.id)
      this.patch(session.id, { submitting: false })
      this.schedule(session.id)
    }
  }

  retry(session: AgentSession): Promise<boolean> {
    const pendingRequest = this.pending.get(session.id)
    const observedSession = this.sessions.get(session.id)
    if (pendingRequest) {
      if (!sourceBindingKeyMatchesSession(pendingRequest.sourceBindingKey, session)
        || observedSession && !sourceBindingKeyMatchesSession(pendingRequest.sourceBindingKey, observedSession)) {
        this.pending.delete(session.id)
        this.patch(session.id, {
          view: undefined,
          uncertain: false,
          reconciling: false,
          error_code: undefined,
        })
        return Promise.resolve(false)
      }
      return this.connect(session, pendingRequest.input.ssh_profile_id)
    }
    const operation = this.state[session.id]?.view?.operation
    if (!operation || isAgentResourceConnectionActive(operation) || !operation.retryable) {
      return Promise.resolve(false)
    }
    if (!connectionOperationMatchesSession(operation, session)
      || observedSession && !connectionOperationMatchesSession(operation, observedSession)) {
      this.patch(session.id, {
        view: undefined,
        uncertain: false,
        reconciling: false,
        error_code: undefined,
      })
      return Promise.resolve(false)
    }
    return this.connect(session, operation.target.ssh_profile_id)
  }

  async cancel(sessionId: string): Promise<boolean> {
    if (this.disposed || this.mutations.has(sessionId)) return false
    const operation = this.state[sessionId]?.view?.operation
    if (!operation || !isAgentResourceConnectionActive(operation)) return false
    this.mutations.add(sessionId)
    this.queries.get(sessionId)?.abort()
    this.patch(sessionId, { submitting: true, error_code: undefined })
    try {
      const view = await this.gateway.cancelResourceBindingConnection(sessionId, operation.id)
      this.accept(sessionId, view)
      return true
    } catch (error) {
      const deterministic = error instanceof TermousApiError && error.status >= 400 && error.status < 500
      this.patch(sessionId, {
        error_code: connectionErrorCode(error, 'AGENT_RESOURCE_CONNECTION_CANCEL_FAILED'),
        uncertain: !deterministic,
      })
      // 取消接口可能在请求抵达前已完成或操作已过期，统一通过查询收口状态。
      void this.refresh(sessionId, true)
      return false
    } finally {
      this.mutations.delete(sessionId)
      this.patch(sessionId, { submitting: false })
      this.schedule(sessionId)
    }
  }

  dispose() {
    this.disposed = true
    this.clearTimer()
    for (const query of this.queries.values()) query.abort()
    this.queries.clear()
    this.listeners.clear()
  }

  private accept(sessionId: string, view: AgentResourceConnectionView, fromQuery = false) {
    if (this.disposed || this.retiredInstances.has(view.instance_id)) return
    if (this.instanceId && this.instanceId !== view.instance_id) {
      this.retiredInstances.add(this.instanceId)
      this.pending.clear()
      this.state = {}
    }
    this.instanceId = view.instance_id

    const request = this.pending.get(sessionId)
    const operation = view.operation
    const ownsRequest = Boolean(request && operation?.client_request_id === request.input.client_request_id)
    if (operation && !connectionOperationMatchesSession(operation, this.sessions.get(sessionId))) {
      if (ownsRequest) this.pending.delete(sessionId)
      this.patch(sessionId, {
        view: undefined,
        checking: false,
        uncertain: this.pending.has(sessionId),
        reconciling: false,
        error_code: undefined,
      })
      return
    }

    const oldOperation = this.state[sessionId]?.view?.operation
    if (oldOperation && operation?.id === oldOperation.id
      && operation.revision < oldOperation.revision) return

    if (ownsRequest && !isAgentResourceConnectionActive(operation)) this.pending.delete(sessionId)
    this.patch(sessionId, {
      view,
      checking: false,
      uncertain: Boolean(this.pending.get(sessionId) && !ownsRequest),
      error_code: operation?.error_code,
    })

    if (operation?.status !== 'succeeded' || !operation.result_session) {
      this.updateReconciliation(sessionId)
      return
    }
    const current = this.sessions.get(sessionId)
    const currentBindingKey = agentResourceBindingKey(
      getAgentResourceBindingBySlot(current?.resource_bindings, 'ssh'),
    )
    const resultBindingKey = agentResourceBindingKey(
      getAgentResourceBindingBySlot(operation.result_session.resource_bindings, 'ssh'),
    )
    const sourceBindingKey = agentResourceBindingKey(operation.source_binding ?? undefined)
    const resultIsNewer = Boolean(current && current.revision < operation.result_session.revision)
    const alreadyAtResult = currentBindingKey === resultBindingKey
    if (!current || current.archived_at
      || !alreadyAtResult && (!resultIsNewer || currentBindingKey !== sourceBindingKey)) {
      this.updateReconciliation(sessionId)
      return
    }

    const applyKey = `${view.instance_id}:${operation.id}:${operation.revision}`
    if (!this.applied.has(applyKey)) {
      this.applied.add(applyKey)
      if (resultIsNewer) {
        if (!alreadyAtResult) this.patch(sessionId, { reconciling: true })
        this.onConnected(operation.result_session)
      }
    }
    const completionKey = `${view.instance_id}:${operation.id}`
    if (ownsRequest && !this.completed.has(completionKey)
      && (!fromQuery || oldOperation?.id !== operation.id || isAgentResourceConnectionActive(oldOperation))) {
      this.completed.add(completionKey)
      this.onCompleted?.(operation.result_session)
    }
    this.updateReconciliation(sessionId)
  }

  private updateReconciliation(sessionId: string) {
    const current = this.sessions.get(sessionId)
    const operation = this.state[sessionId]?.view?.operation
    const result = operation?.status === 'succeeded' ? operation.result_session : undefined
    const currentBindingKey = agentResourceBindingKey(
      getAgentResourceBindingBySlot(current?.resource_bindings, 'ssh'),
    )
    const sourceBindingKey = agentResourceBindingKey(operation?.source_binding ?? undefined)
    const resultBindingKey = agentResourceBindingKey(
      getAgentResourceBindingBySlot(result?.resource_bindings, 'ssh'),
    )
    const reconciling = Boolean(result && current && !current.archived_at
      && current.revision < result.revision
      && currentBindingKey === sourceBindingKey && currentBindingKey !== resultBindingKey)
    if ((this.state[sessionId]?.reconciling ?? false) !== reconciling) {
      this.patch(sessionId, { reconciling })
    }
  }

  private schedule(sessionId: string) {
    if (this.disposed || this.activeSessionId !== sessionId) return
    this.clearTimer()
    const state = this.state[sessionId]
    if (!state || !state.uncertain && !state.reconciling
      && !isAgentResourceConnectionActive(state.view?.operation)) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.refresh(sessionId)
    }, this.pollingDelay)
    this.pollingDelay = 2000
  }

  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private patch(sessionId: string, patch: Partial<AgentResourceBindingConnectionState>) {
    if (this.disposed) return
    const previous = this.state[sessionId]
    const next = { ...emptyState, ...previous, ...patch }
    this.state = { ...this.state, [sessionId]: next }
    for (const listener of this.listeners) listener()
  }

  private rememberSession(session: AgentSession) {
    const current = this.sessions.get(session.id)
    if (!current || session.revision >= current.revision) this.sessions.set(session.id, session)
  }

  private acceptedRequest(sessionId: string, request: PendingConnectionRequest) {
    const session = this.sessions.get(sessionId)
    const operation = this.state[sessionId]?.view?.operation
    return Boolean(session && !session.archived_at
      && !this.retiredInstances.has(request.input.expected_instance_id)
      && operation && isAcceptedConnectionOperation(operation)
      && agentResourceBindingKey(getAgentResourceBindingBySlot(session.resource_bindings, 'ssh'))
        === request.sourceBindingKey
      && operation.instance_id === request.input.expected_instance_id
      && operation.client_request_id === request.input.client_request_id
      && connectionOperationMatchesSession(operation, session))
  }
}

function isAcceptedConnectionOperation(operation: AgentResourceConnectionOperation) {
  return operation.status === 'connecting'
    || operation.status === 'waiting_host_trust'
    || operation.status === 'succeeded'
}

function connectionOperationMatchesSession(
  operation: AgentResourceConnectionOperation,
  session: AgentSession | undefined,
) {
  // 先校验会话主键，避免仅凭空引用或资源键误接收其他会话的回执。
  if (!session || operation.session_id !== session.id
    || operation.result_session && operation.result_session.id !== session.id) return false
  const sourceBindingKey = agentResourceBindingKey(operation.source_binding ?? undefined)
  if (sourceBindingKeyMatchesSession(sourceBindingKey, session)) return true
  if (operation.status !== 'succeeded' || !operation.result_session) return false
  return sourceBindingKeyMatchesSession(
    agentResourceBindingKey(getAgentResourceBindingBySlot(operation.result_session.resource_bindings, 'ssh')),
    session,
  )
}

function sourceBindingKeyMatchesSession(sourceBindingKey: string, session: AgentSession | undefined) {
  return Boolean(session && !session.archived_at && sourceBindingKey === agentResourceBindingKey(
    getAgentResourceBindingBySlot(session.resource_bindings, 'ssh'),
  ))
}

function connectionErrorCode(error: unknown, fallback: string) {
  const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined
  return typeof code === 'string' && code ? code : fallback
}

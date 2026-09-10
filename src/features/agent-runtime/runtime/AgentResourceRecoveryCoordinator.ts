import {
  agentResourceBindingKey, getAgentResourceBinding, isAgentResourceRecoveryActive,
  type AgentResourceRecoveryInput, type AgentResourceRecoveryState, type AgentResourceRecoveryView, type AgentSession,
} from '#entities/agent'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import { TermousApiError } from '#shared/api'

type RecoveryGateway = Pick<AgentWorkspaceGateway, 'recoverResourceBinding' | 'resourceBindingRecovery' | 'cancelResourceBindingRecovery'>
type PendingRequest = { input: AgentResourceRecoveryInput; bindingKey: string; instanceId?: string }
const emptyState: AgentResourceRecoveryState = { checking: false, submitting: false, uncertain: false }

export class AgentResourceRecoveryCoordinator {
  private state: Record<string, AgentResourceRecoveryState> = {}
  private readonly listeners = new Set<() => void>()
  private readonly sessions = new Map<string, AgentSession>()
  private readonly pending = new Map<string, PendingRequest>()
  private readonly queries = new Map<string, AbortController>()
  private readonly queryVersions = new Map<string, number>()
  private readonly mutations = new Set<string>()
  private readonly dirty = new Set<string>()
  private readonly commandErrors = new Map<string, string>()
  private readonly applied = new Set<string>()
  private readonly retiredInstances = new Set<string>()
  private instanceId?: string
  private activeSessionId?: string
  private timer?: ReturnType<typeof setTimeout>
  private pollingDelay = 1000
  private disposed = false

  constructor(private readonly gateway: RecoveryGateway, private readonly onRecovered: (session: AgentSession) => void,
    private readonly requestID: () => string = () => crypto.randomUUID(),
    private readonly onCompleted?: (session: AgentSession) => void) {}

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.state

  observe(session: AgentSession | undefined, active: boolean) {
    this.disposed = false
    if (session) {
      this.sessions.set(session.id, session)
      const pending = this.pending.get(session.id)
      if (pending && pending.bindingKey !== agentResourceBindingKey(getAgentResourceBinding(session.resource_bindings, 'ssh_session'))) {
        // 引用变化不能证明旧请求未被受理；保留请求身份直到权威查询确认清理状态。
        this.patch(session.id, { uncertain: true })
      }
    }
    this.clearTimer()
    const previous = this.activeSessionId
    const recovery = session ? this.state[session.id] : undefined
    // 解绑只撤销关联，Core 仍需清理正在建立的连接；必须查询到终态才释放发送门禁。
    this.activeSessionId = active && session && (getAgentResourceBinding(session.resource_bindings, 'ssh_session')
      || recovery?.submitting || recovery?.uncertain || isAgentResourceRecoveryActive(recovery?.view?.operation)) ? session.id : undefined
    if (previous !== this.activeSessionId) {
      this.queries.get(previous ?? '')?.abort()
      this.pollingDelay = 1000
    }
    if (this.activeSessionId) void this.refresh(this.activeSessionId)
  }

  async refresh(sessionId: string, duringMutation = false): Promise<AgentResourceRecoveryView | undefined> {
    if (this.disposed) return
    if (this.mutations.has(sessionId) && !duringMutation) { this.dirty.add(sessionId); return }
    this.queries.get(sessionId)?.abort()
    const controller = new AbortController()
    const version = (this.queryVersions.get(sessionId) ?? 0) + 1
    this.queryVersions.set(sessionId, version)
    this.queries.set(sessionId, controller)
    this.patch(sessionId, { checking: !this.state[sessionId]?.view })
    try {
      const view = await this.gateway.resourceBindingRecovery(sessionId, controller.signal)
      if (this.disposed || controller.signal.aborted || this.queryVersions.get(sessionId) !== version) return
      this.accept(sessionId, view, true)
      return view
    } catch (error) {
      if (!this.disposed && !controller.signal.aborted) {
        this.patch(sessionId, { error_code: errorCode(error), uncertain: this.pending.has(sessionId) || isAgentResourceRecoveryActive(this.state[sessionId]?.view?.operation) })
      }
    } finally {
      if (this.queries.get(sessionId) === controller) {
        this.queries.delete(sessionId)
        this.patch(sessionId, { checking: false })
        this.schedule(sessionId)
      }
    }
  }

  recover(session: AgentSession): Promise<boolean> {
    this.sessions.set(session.id, session)
    let needsRefresh = !this.state[session.id]?.view || Boolean(this.state[session.id]?.error_code)
    return this.mutate(session.id, async () => {
      const binding = getAgentResourceBinding(session.resource_bindings, 'ssh_session')
      if (!binding) return false
      const bindingKey = agentResourceBindingKey(binding)
      if (this.pending.has(session.id)) {
        // 网络结果不确定时先按会话找回操作；未找到也只能重试同一个请求 ID。
        const request = this.pending.get(session.id)!
        const view = await this.refresh(session.id, true)
        if (!view) return false
        needsRefresh = false
        if (view.operation?.client_request_id === request.input.client_request_id || isAgentResourceRecoveryActive(view.operation)) return true
      }
      if (isAgentResourceRecoveryActive(this.state[session.id]?.view?.operation)) return true
      if (needsRefresh && !await this.refresh(session.id, true)) return false
      if (this.state[session.id]?.view?.can_recover === false) return false
      const request = this.pending.get(session.id) ?? {
        input: { kind: 'ssh_session' as const, expected_revision: session.revision, client_request_id: this.requestID() },
        bindingKey, instanceId: this.instanceId,
      }
      this.pending.set(session.id, request)
      const view = await this.gateway.recoverResourceBinding(session.id, request.input)
      this.accept(session.id, view)
      return true
    })
  }

  cancel(sessionId: string): Promise<boolean> {
    return this.mutate(sessionId, async () => {
      const operation = this.state[sessionId]?.view?.operation
      if (!operation || !isAgentResourceRecoveryActive(operation)) return false
      const view = await this.gateway.cancelResourceBindingRecovery(sessionId, operation.id)
      this.accept(sessionId, view)
      return true
    })
  }

  dispose() {
    this.disposed = true
    this.clearTimer()
    for (const query of this.queries.values()) query.abort()
    this.queries.clear()
    this.listeners.clear()
  }

  private async mutate(sessionId: string, operation: () => Promise<boolean>) {
    if (this.disposed || this.mutations.has(sessionId)) return false
    this.mutations.add(sessionId)
    this.commandErrors.delete(sessionId)
    this.queries.get(sessionId)?.abort()
    this.patch(sessionId, { submitting: true, error_code: undefined })
    try {
      return await operation()
    } catch (error) {
      const code = errorCode(error)
      // 业务拒绝是确定结果；传输错误仍可能已经被 Core 受理。
      const uncertain = !(error instanceof TermousApiError && error.status >= 400 && error.status < 500)
      if (!uncertain) {
        this.pending.delete(sessionId)
        this.commandErrors.set(sessionId, code)
      }
      this.patch(sessionId, { error_code: code, uncertain })
      this.dirty.add(sessionId)
      return false
    } finally {
      this.mutations.delete(sessionId)
      this.patch(sessionId, { submitting: false })
      if (this.dirty.delete(sessionId) || this.state[sessionId]?.uncertain) void this.refresh(sessionId)
      else this.schedule(sessionId)
    }
  }

  private accept(sessionId: string, view: AgentResourceRecoveryView, fromQuery = false) {
    if (this.disposed || this.retiredInstances.has(view.instance_id)) return
    if (this.instanceId && this.instanceId !== view.instance_id) {
      this.retiredInstances.add(this.instanceId)
      this.pending.clear()
      this.commandErrors.clear()
      this.state = {}
    }
    this.instanceId = view.instance_id
    const oldOperation = this.state[sessionId]?.view?.operation
    if (oldOperation && view.operation?.id === oldOperation.id && view.operation.revision < oldOperation.revision) return
    const request = this.pending.get(sessionId)
    const current = this.sessions.get(sessionId)
    const binding = getAgentResourceBinding(current?.resource_bindings, 'ssh_session')
    if (request && (view.blocked_reason === 'ready' || view.blocked_reason === 'no_binding' || view.blocked_reason === 'archived'
      || request.instanceId && request.instanceId !== view.instance_id
      || fromQuery && request.bindingKey !== agentResourceBindingKey(binding)
      || view.operation?.client_request_id === request.input.client_request_id)) this.pending.delete(sessionId)
    if (view.operation && this.commandErrors.get(sessionId) === 'AGENT_RESOURCE_RECOVERY_CONFLICT') this.commandErrors.delete(sessionId)
    this.patch(sessionId, { view, checking: false, uncertain: this.pending.has(sessionId), error_code: this.commandErrors.get(sessionId) })
    // 变更回执只保证操作结果；终态后通过 GET 重新评估当前连接是否允许再次恢复。
    if (!fromQuery && !isAgentResourceRecoveryActive(view.operation)) this.dirty.add(sessionId)
    const operation = view.operation
    if (operation?.status !== 'succeeded' || !operation.result_session) return
    const key = `${view.instance_id}:${operation.id}:${operation.revision}`
    if (this.applied.has(key)) return
    this.applied.add(key)
    const resultBinding = getAgentResourceBinding(operation.result_session.resource_bindings, 'ssh_session')
    if (current && !current.archived_at && (agentResourceBindingKey(binding) === agentResourceBindingKey(operation.source_binding)
      || agentResourceBindingKey(binding) === agentResourceBindingKey(resultBinding))) {
      this.onRecovered(operation.result_session)
      // 仅本次请求或已观察到的进行中操作触发完成反馈，历史终态只用于对账。
      if (request?.input.client_request_id === operation.client_request_id
        || oldOperation?.id === operation.id && isAgentResourceRecoveryActive(oldOperation)) {
        this.onCompleted?.(operation.result_session)
      }
    }
  }

  private schedule(sessionId: string) {
    if (this.disposed || this.activeSessionId !== sessionId) return
    this.clearTimer()
    const state = this.state[sessionId]
    if (!state || !state.uncertain && (!state.error_code || this.commandErrors.has(sessionId)) && !isAgentResourceRecoveryActive(state.view?.operation)) return
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

  private patch(sessionId: string, patch: Partial<AgentResourceRecoveryState>) {
    if (this.disposed) return
    this.state = { ...this.state, [sessionId]: { ...emptyState, ...this.state[sessionId], ...patch } }
    for (const listener of this.listeners) listener()
  }
}

function errorCode(error: unknown) {
  const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined
  return typeof code === 'string' && code ? code : 'AGENT_RESOURCE_RECOVERY_QUERY_FAILED'
}

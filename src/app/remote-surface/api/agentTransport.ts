import type { MessageInitShape } from '@bufbuild/protobuf'
import { AgentQuery_Kind as Query, type AgentRequestSchema, type AgentQuerySchema } from '@termous/remote-protocol/agent'
import { RemoteClient, RemoteError } from '#entities/remote-control'
import type { AgentWorkspaceObserver, AgentWorkspaceSubscription } from '#features/agent-runtime'

export type AgentOperation = MessageInitShape<typeof AgentRequestSchema>['operation']

export class RemoteAgentTransport {
  readonly client: RemoteClient
  private instanceId: string | undefined
  constructor(client: RemoteClient) { this.client = client }

  async call(type: string, operation: AgentOperation, signal?: AbortSignal, operationId?: string): Promise<unknown> {
    signal?.throwIfAborted()
    const result = await this.client.request({ operation: { case: 'agent', value: { operationId, expectedInstanceId: this.instanceId, operation } } })
    signal?.throwIfAborted()
    if (result.result.case !== 'agent' || result.result.value.type !== type || result.result.value.content) throw new RemoteError('remote_invalid')
    const instanceId = result.result.value.instanceId
    if (!instanceId || this.instanceId !== undefined && this.instanceId !== instanceId) throw new RemoteError('remote_agent_restarted')
    this.instanceId = instanceId
    const data = result.result.value.json
    if (!data.length || data.length > 32 * 1024 * 1024) throw new RemoteError('remote_invalid')
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) as unknown } catch { throw new RemoteError('remote_invalid') }
  }

  query(type: string, kind: Query, input: Omit<MessageInitShape<typeof AgentQuerySchema>, 'kind' | '$typeName'> = {}, signal?: AbortSignal) {
    return this.call(type, { case: 'query', value: { ...input, kind } }, signal)
  }

  async write(type: string, operation: AgentOperation, signal?: AbortSignal, operationId: string = crypto.randomUUID()) {
    try { return await this.call(type, operation, signal, operationId) } catch (error) {
      if (!(error instanceof RemoteError) || !error.uncertain) throw error
      // 回执丢失后只查询同一操作，不重放写入或自动停止任务。
      const deadline = Date.now() + 80_000
      while (Date.now() < deadline) {
        signal?.throwIfAborted()
        await new Promise(resolve => setTimeout(resolve, 1000))
        try { return await this.query(type, Query.OPERATION, { id: operationId }, signal) } catch (reason) {
          if (!(reason instanceof RemoteError) || reason.code !== 'remote_operation_uncertain') throw reason
        }
      }
      throw error
    }
  }

  subscribe(observer: AgentWorkspaceObserver): AgentWorkspaceSubscription {
    let stopped = false
    let pending = false
    let dirty = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()
    const close = () => {
      if (stopped) return
      stopped = true; abort.abort(); clearTimeout(timer); unsubscribe(); observer.close()
    }
    const refresh = async () => {
      if (stopped || pending || !dirty) return
      pending = true; dirty = false
      try {
        const snapshot = await this.query('workspace', Query.WORKSPACE, {}, abort.signal)
        if (!stopped) { observer.event(snapshot); await observer.resync() }
      } catch { if (!stopped) close() } finally {
        pending = false
        if (!stopped && dirty) timer = setTimeout(() => { timer = undefined; void refresh() }, 150)
      }
    }
    const unsubscribe = this.client.onEvent(event => {
      if (event.value.case !== 'agent') return
      dirty = true
      if (!pending && timer === undefined) timer = setTimeout(() => { timer = undefined; void refresh() }, 150)
    })
    // 先返回订阅句柄，再交付首个快照，避免同步回调覆盖连接所有权。
    queueMicrotask(() => { if (!stopped) { observer.open(); void refresh() } })
    return { close }
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RemoteError('remote_invalid')
  return value as Record<string, unknown>
}

export function revision(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RemoteError('remote_invalid')
  return BigInt(value)
}

import { WorkerCoreError, type WorkerCoreClientPort } from '../contracts/workerCore.ts'
import { isRuntimeBootstrap } from '../contracts/runtimeBootstrap.ts'
import { normalizeRuntimeResourceBindings } from '../contracts/resourceBindings.ts'
import { validRuntimeSteerInput, type RuntimeEventInput, type RuntimeSteerInput } from '../contracts/runtimeEvents.ts'
import { validOpaqueIdentifier } from '../contracts/validation.ts'
import type { AgentWorkerStartMessage } from '../contracts/protocol.ts'
import type { RuntimeAuditEvent } from '../contracts/runtimeEvents.ts'
import { isRecord, validGeneration } from '../contracts/validation.ts'
import { isRuntimeContextCheckpoint, isRuntimeCheckpointInput, type RuntimeCheckpointInput } from '../contracts/runtimeCheckpoint.ts'

const bootstrapPath = '/api/v1/agent/runtime/bootstrap'
export const agentRuntimeRequestTimeoutMs = 15_000
export const agentRuntimeBootstrapRequestTimeoutMs = 60_000

export interface WorkerCoreClientOptions {
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
  bootstrapRequestTimeoutMs?: number
}

export class WorkerCoreClient implements WorkerCoreClientPort {
  private readonly fetchImplementation: typeof globalThis.fetch
  private readonly requestTimeoutMs: number
  private readonly bootstrapRequestTimeoutMs: number

  constructor(options: WorkerCoreClientOptions = {}) {
    this.fetchImplementation = options.fetch ?? globalThis.fetch
    this.requestTimeoutMs = options.requestTimeoutMs ?? agentRuntimeRequestTimeoutMs
    this.bootstrapRequestTimeoutMs = options.bootstrapRequestTimeoutMs
      ?? agentRuntimeBootstrapRequestTimeoutMs
  }

  async bootstrap(start: AgentWorkerStartMessage, signal?: AbortSignal) {
    const value = await this.request(
      start.core_base_url,
      bootstrapPath,
      {
        method: 'POST',
        body: JSON.stringify({ ticket: start.ticket }),
      },
      undefined,
      signal,
      this.bootstrapRequestTimeoutMs,
    )
    if (!normalizeRuntimeResourceBindings(value) || !isRuntimeBootstrap(value, start)) {
      throw new WorkerCoreError('AGENT_RUNTIME_BOOTSTRAP_INVALID')
    }
    // Run 模型快照只允许在 Core 创建任务时确定，Worker 后续阶段不得改写。
    Object.freeze(value.model.snapshot)
    value.session.resource_bindings?.forEach((binding) => Object.freeze(binding))
    Object.freeze(value.session.resource_bindings)
    Object.freeze(value.session)
    return value
  }

  async appendAuditEvents(start: AgentWorkerStartMessage, runtimeBearer: string, events: RuntimeAuditEvent[], signal: AbortSignal) {
    const result = await this.request(start.core_base_url, `/api/v1/agent/runs/${encodeURIComponent(start.run_id)}/runtime-audit-events`, {
      method: 'POST', body: JSON.stringify({ generation: start.generation, events }),
    }, runtimeBearer, signal, 2_000)
    if (!isRecord(result) || result.accepted !== events.length) throw new WorkerCoreError('AGENT_AUDIT_RESPONSE_INVALID')
  }

  async appendEvents(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    events: RuntimeEventInput[],
  ) {
    if (events.length === 0 || events.length > 64) {
      throw new WorkerCoreError('AGENT_RUNTIME_EVENT_BATCH_INVALID')
    }
    const value = await this.request(
      start.core_base_url,
      `/api/v1/agent/runs/${encodeURIComponent(start.run_id)}/runtime-events`,
      {
        method: 'POST',
        body: JSON.stringify({
          generation: start.generation,
          events,
        }),
      },
      runtimeBearer,
    )
    const expectedSequence = events[events.length - 1]?.sequence
    if (!isRecord(value)
      || value.last_sequence !== expectedSequence
      || !validGeneration(value.last_sequence)) {
      throw new WorkerCoreError('AGENT_RUNTIME_EVENT_RESPONSE_INVALID')
    }
    return value.last_sequence
  }

  async appendSteer(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    input: RuntimeSteerInput,
  ) {
    if (!validRuntimeSteerInput(input)) {
      throw new WorkerCoreError('AGENT_RUNTIME_STEER_INVALID')
    }
    const value = await this.request(
      start.core_base_url,
      `/api/v1/agent/runs/${encodeURIComponent(start.run_id)}/runtime-steers`,
      {
        method: 'POST',
        body: JSON.stringify({
          generation: start.generation,
          ...input,
        }),
      },
      runtimeBearer,
    )
    if (!isRecord(value)
      || value.last_sequence !== input.sequence
      || !validGeneration(value.last_sequence)
      || !validOpaqueIdentifier(value.message_id)
      || !validOpaqueIdentifier(value.part_id)) {
      throw new WorkerCoreError('AGENT_RUNTIME_STEER_RESPONSE_INVALID')
    }
    return {
      last_sequence: value.last_sequence,
      message_id: value.message_id,
      part_id: value.part_id,
    }
  }

  async readHistoryImage(start: AgentWorkerStartMessage, runtimeBearer: string, reference: import('../contracts/runtimeCheckpoint.ts').RuntimeContextImageReference, signal?: AbortSignal) {
    const value = await this.request(start.core_base_url, `/api/v1/agent/runs/${encodeURIComponent(start.run_id)}/runtime-images`, {
      method: 'POST', body: JSON.stringify({ generation: start.generation, reference }),
    }, runtimeBearer, signal)
    if (!isRecord(value) || typeof value.data !== 'string' || typeof value.mime_type !== 'string'
      || value.mime_type !== reference.mime_type || value.data.length > 12 * 1024 * 1024) throw new WorkerCoreError('AGENT_RUNTIME_IMAGE_INVALID')
    return { data: value.data, mime_type: value.mime_type }
  }

  async commitCheckpoint(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    input: RuntimeCheckpointInput,
    signal?: AbortSignal,
  ) {
    if (!isRuntimeCheckpointInput(input, start.generation)) {
      throw new WorkerCoreError('AGENT_RUNTIME_CHECKPOINT_INVALID')
    }
    const submit = () => this.request(
      start.core_base_url,
      `/api/v1/agent/runs/${encodeURIComponent(start.run_id)}/runtime-checkpoints`,
      { method: 'POST', body: JSON.stringify(input) },
      runtimeBearer,
      signal,
    )
    let value: unknown
    try {
      value = await submit()
    } catch (error) {
      // 网络响应丢失时只重试同一个幂等请求；业务冲突和用户取消不重试。
      if (signal?.aborted || !(error instanceof WorkerCoreError) || error.status !== 0) throw error
      value = await submit()
    }
    if (!isRecord(value) || !isRuntimeContextCheckpoint(value.checkpoint)
      || value.last_sequence !== input.sequence
      || value.checkpoint.version !== 2
      || value.checkpoint.run_id !== start.run_id
      || value.checkpoint.generation !== start.generation
      || value.checkpoint.covered_event_sequence !== input.covered_event_sequence
      || value.checkpoint.summary !== input.summary) {
      throw new WorkerCoreError('AGENT_RUNTIME_CHECKPOINT_RESPONSE_INVALID')
    }
    return { checkpoint: value.checkpoint, last_sequence: input.sequence }
  }

  private async request(
    coreBaseURL: string,
    pathname: string,
    init: RequestInit,
    bearer?: string,
    signal?: AbortSignal,
    timeoutMs = this.requestTimeoutMs,
  ) {
    const baseURL = validateCoreBaseURL(coreBaseURL)
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    if (signal?.aborted) {
      controller.abort()
    } else {
      signal?.addEventListener('abort', forwardAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    try {
      const response = await this.fetchImplementation(new URL(pathname, baseURL), {
        ...init,
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
      })
      if (!response.ok) {
        throw new WorkerCoreError(await responseErrorCode(response), response.status)
      }
      return await response.json() as unknown
    } catch (error) {
      if (error instanceof WorkerCoreError) {
        throw error
      }
      throw new WorkerCoreError(
        controller.signal.aborted
          ? 'AGENT_RUNTIME_REQUEST_ABORTED'
          : 'AGENT_RUNTIME_UNAVAILABLE',
      )
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }
}

function validateCoreBaseURL(value: string) {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  const loopback = host === '127.0.0.1'
    || host === 'localhost'
    || host === '[::1]'
    || host === '::1'
  if (url.protocol !== 'http:' || !loopback || url.username || url.password || url.search || url.hash) {
    throw new WorkerCoreError('AGENT_RUNTIME_CORE_URL_INVALID')
  }
  return url
}

async function responseErrorCode(response: Response) {
  try {
    const value = await response.json() as unknown
    if (isRecord(value)) {
      if (typeof value.code === 'string' && value.code.length <= 128) {
        return value.code
      }
      if (isRecord(value.error)
        && typeof value.error.code === 'string'
        && value.error.code.length <= 128) {
        return value.error.code
      }
    }
  } catch {
    // 错误响应可能没有 JSON 正文，只返回稳定 HTTP 分类。
  }
  return `AGENT_RUNTIME_HTTP_${response.status}`
}

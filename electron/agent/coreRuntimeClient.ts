import type { CoreRuntimeConfig } from '../coreProcess'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { isRecord, validGeneration, validRunID } from './protocol.ts'

export type AgentRuntimeFailureCategory =
  | 'worker_crash'
  | 'launch_failed'
  | 'forced_stop'

export interface AgentSupervisorLease {
  core_instance_id: string
  supervisor_instance_id: string
  runtime_protocol_version: typeof agentRuntimeProtocolVersion
  revision: number
  expires_at: string
}

export interface AgentRuntimeTicket {
  ticket: string
  run_id: string
  generation: number
  core_instance_id: string
  expires_at: string
}

export interface AgentCoreRuntimePort {
  registerSupervisor(supervisorInstanceID: string): Promise<AgentSupervisorLease>
  unregisterSupervisor(supervisorInstanceID: string, expectedRevision: number): Promise<void>
  issueRuntimeTicket(
    supervisorInstanceID: string,
    runID: string,
    generation: number,
  ): Promise<AgentRuntimeTicket>
  reportRuntimeFailure(
    supervisorInstanceID: string,
    runID: string,
    generation: number,
    category: AgentRuntimeFailureCategory,
  ): Promise<void>
  currentBaseURL(): Promise<string>
}

export interface AgentCoreRuntimeClientOptions {
  getConfig: () => Promise<CoreRuntimeConfig>
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
}

export class AgentCoreRuntimeError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number) {
    super(code)
    this.name = 'AgentCoreRuntimeError'
    this.code = code
    this.status = status
  }
}

export class AgentCoreRuntimeClient implements AgentCoreRuntimePort {
  private readonly getConfig: () => Promise<CoreRuntimeConfig>
  private readonly fetchImplementation: typeof globalThis.fetch
  private readonly requestTimeoutMs: number

  constructor(options: AgentCoreRuntimeClientOptions) {
    this.getConfig = options.getConfig
    this.fetchImplementation = options.fetch ?? globalThis.fetch
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000
  }

  async registerSupervisor(supervisorInstanceID: string) {
    const value = await this.request('/api/v1/agent/runtime/supervisor', {
      method: 'PUT',
      body: JSON.stringify({
        supervisor_instance_id: supervisorInstanceID,
        runtime_protocol_version: agentRuntimeProtocolVersion,
      }),
    })
    if (!isSupervisorLease(value, supervisorInstanceID)) {
      throw new AgentCoreRuntimeError('AGENT_RUNTIME_RESPONSE_INVALID', 502)
    }
    return value
  }

  async unregisterSupervisor(supervisorInstanceID: string, expectedRevision: number) {
    await this.request('/api/v1/agent/runtime/supervisor', {
      method: 'DELETE',
      body: JSON.stringify({
        supervisor_instance_id: supervisorInstanceID,
        expected_revision: expectedRevision,
      }),
    })
  }

  async issueRuntimeTicket(
    supervisorInstanceID: string,
    runID: string,
    generation: number,
  ) {
    const value = await this.request(
      `/api/v1/agent/runs/${encodeURIComponent(runID)}/runtime-tickets`,
      {
        method: 'POST',
        body: JSON.stringify({
          supervisor_instance_id: supervisorInstanceID,
          expected_generation: generation,
        }),
      },
    )
    if (!isRuntimeTicket(value, runID, generation)) {
      throw new AgentCoreRuntimeError('AGENT_RUNTIME_RESPONSE_INVALID', 502)
    }
    return value
  }

  async reportRuntimeFailure(
    supervisorInstanceID: string,
    runID: string,
    generation: number,
    category: AgentRuntimeFailureCategory,
  ) {
    await this.request(
      `/api/v1/agent/runs/${encodeURIComponent(runID)}/runtime-failures`,
      {
        method: 'POST',
        body: JSON.stringify({
          supervisor_instance_id: supervisorInstanceID,
          generation,
          category,
        }),
      },
    )
  }

  async currentBaseURL() {
    const config = await this.getConfig()
    return validateCoreBaseURL(config.apiBaseUrl).toString()
  }

  private async request(pathname: string, init: RequestInit) {
    const config = await this.getConfig()
    const baseURL = validateCoreBaseURL(config.apiBaseUrl)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    try {
      const response = await this.fetchImplementation(new URL(pathname, baseURL), {
        ...init,
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          ...(config.apiToken ? { 'X-Termous-Token': config.apiToken } : {}),
          ...init.headers,
        },
      })
      if (!response.ok) {
        throw new AgentCoreRuntimeError(await responseErrorCode(response), response.status)
      }
      if (response.status === 204) {
        return null
      }
      return await response.json() as unknown
    } catch (error) {
      if (error instanceof AgentCoreRuntimeError) {
        throw error
      }
      throw new AgentCoreRuntimeError(
        error instanceof Error && error.name === 'AbortError'
          ? 'AGENT_RUNTIME_REQUEST_TIMEOUT'
          : 'AGENT_RUNTIME_UNAVAILABLE',
        0,
      )
    } finally {
      clearTimeout(timeout)
    }
  }
}

function validateCoreBaseURL(value: string) {
  const url = new URL(value)
  const localHost = url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
    || url.hostname === '[::1]'
    || url.hostname === '::1'
  if (url.protocol !== 'http:' || !localHost || url.username || url.password || url.search || url.hash) {
    throw new AgentCoreRuntimeError('AGENT_RUNTIME_CORE_URL_INVALID', 0)
  }
  return url
}

async function responseErrorCode(response: Response) {
  try {
    const value = await response.json() as unknown
    if (isRecord(value)) {
      const direct = value.code
      if (typeof direct === 'string' && direct.length > 0 && direct.length <= 128) {
        return direct
      }
      if (isRecord(value.error)
        && typeof value.error.code === 'string'
        && value.error.code.length > 0
        && value.error.code.length <= 128) {
        return value.error.code
      }
    }
  } catch {
    // 错误响应可能没有 JSON body，只向上层暴露稳定分类。
  }
  return `AGENT_RUNTIME_HTTP_${response.status}`
}

function isSupervisorLease(value: unknown, supervisorInstanceID: string): value is AgentSupervisorLease {
  return isRecord(value)
    && value.supervisor_instance_id === supervisorInstanceID
    && validRuntimeIdentity(value.supervisor_instance_id)
    && value.runtime_protocol_version === agentRuntimeProtocolVersion
    && validRuntimeIdentity(value.core_instance_id)
    && validGeneration(value.revision)
    && typeof value.expires_at === 'string'
    && validFutureTimestamp(value.expires_at)
}

function isRuntimeTicket(
  value: unknown,
  runID: string,
  generation: number,
): value is AgentRuntimeTicket {
  return isRecord(value)
    && value.run_id === runID
    && validRunID(value.run_id)
    && value.generation === generation
    && validGeneration(value.generation)
    && validRuntimeSecret(value.ticket)
    && validRuntimeIdentity(value.core_instance_id)
    && typeof value.expires_at === 'string'
    && validFutureTimestamp(value.expires_at)
}

function validRuntimeIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[\x21-\x7e]+$/.test(value)
}

function validRuntimeSecret(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 40
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value)
}

function validFutureTimestamp(value: string) {
  const timestamp = Date.parse(value)
  return !Number.isNaN(timestamp) && timestamp > Date.now()
}

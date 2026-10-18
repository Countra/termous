import { AgentCoreRuntimeError, validateCoreBaseURL, type AgentCoreRuntimePort, type AgentSupervisorLease, type AgentRuntimeTicket, type AgentRuntimeAllocation, type AgentRuntimeClaim, type AgentRuntimeFailureCategory } from '../contracts/supervisorCore.ts'
import type { CoreRuntimeConfig } from '../../coreProcess'
import { agentRuntimeProtocolVersion, type AgentQueuedTurnSteerRequest, type AgentSkillsBundleStatus } from '#common/contracts'
import { isRecord, validGeneration, validRunID } from '../contracts/validation.ts'
import { isAgentControlCommand, type AgentControlIdentity, type AgentControlAck } from '../contracts/controlProtocol.ts'

export interface AgentCoreRuntimeClientOptions {
  getConfig: () => Promise<CoreRuntimeConfig>
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
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

  async registerSupervisor(
    supervisorInstanceID: string,
    skillsBundle: AgentSkillsBundleStatus,
  ) {
    const value = await this.request('/api/v1/agent/runtime/supervisor', {
      method: 'PUT',
      body: JSON.stringify({
        supervisor_instance_id: supervisorInstanceID,
        runtime_protocol_version: agentRuntimeProtocolVersion,
        skills_bundle: skillsBundle,
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

  async claimNextQueuedRun(supervisorInstanceID: string, supervisorEpoch: number, claimSequence: number): Promise<AgentRuntimeClaim> {
    const value = await this.requestRecoverableMutation('/api/v1/agent/runtime/queue/claim-next', {
      method: 'POST',
      body: JSON.stringify({ supervisor_instance_id: supervisorInstanceID, supervisor_epoch: supervisorEpoch, claim_sequence: claimSequence }),
    })
    if (!isRecord(value) || !Number.isInteger(value.max_concurrent_runs) || Number(value.max_concurrent_runs) < 1 || Number(value.max_concurrent_runs) > 8
      || !Number.isInteger(value.occupied_slots) || Number(value.occupied_slots) < 0 || Number(value.occupied_slots) > 8) {
      throw new AgentCoreRuntimeError('AGENT_RUNTIME_RESPONSE_INVALID', 502)
    }
    const capacity = { max_concurrent_runs: Number(value.max_concurrent_runs), occupied_slots: Number(value.occupied_slots) }
    if (value.run === null) return { ...capacity, allocation: null }
    if (!isCoreRun(value.run) || typeof value.execution_id !== 'string' || !value.execution_id || !validRunID(value.session_id)) {
      throw new AgentCoreRuntimeError('AGENT_RUNTIME_RESPONSE_INVALID', 502)
    }
    return { ...capacity, allocation: { run_id: value.run.id, generation: value.run.generation, execution_id: value.execution_id, session_id: value.session_id } }
  }

  async releaseExecution(supervisorInstanceID: string, supervisorEpoch: number, allocation: AgentRuntimeAllocation) {
    await this.requestRecoverableMutation('/api/v1/agent/runtime/executions/release', {
      method: 'POST',
      body: JSON.stringify({ supervisor_instance_id: supervisorInstanceID, supervisor_epoch: supervisorEpoch,
        execution_id: allocation.execution_id, run_id: allocation.run_id, generation: allocation.generation }),
    })
  }

  async steerQueuedTurn(request: AgentQueuedTurnSteerRequest) {
    const value = await this.requestRecoverableMutation(
      `/api/v1/agent/queued-turns/${encodeURIComponent(request.queued_turn_id)}/steer`,
      {
        method: 'POST',
        body: JSON.stringify({
          expected_revision: request.expected_revision,
          active_run_id: request.run_id,
          expected_generation: request.generation,
          expected_run_revision: request.expected_run_revision,
        }),
      },
    )
    if (!isQueuedTurnSteerResult(value, request)) {
      throw new AgentCoreRuntimeError('AGENT_RUNTIME_RESPONSE_INVALID', 502)
    }
    return {
      queued_turn: value.queued_turn,
      run: {
        run_id: value.run.id,
        generation: value.run.generation,
        revision: value.run.revision,
      },
    }
  }

  async issueRuntimeTicket(
    supervisorInstanceID: string,
    runID: string,
    generation: number,
    executionID: string,
  ) {
    const value = await this.request(
      `/api/v1/agent/runs/${encodeURIComponent(runID)}/runtime-tickets`,
      {
        method: 'POST',
        body: JSON.stringify({
          supervisor_instance_id: supervisorInstanceID,
          expected_generation: generation,
          execution_id: executionID,
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

  private async requestRecoverableMutation(pathname: string, init: RequestInit) {
    try {
      return await this.request(pathname, init)
    } catch (error) {
      if (!isRetryableRuntimeTransportError(error)) {
        throw error
      }
      // Core 对这两个写接口提供幂等恢复，响应丢失时重试不会重复派发或重复中断。
      return this.request(pathname, init)
    }
  }

  async pollControl(identity: AgentControlIdentity, signal: AbortSignal) {
    const value = await this.request('/api/v1/agent/runtime/control/poll', { method: 'POST', body: JSON.stringify(identity), signal }, 25_000)
    if (value === null) return null
    if (!isAgentControlCommand(value)) throw new AgentCoreRuntimeError('AGENT_RUNTIME_RESPONSE_INVALID', 502)
    return value
  }

  async ackControl(input: AgentControlAck, signal: AbortSignal) {
    await this.request('/api/v1/agent/runtime/control/ack', { method: 'POST', body: JSON.stringify(input), signal })
  }

  private async request(pathname: string, init: RequestInit, timeoutMs = this.requestTimeoutMs) {
    const config = await this.getConfig()
    const baseURL = validateCoreBaseURL(config.apiBaseUrl)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await this.fetchImplementation(new URL(pathname, baseURL), {
        ...init,
        cache: 'no-store',
        redirect: 'error',
        signal: init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal,
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

function isRetryableRuntimeTransportError(error: unknown) {
  return error instanceof AgentCoreRuntimeError
    && error.status === 0
    && (error.code === 'AGENT_RUNTIME_REQUEST_TIMEOUT'
      || error.code === 'AGENT_RUNTIME_UNAVAILABLE')
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
    && validGeneration(value.supervisor_epoch)
    && Number.isInteger(value.max_concurrent_runs) && Number(value.max_concurrent_runs) >= 1 && Number(value.max_concurrent_runs) <= 8
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

function isCoreRun(value: unknown): value is { id: string; generation: number } {
  return isRecord(value)
    && validRunID(value.id)
    && validGeneration(value.generation)
}

function isCoreRunWithRevision(
  value: unknown,
): value is { id: string; generation: number; revision: number } {
  return isRecord(value)
    && validRunID(value.id)
    && validGeneration(value.generation)
    && validGeneration(value.revision)
}

function isQueuedTurnSteerResult(
  value: unknown,
  request: AgentQueuedTurnSteerRequest,
): value is {
    queued_turn: { id: string; revision: number }
    run: { id: string; generation: number; revision: number }
  } {
  return isRecord(value)
    && isRecord(value.queued_turn)
    && value.queued_turn.id === request.queued_turn_id
    && validRunID(value.queued_turn.id)
    && validGeneration(value.queued_turn.revision)
    && isCoreRunWithRevision(value.run)
    && value.run.id === request.run_id
    && value.run.generation === request.generation
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

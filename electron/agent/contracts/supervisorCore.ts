import { agentRuntimeProtocolVersion, type AgentQueuedTurnSteerRequest, type AgentRuntimeRunRef, type AgentSkillsBundleStatus } from '#common/contracts'
import type { AgentControlCommand, AgentControlIdentity, AgentControlAck } from './controlProtocol.ts'

export type AgentRuntimeFailureCategory =
  | 'worker_crash'
  | 'launch_failed'
  | 'forced_stop'

export interface AgentSupervisorLease {
  supervisor_epoch: number
  max_concurrent_runs: number
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

export interface AgentQueuedTurnSteerResult {
  queued_turn: {
    id: string
    revision: number
  }
  run: AgentRuntimeRunRef & {
    revision: number
  }
}

export interface AgentRuntimeAllocation extends AgentRuntimeRunRef {
  execution_id: string
  session_id: string
}

export interface AgentRuntimeClaim {
  allocation: AgentRuntimeAllocation | null
  max_concurrent_runs: number
  occupied_slots: number
}

export interface AgentCoreRuntimePort {
  pollControl?(identity: AgentControlIdentity, signal: AbortSignal): Promise<AgentControlCommand | null>
  ackControl?(input: AgentControlAck, signal: AbortSignal): Promise<void>
  registerSupervisor(
    supervisorInstanceID: string,
    skillsBundle: AgentSkillsBundleStatus,
  ): Promise<AgentSupervisorLease>
  unregisterSupervisor(supervisorInstanceID: string, expectedRevision: number): Promise<void>
  claimNextQueuedRun(supervisorInstanceID: string, supervisorEpoch: number, claimSequence: number): Promise<AgentRuntimeClaim>
  releaseExecution(supervisorInstanceID: string, supervisorEpoch: number, allocation: AgentRuntimeAllocation): Promise<void>
  steerQueuedTurn(request: AgentQueuedTurnSteerRequest): Promise<AgentQueuedTurnSteerResult>
  issueRuntimeTicket(
    supervisorInstanceID: string,
    runID: string,
    generation: number,
    executionID: string,
  ): Promise<AgentRuntimeTicket>
  reportRuntimeFailure(
    supervisorInstanceID: string,
    runID: string,
    generation: number,
    category: AgentRuntimeFailureCategory,
  ): Promise<void>
  currentBaseURL(): Promise<string>
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

export function validateCoreBaseURL(value: string) {
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

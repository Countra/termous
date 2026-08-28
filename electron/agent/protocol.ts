import { agentRuntimeProtocolVersion } from '#common/contracts'

export interface AgentWorkerStartMessage {
  type: 'start'
  protocol_version: typeof agentRuntimeProtocolVersion
  core_base_url: string
  ticket: string
  run_id: string
  generation: number
}

export interface AgentWorkerAbortMessage {
  type: 'abort'
  run_id: string
  generation: number
}

export interface AgentWorkerSteerMessage {
  type: 'steer'
  run_id: string
  generation: number
  message: string
}

export type AgentWorkerInboundMessage =
  | AgentWorkerStartMessage
  | AgentWorkerAbortMessage
  | AgentWorkerSteerMessage

export interface AgentWorkerStartedMessage {
  type: 'started'
  protocol_version: typeof agentRuntimeProtocolVersion
  run_id: string
  generation: number
}

export interface AgentWorkerSettledMessage {
  type: 'settled'
  protocol_version: typeof agentRuntimeProtocolVersion
  run_id: string
  generation: number
  outcome: 'completed' | 'cancelled' | 'failed'
}

export interface AgentWorkerFatalMessage {
  type: 'fatal'
  protocol_version: typeof agentRuntimeProtocolVersion
  run_id: string
  generation: number
  category: 'bootstrap_failed' | 'runtime_failed'
}

export type AgentWorkerOutboundMessage =
  | AgentWorkerStartedMessage
  | AgentWorkerSettledMessage
  | AgentWorkerFatalMessage

export function isAgentWorkerOutboundMessage(value: unknown): value is AgentWorkerOutboundMessage {
  if (!isRecord(value)
    || value.protocol_version !== agentRuntimeProtocolVersion
    || !validRunID(value.run_id)
    || !validGeneration(value.generation)) {
    return false
  }
  if (value.type === 'started') {
    return true
  }
  if (value.type === 'settled') {
    return value.outcome === 'completed'
      || value.outcome === 'cancelled'
      || value.outcome === 'failed'
  }
  return value.type === 'fatal'
    && (value.category === 'bootstrap_failed' || value.category === 'runtime_failed')
}

export function validRunID(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value)
}

export function validGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


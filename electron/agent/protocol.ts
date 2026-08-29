import { agentRuntimeProtocolVersion } from '#common/contracts'
import type { AgentSkillBundleSnapshot } from './skillBundle.ts'
import { isAgentSkillBundleSnapshot } from './skillBundle.ts'

export interface AgentWorkerStartMessage {
  type: 'start'
  protocol_version: typeof agentRuntimeProtocolVersion
  core_base_url: string
  ticket: string
  run_id: string
  generation: number
  skills: AgentSkillBundleSnapshot
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
  client_request_id: string
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

export interface AgentWorkerSteerAckMessage {
  type: 'steer_ack'
  protocol_version: typeof agentRuntimeProtocolVersion
  run_id: string
  generation: number
  client_request_id: string
  accepted: boolean
  error_code?: string
}

export type AgentWorkerOutboundMessage =
  | AgentWorkerStartedMessage
  | AgentWorkerSettledMessage
  | AgentWorkerFatalMessage
  | AgentWorkerSteerAckMessage

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
  if (value.type === 'steer_ack') {
    return validClientRequestID(value.client_request_id)
      && typeof value.accepted === 'boolean'
      && (value.accepted
        ? value.error_code === undefined
        : validErrorCode(value.error_code))
  }
  return value.type === 'fatal'
    && (value.category === 'bootstrap_failed' || value.category === 'runtime_failed')
}

export function validAgentWorkerStartMessage(value: unknown): value is AgentWorkerStartMessage {
  return isRecord(value)
    && value.type === 'start'
    && value.protocol_version === agentRuntimeProtocolVersion
    && validRunID(value.run_id)
    && validGeneration(value.generation)
    && typeof value.core_base_url === 'string'
    && typeof value.ticket === 'string'
    && value.ticket.length >= 40
    && value.ticket.length <= 128
    && isAgentSkillBundleSnapshot(value.skills)
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

export function validClientRequestID(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value)
}

function validErrorCode(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[A-Z][A-Z0-9_]+$/.test(value)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

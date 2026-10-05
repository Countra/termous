import type { AgentRuntimeCommandResult } from '#common/contracts'
import { isRecord, validGeneration, validRunID } from './protocol.ts'

export interface AgentControlCommand {
  id: string
  action: 'start' | 'stop' | 'steer' | 'wake'
  run_id?: string
  generation?: number
  message?: string
}
export interface AgentControlIdentity {
  supervisor_instance_id: string
  core_instance_id: string
}
export type AgentControlAck = AgentControlIdentity & Pick<AgentRuntimeCommandResult, 'accepted' | 'error_code'> & { id: string }

export function isAgentControlCommand(value: unknown): value is AgentControlCommand {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.id)) return false
  if (value.action === 'wake') return !value.run_id && !value.generation && !value.message
  if (!['start', 'stop', 'steer'].includes(String(value.action)) || !validRunID(value.run_id) || !validGeneration(value.generation)) return false
  return value.action !== 'steer' || (typeof value.message === 'string' && value.message.trim().length > 0 && Buffer.byteLength(value.message) <= 1 << 20)
}

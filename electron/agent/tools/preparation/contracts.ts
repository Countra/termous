import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { RuntimeResourceBinding } from '../../contracts/resourceBindings.ts'
import { isMCPToolDetails } from '../../contracts/mcpTools.ts'
import { isRecord } from '../../contracts/validation.ts'
import type { PreparedCall } from '../../contracts/toolPreparation.ts'
import type { ToolRecovery, ToolRecoveryKind } from '../../contracts/toolRecovery.ts'
import type { DesktopObservationState } from '../../contracts/desktopObservation.ts'
export type { PreparedCall } from '../../contracts/toolPreparation.ts'

export type Arguments = Record<string, unknown>
export interface PreparationContext {
  name: string
  bindings: RuntimeResourceBinding[]
  desktop?: DesktopObservationState
  signal?: AbortSignal
  has(field: string): boolean
  invoke(name: string, args: Arguments, step: string): Promise<Arguments>
  read(key: string): Arguments | undefined
  remember(key: string, value: Arguments): void
  forget(key: string): void
  lookup(toolCallID: string, step: string): Promise<PreparedCall | undefined>
}

export class PreparationStopped extends Error {
  readonly result: AgentToolResult<unknown>
  constructor(result: AgentToolResult<unknown>) { super('AGENT_TOOL_PREPARATION_STOPPED'); this.result = result }
}

export function fail(code: string, message: string, recovery: ToolRecoveryKind | ToolRecovery = 'correct_parameters', extra: Arguments = {}): never {
  const body = { error: { code, message, retryable: false, execution: {
    ...extra, phase: 'preparation', dispatch: 'not_started', recovery: typeof recovery === 'string' ? { kind: recovery } : recovery,
  } } }
  const content = [{ type: 'text' as const, text: JSON.stringify(body) }]
  throw new PreparationStopped({ content, details: { kind: 'mcp', originalToolName: '', result: { isError: true, content, structuredContent: body } } })
}

export function body(result: AgentToolResult<unknown>): Arguments {
  if (!isMCPToolDetails(result.details)) fail('AGENT_TOOL_RESPONSE_INVALID', 'The tool returned no trusted structured receipt.', 'user_action')
  const output = result.details.result.structuredContent
  if (result.details.result.isError || isRecord(output) && output.error) throw new PreparationStopped(result)
  if (!isRecord(output)) fail('AGENT_TOOL_RESPONSE_INVALID', 'The tool returned no structured receipt.', 'user_action')
  return output
}

export function item(value: unknown, field: string): Arguments {
  if (!isRecord(value)) fail('AGENT_TOOL_RESPONSE_INVALID', `Missing ${field} in the trusted receipt.`, 'user_action')
  return value
}

export function unique(values: Arguments[], field: string): Arguments {
  if (values.length !== 1) fail('AGENT_TARGET_SELECTION_REQUIRED', `Choose an explicit ${field}; no unique verified target is available.`, 'correct_parameters', {
    candidates: values.slice(0, 20).map((v) => ({ id: v.id, name: v.name ?? v.host_name, profile_id: v.profile_id ?? v.ssh_profile_id ?? v.file_access_profile_id })),
  })
  return values[0]
}

export function rows(value: unknown): Arguments[] { return Array.isArray(value) ? value.filter(isRecord) : [] }
export function defaultValue(args: Arguments, field: string, value: unknown) { if (args[field] === undefined && value !== undefined) args[field] = value }
export function toolProperties(tool: AgentTool): Arguments { const schema: unknown = tool.parameters; return isRecord(schema) && isRecord(schema.properties) ? schema.properties : {} }

export async function delay(signal?: AbortSignal) {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, 500)
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

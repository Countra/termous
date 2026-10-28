import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { isMCPToolDetails } from '../../contracts/mcpTools.ts'
import { isRecord } from '../../contracts/validation.ts'
import type { PreparationContext } from '../preparation/contracts.ts'

export function observationRecovery(ctx: Pick<PreparationContext, 'bindings' | 'desktop'>) {
  const selected = ctx.desktop?.selected() || ctx.bindings.some(value => ['host_desktop', 'desktop_session', 'desktop_profile'].includes(value.kind))
  return selected ? { kind: 'reread' as const, tool: 'termous.desktops.capture', arguments: {} }
    : { kind: 'reread' as const, tool: 'termous.desktops.attach' }
}

// MCP 的恢复参数面向外部调用；内置准备层只投影已知适配，不删除任意字段后冒充完整调用。
export function projectManagedRecovery(result: AgentToolResult<unknown>, ctx: PreparationContext, callID: string): AgentToolResult<unknown> {
  if (!isMCPToolDetails(result.details)) return result
  const output = result.details.result.structuredContent
  if (!isRecord(output)) return result
  const key = isRecord(output.operation) ? 'operation' : isRecord(output.run) && ctx.name.startsWith('termous.desktops.') ? 'run' : 'error'
  const value = output[key]
  if (!isRecord(value)) return result
  const execution = isRecord(value.execution) ? value.execution : undefined
  const recovery = execution && isRecord(execution.recovery) ? execution.recovery : undefined
  let projectedRecovery = recovery
  let message = value.message
  if (recovery?.tool === 'termous.desktops.operations.get') projectedRecovery = { ...recovery, arguments: { tool_call_id: callID } }
  if (recovery?.tool === 'termous.desktops.executions.get' && ctx.name === 'termous.desktops.execute') projectedRecovery = { ...recovery, arguments: { tool_call_id: callID } }
  const recoverable = (!execution || execution.dispatch === 'not_started')
    && (!recovery || ['reread', 'correct_parameters'].includes(String(recovery.kind)))
  const genericAttachment = !recovery?.tool || recovery.tool === 'termous.desktops.attach' && recovery.arguments === undefined
  const localBinding = value.code === 'AGENT_RESOURCE_BINDING_MISMATCH' && ctx.name === 'termous.desktops.get' && execution?.required_tool
  if (key === 'error' && recoverable && ctx.name.startsWith('termous.desktops.')
    && (genericAttachment && ['desktop_generation_stale', 'AGENT_OBSERVATION_REQUIRED'].includes(String(value.code)) || localBinding)) {
    projectedRecovery = observationRecovery(ctx)
    message = `${String(value.message ?? '')} The current attachment is unavailable; get cannot create or restore an attachment. `
      + (projectedRecovery.tool === 'termous.desktops.capture' ? 'Use termous.desktops.capture({}) to verify the selected target and prepare observation.'
        : 'Use termous.desktops.sources for a host target or termous.desktops.list for a protocol session, then termous.desktops.attach with the verified target.')
      + ' Do not replay old input or reuse old screenshots; control follows existing approval.'
  }
  if (!projectedRecovery || projectedRecovery === recovery) return result
  const projected = { ...output, [key]: { ...value, ...(message !== undefined ? { message } : {}), execution: {
    ...(execution ?? { phase: 'observation', dispatch: 'not_started' }), recovery: projectedRecovery,
  } } }
  const content = [{ type: 'text' as const, text: JSON.stringify(projected) }, ...result.content.filter(block => block.type !== 'text')]
  return { ...result, content, details: { ...result.details, result: { ...result.details.result, content, structuredContent: projected } } }
}

import { isRecord } from '../../contracts/validation.ts'
import type { ToolRecoveryKind } from '../../contracts/toolRecovery.ts'

const kinds = new Set(['wait', 'reread', 'correct_parameters', 'approval', 'query_operation', 'user_action', 'none'])
const guidance: Record<string, string> = {
  wait: 'Wait for the reported condition using the original resource. Do not resubmit the business action.',
  reread: 'Read the current resource or observe the current desktop. Re-evaluate changes before a new action.',
  correct_parameters: 'Correct the indicated business parameters or choose an explicit target.',
  approval: 'Resolve the existing approval. Do not create another approval request.',
  query_operation: 'Query the original operation or task. Do not replay an uncertain action.',
  user_action: 'User intervention is required. Do not seize control, reconnect, or change request IDs to bypass it.',
  none: 'No automatic recovery is available.',
}

export function executionRecovery(data: Record<string, unknown>) {
  const report = isRecord(data.report) ? data.report : data
  const value = isRecord(data.error) ? data.error.execution : isRecord(report.run) ? report.run.execution : isRecord(data.operation) ? data.operation.execution : undefined
  if (!isRecord(value) || typeof value.phase !== 'string' || !['not_started', 'dispatched', 'unknown'].includes(String(value.dispatch))
    || !isRecord(value.recovery) || !kinds.has(String(value.recovery.kind))) return undefined
  const kind = String(value.recovery.kind) as ToolRecoveryKind
  return { kind, phase: value.phase, dispatch: value.dispatch,
    tool: typeof value.recovery.tool === 'string' ? value.recovery.tool : undefined,
    arguments: isRecord(value.recovery.arguments) ? value.recovery.arguments : undefined,
    guidance: [isRecord(data.error) && typeof data.error.message === 'string' ? data.error.message : '', guidance[kind]].filter(Boolean).join(' '),
  }
}

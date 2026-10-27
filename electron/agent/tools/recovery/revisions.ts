import type { ToolRecovery } from '../../contracts/toolRecovery.ts'
import type { Arguments } from '../preparation/contracts.ts'
import type { ToolNavigation } from './contracts.ts'
import { isRecord } from '../../contracts/validation.ts'

export function revisionRecovery(name: string, args: Arguments): ToolRecovery {
  if (name.startsWith('termous.desktop_workflows.') && typeof args.script_id === 'string') return {
    kind: 'reread', tool: 'termous.desktop_workflows.get', arguments: { script_id: args.script_id },
  }
  if (name.startsWith('termous.snippets.groups.')) return typeof args.group_id === 'string'
    ? { kind: 'reread', tool: 'termous.snippets.groups.get', arguments: { group_id: args.group_id } }
    : { kind: 'reread', tool: 'termous.snippets.groups.list', arguments: {} }
  if (name.startsWith('termous.snippets.') && typeof args.snippet_id === 'string') return {
    kind: 'reread', tool: 'termous.snippets.get', arguments: { snippet_id: args.snippet_id },
  }
  if (name.startsWith('termous.remoteops.crontab.')) return {
    kind: 'reread', tool: 'termous.remoteops.crontab.get', arguments: typeof args.session_id === 'string' ? { session_id: args.session_id } : {},
  }
  return { kind: 'reread' }
}

export function previewRecovery(name: string, args: Arguments): ToolRecovery {
  const tool = ({ 'termous.files.delete.start': 'termous.files.delete.preview', 'termous.files.batch_rename.start': 'termous.files.batch_rename.preview' } as Record<string, string>)[name]
  return tool ? { kind: 'reread', tool, arguments: Object.fromEntries(Object.entries(args)
    .filter(([field]) => !['client_request_id', 'expected_plan_hash', 'expected_connection_generation'].includes(field))) } : { kind: 'reread' }
}

// 只采用已定义的版本冲突码；通用 conflict 也可能来自审批或输入争用，不能据此建议重新提交。
export function revisionConflictNavigation(name: string, code: unknown, input: unknown): ToolNavigation | undefined {
  if (!isRecord(input)) return undefined
  let recovery: ToolRecovery | undefined
  if (code === 'desktop_workflow_revision_conflict' && name.startsWith('termous.desktop_workflows.')
    || code === 'CRONTAB_CONFLICT' && name.startsWith('termous.remoteops.crontab.')) recovery = revisionRecovery(name, input)
  if (code === 'SFTP_TEXT_CONFLICT' && name === 'termous.files.save_text') recovery = {
    kind: 'reread', tool: 'termous.files.read_text', arguments: { file_session_id: input.file_session_id, path: input.path },
  }
  if (code === 'SFTP_DELETE_CONFLICT' && name === 'termous.files.delete.start'
    || code === 'SFTP_BATCH_RENAME_CONFLICT' && name === 'termous.files.batch_rename.start') recovery = previewRecovery(name, input)
  if (!recovery?.tool) return undefined
  return { names: [recovery.tool], recovery: true,
    guidance: `The original resource or preview changed. Repeating ${name} with the old version cannot resolve the conflict. Use ${recovery.tool}, compare its result with the intended change, then decide whether a new action is appropriate; do not automatically overwrite or resubmit.`,
    ...(recovery.arguments ? { prerequisite: { tool: recovery.tool, arguments: recovery.arguments } } : {}),
  }
}

export const agentDetachedCommands = [
  "workspace.onCreateSession",
  "workspace.onSelectSession",
  "workspace.onReturnToActiveRun",
  "workspace.onArchiveSession",
  "workspace.onDeleteSession",
  "workspace.onModelChange",
  "workspace.onReasoningChange",
  "workspace.onResetResponseOptions",
  "workspace.onOpenSettings",
  "workspace.onDraftChange",
  "workspace.onRemoveAttachment",
  "workspace.onRetryAttachment",
  "workspace.onExecuteSlashCommand",
  "workspace.onCancelProfileConnection",
  "workspace.onRetryProfileConnection",
  "workspace.onDismissProfileConnection",
  "workspace.onSend",
  "workspace.onStop",
  "workspace.onContextCompressionPendingChange",
  "workspace.onRetryContext",
  "workspace.onQueueTurn",
  "workspace.onBeginQueuedTurnEdit",
  "workspace.onQueuedTurnEditChange",
  "workspace.onRemoveQueuedTurnEditAttachment",
  "workspace.onSaveQueuedTurnEdit",
  "workspace.onCancelQueuedTurnEdit",
  "workspace.onDeleteQueuedTurn",
  "workspace.onMoveQueuedTurn",
  "workspace.onSteerQueuedTurn",
  "workspace.onResumeQueue",
  "workspace.onRetryUsage",
  "workspace.onApprovalModeChange",
  "workspace.onReplaceResourceBinding",
  "workspace.onRecoverResourceBinding",
  "workspace.onCancelResourceRecovery",
  "workspace.onRemoveResourceBinding",
  "archive.onClose",
  "archive.onQueryChange",
  "archive.onSelect",
  "archive.onReload",
  "archive.onReloadPreview",
  "archive.onRestore",
  "archive.onDelete",
  "readiness.onRefresh",
  "readiness.onPrepare",
  "reference.onConfirm",
  "reference.onRetry",
  "reference.onDismiss",
  "reference.onOpenSettings",
  "management.onSearchQueryChange",
  "management.onSearchRetry",
  "management.onRename",
  "management.onPin",
  "management.onMoveToGroup",
  "management.onCreateGroup",
  "management.onRenameGroup",
  "management.onDeleteGroup",
  "management.onMoveGroup",
  "management.onMovePin",
  "management.onMoveSession",
  "management.onOpenArchives",
  "surface.onRetry",
  "surface.onRefreshSetup",
  "feedback.answer",
  "feedback.dismiss"
] as const
export type AgentDetachedCommandName = typeof agentDetachedCommands[number]
export interface AgentDetachedCommand { name: AgentDetachedCommandName; args: unknown[]; inputSequence?: number; owner?: string }

const text = (value: unknown) => typeof value === 'string' && value.length <= 512 * 1024
const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 256
const optionalId = (value: unknown) => value === undefined || value === null || id(value)
const bool = (value: unknown) => typeof value === 'boolean'
const ids = (value: unknown) => Array.isArray(value) && value.length <= 8 && value.every(id)
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const placement = (value: unknown) => value === 'before' || value === 'after'
const singleIdCommands = new Set<AgentDetachedCommandName>([
  'workspace.onSelectSession', 'workspace.onArchiveSession', 'workspace.onDeleteSession', 'workspace.onModelChange',
  'workspace.onRemoveAttachment', 'workspace.onRetryAttachment', 'workspace.onBeginQueuedTurnEdit',
  'workspace.onRemoveQueuedTurnEditAttachment', 'workspace.onDeleteQueuedTurn', 'workspace.onSteerQueuedTurn',
  'management.onDeleteGroup',
])
const noArgumentCommands = new Set<AgentDetachedCommandName>([
  'workspace.onReturnToActiveRun', 'workspace.onResetResponseOptions', 'workspace.onOpenSettings', 'workspace.onStop',
  'workspace.onRetryContext', 'workspace.onCancelQueuedTurnEdit', 'workspace.onResumeQueue', 'workspace.onRetryUsage',
  'workspace.onRecoverResourceBinding', 'workspace.onCancelResourceRecovery', 'workspace.onCancelProfileConnection',
  'workspace.onRetryProfileConnection', 'workspace.onDismissProfileConnection', 'archive.onClose', 'archive.onReload',
  'archive.onReloadPreview', 'readiness.onRefresh', 'readiness.onPrepare', 'reference.onConfirm', 'reference.onRetry',
  'reference.onDismiss', 'reference.onOpenSettings', 'management.onSearchRetry', 'management.onOpenArchives', 'surface.onRetry', 'surface.onRefreshSetup',
])
const resourceKinds = ['ssh_session', 'ssh_profile', 'file_profile', 'desktop_session', 'desktop_profile', 'desktop_workflow']

function resourceReference(value: unknown) {
  if (!record(value) || !resourceKinds.includes(String(value.kind))) return false
  switch (value.kind) {
    case 'ssh_session': return id(value.session_id)
    case 'ssh_profile': return id(value.ssh_profile_id)
    case 'file_profile': return id(value.file_access_profile_id)
    case 'desktop_profile': return id(value.desktop_profile_id)
    case 'desktop_workflow': return id(value.workflow_id) && Number.isSafeInteger(value.workflow_version)
    case 'desktop_session': return id(value.session_id) && Number.isSafeInteger(value.connection_generation) && Number(value.connection_generation) > 0
    default: return false
  }
}

export function isAgentDetachedCommand(value: unknown): value is AgentDetachedCommand {
  if (!record(value) || !agentDetachedCommands.includes(value.name as AgentDetachedCommandName) || !Array.isArray(value.args)) return false
  if (value.inputSequence !== undefined && (!Number.isSafeInteger(value.inputSequence) || Number(value.inputSequence) < 1)) return false
  const input = value.name === 'workspace.onDraftChange' || value.name === 'workspace.onQueuedTurnEditChange'
  if (input !== (value.inputSequence !== undefined)) return false
  if (value.owner !== undefined && !id(value.owner)) return false
  const args = value.args
  if (args.length > 3) return false
  const [a, b, c] = args
  switch (value.name) {
    case 'workspace.onDraftChange': case 'workspace.onQueuedTurnEditChange':
    case 'archive.onQueryChange': case 'management.onSearchQueryChange': case 'management.onCreateGroup': return args.length === 1 && text(a)
    case 'workspace.onSend': case 'workspace.onQueueTurn': return args.length === 2 && text(a) && ids(b)
    case 'workspace.onSaveQueuedTurnEdit': return args.length === 1 && ids(a)
    case 'workspace.onCreateSession': case 'archive.onSelect': return args.length <= 1 && optionalId(a)
    case 'workspace.onContextCompressionPendingChange': return args.length === 1 && bool(a)
    case 'workspace.onApprovalModeChange': return args.length === 1 && ['review', 'bypass'].includes(String(a))
    case 'workspace.onReasoningChange': return args.length === 1 && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(a))
    case 'management.onRename': case 'management.onRenameGroup': return args.length === 2 && id(a) && text(b)
    case 'management.onPin': case 'feedback.answer': return args.length === 2 && id(a) && bool(b)
    case 'feedback.dismiss': return args.length === 2 && id(a) && id(b)
    case 'management.onMoveToGroup': return id(a) && optionalId(b) && (c === undefined || bool(c))
    case 'management.onMoveGroup': case 'management.onMovePin': case 'management.onMoveSession':
    case 'workspace.onMoveQueuedTurn': return args.length === 3 && id(a) && id(b) && placement(c)
    case 'archive.onRestore': case 'archive.onDelete': return args.length === 1 && record(a) && id(a.id) && Number.isSafeInteger(a.revision)
    case 'workspace.onRemoveResourceBinding': return args.length === 1 && resourceKinds.includes(String(a))
    case 'workspace.onReplaceResourceBinding': return args.length === 1 && resourceReference(a) && safeJSON(a)
    case 'workspace.onExecuteSlashCommand': return args.length === 1 && record(a) && record(a.capture) && id(a.capture.owner) && ['compact', 'session', 'profile', 'workflow'].includes(String(a.command_id)) && safeJSON(a)
    default: return noArgumentCommands.has(value.name as AgentDetachedCommandName) ? args.length === 0
      : singleIdCommands.has(value.name as AgentDetachedCommandName) && args.length === 1 && id(a)
  }
}

function safeJSON(value: unknown, depth = 0): boolean {
  if (depth > 12) return false
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return true
  if (typeof value === 'string') return value.length <= 512 * 1024
  if (Array.isArray(value)) return value.length <= 100 && value.every(item => safeJSON(item, depth + 1))
  return record(value) && Object.keys(value).length <= 100 && Object.entries(value).every(([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && safeJSON(item, depth + 1))
}

export interface AgentDetachedFile { name: string; type: string; lastModified: number; bytes: ArrayBuffer }
export type AgentDetachedBinary = { kind: 'attach'; files: AgentDetachedFile[]; owner: string }
  | { kind: 'local'; clientId: string }
  | { kind: 'attachment' | 'image'; source: Record<string, unknown> }

export function canTransferAgentDetachedFiles(files: readonly { name: string; type: string; lastModified: number; size: number }[]) {
  if (!files.length || files.length > 8) return false
  let total = 0
  return files.every(file => {
    total += file.size
    return id(file.name) && typeof file.type === 'string' && file.type.length <= 100
      && Number.isFinite(file.lastModified) && Number.isSafeInteger(file.size)
      && file.size > 0 && file.size <= 10 * 1024 * 1024 && total <= 20.5 * 1024 * 1024
  })
}

export function isAgentDetachedBinary(value: unknown): value is AgentDetachedBinary {
  if (!record(value)) return false
  if (value.kind === 'attach') {
    if (!id(value.owner) || !Array.isArray(value.files) || value.files.length > 8
      || !value.files.every(file => record(file) && file.bytes instanceof ArrayBuffer)) return false
    return canTransferAgentDetachedFiles(value.files.map(file => ({ ...file, size: file.bytes.byteLength })))
  }
  if (value.kind === 'local') return id(value.clientId)
  if (!record(value.source)) return false
  if (value.kind === 'attachment') return id(value.source.id)
  return value.kind === 'image' && id(value.source.session_id) && id(value.source.message_id)
    && id(value.source.part_id) && Number.isSafeInteger(value.source.content_index) && Number(value.source.content_index) >= 0
    && Number.isSafeInteger(value.source.revision) && Number(value.source.revision) >= 0
}

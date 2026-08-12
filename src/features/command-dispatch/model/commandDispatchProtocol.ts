import type {
  CommandDispatchInputLock,
  CommandDispatchOutputAttachedEvent,
  CommandDispatchOutputEndedEvent,
  CommandDispatchOutputGapEvent,
  CommandDispatchOutputGapReason,
  CommandDispatchOutputStream,
  CommandDispatchScope,
  CommandDispatchTarget,
  CommandDispatchTargetStatus,
  CommandDispatchTask,
  CommandDispatchTaskEvent,
  CommandDispatchTaskStatus,
} from '#entities/command-dispatch'

export class CommandDispatchProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandDispatchProtocolError'
  }
}

export type CommandDispatchOutputControlEvent =
  | CommandDispatchOutputAttachedEvent
  | CommandDispatchOutputGapEvent
  | CommandDispatchOutputEndedEvent

const taskStatuses = new Set<CommandDispatchTaskStatus>([
  'queued',
  'validating',
  'running',
  'interrupting',
  'completed',
  'partial_failed',
  'failed',
  'interrupted',
])
const targetStatuses = new Set<CommandDispatchTargetStatus>([
  'queued',
  'validating',
  'running',
  'interrupting',
  'succeeded',
  'failed',
  'interrupted',
  'rejected',
  'disconnected',
  'uncertain',
  'completed_unknown',
])
const scopes = new Set<CommandDispatchScope>(['current', 'selected', 'all'])
const gapReasons = new Set<CommandDispatchOutputGapReason>([
  'epoch_mismatch',
  'buffer_evicted',
  'offset_ahead',
])
const maximumUint64 = (1n << 64n) - 1n

export function decodeCommandDispatchTask(value: unknown): CommandDispatchTask {
  const task = requireRecord(value, '命令发送任务快照缺失')
  return {
    id: requireString(task.id, '命令发送任务 ID 缺失'),
    client_request_id: requireString(task.client_request_id, '命令发送请求 ID 缺失'),
    revision: requireNonNegativeInteger(task.revision, '命令发送任务 revision 无效'),
    scope: requireEnum(task.scope, scopes, '命令发送范围无效'),
    command: requireString(task.command, '命令发送内容缺失', true),
    status: requireEnum(task.status, taskStatuses, '命令发送任务状态无效'),
    status_message: optionalString(task.status_message),
    target_session_ids: requireStringArray(task.target_session_ids, '命令目标会话无效'),
    targets: requireArray(task.targets, '命令目标快照无效').map(decodeTarget),
    total_targets: requireNonNegativeInteger(task.total_targets, '命令目标总数无效'),
    completed_targets: requireNonNegativeInteger(task.completed_targets, '命令已完成目标数无效'),
    succeeded_targets: requireNonNegativeInteger(task.succeeded_targets, '命令成功目标数无效'),
    failed_targets: requireNonNegativeInteger(task.failed_targets, '命令失败目标数无效'),
    interrupted_targets: requireNonNegativeInteger(task.interrupted_targets, '命令中断目标数无效'),
    rejected_targets: requireNonNegativeInteger(task.rejected_targets, '命令拒绝目标数无效'),
    unknown_targets: requireNonNegativeInteger(task.unknown_targets, '命令未知目标数无效'),
    interruptible: requireBoolean(task.interruptible, '命令任务中断能力无效'),
    created_at: requireString(task.created_at, '命令任务创建时间缺失'),
    started_at: optionalString(task.started_at),
    finished_at: optionalString(task.finished_at),
    error_code: optionalString(task.error_code),
    error_message: optionalString(task.error_message),
  }
}

export function decodeCommandDispatchTaskEvent(value: unknown): CommandDispatchTaskEvent | null {
  const event = optionalRecord(value)
  if (
    !event
    || (event.type !== 'command_dispatch_task_snapshot'
      && event.type !== 'command_dispatch_task_update')
  ) {
    return null
  }
  return {
    type: event.type,
    task: decodeCommandDispatchTask(event.task),
  }
}

export function decodeCommandDispatchOutputControl(
  value: unknown,
): CommandDispatchOutputControlEvent | null {
  const event = optionalRecord(value)
  if (!event || typeof event.type !== 'string') {
    return null
  }
  switch (event.type) {
    case 'output_attached':
      return {
        type: event.type,
        task_id: requireString(event.task_id, '命令输出任务 ID 缺失'),
        session_id: requireString(event.session_id, '命令输出会话 ID 缺失'),
        target: decodeTarget(event.target),
        stream: decodeOutputStream(event.stream),
        // gap_reason 仅用于兼容联调早期协议，canonical 字段为 reason。
        reason: optionalGapReason(event.reason ?? event.gap_reason),
        // 兼容运行中首帧因 omitempty 省略 ended；终态会显式为 true。
        ended: event.ended === undefined
          ? false
          : requireBoolean(event.ended, '命令输出结束状态无效'),
      }
    case 'output_gap':
      return {
        type: event.type,
        reason: requireEnum(event.reason, gapReasons, '命令输出缺口原因无效'),
        stream: decodeOutputStream(event.stream),
      }
    case 'output_ended':
      return {
        type: event.type,
        target: decodeTarget(event.target),
        stream: decodeOutputStream(event.stream),
      }
    default:
      return null
  }
}

function decodeTarget(value: unknown): CommandDispatchTarget {
  const target = requireRecord(value, '命令目标快照缺失')
  const exitCode = optionalInteger(target.exit_code, '命令退出码无效')
  return {
    session_id: requireString(target.session_id, '命令目标会话 ID 缺失'),
    session_name: optionalString(target.session_name),
    host_id: optionalString(target.host_id),
    host_name: optionalString(target.host_name),
    endpoint: optionalString(target.endpoint),
    index: requireNonNegativeInteger(target.index, '命令目标序号无效'),
    status: requireEnum(target.status, targetStatuses, '命令目标状态无效'),
    status_message: optionalString(target.status_message),
    exit_code: exitCode,
    exit_code_known: requireBoolean(target.exit_code_known, '命令退出码状态无效'),
    input_lock: decodeInputLock(target.input_lock),
    output_stream: decodeOutputStream(target.output_stream),
    error_code: optionalString(target.error_code),
    error_message: optionalString(target.error_message),
    started_at: optionalString(target.started_at),
    finished_at: optionalString(target.finished_at),
  }
}

function decodeInputLock(value: unknown): CommandDispatchInputLock {
  const inputLock = requireRecord(value, '命令目标输入锁缺失')
  const owner = optionalString(inputLock.owner)
  if (owner !== undefined && owner !== 'command_dispatch') {
    throw new CommandDispatchProtocolError('命令目标输入锁 owner 无效')
  }
  return {
    locked: requireBoolean(inputLock.locked, '命令目标输入锁状态无效'),
    owner,
    task_id: optionalString(inputLock.task_id),
    locked_at: optionalString(inputLock.locked_at),
  }
}

function decodeOutputStream(value: unknown): CommandDispatchOutputStream {
  const stream = requireRecord(value, '命令输出流快照缺失')
  const epoch = requireString(stream.epoch, '命令输出流 epoch 缺失', true).toLowerCase()
  if (epoch && !/^[0-9a-f]{32}$/.test(epoch)) {
    throw new CommandDispatchProtocolError('命令输出流 epoch 无效')
  }
  const oldestOffset = requireOffset(stream.oldest_offset, '命令输出流 oldest_offset 无效')
  const nextOffset = requireOffset(stream.next_offset, '命令输出流 next_offset 无效')
  const resumeOffset = requireOffset(stream.resume_offset, '命令输出流 resume_offset 无效')
  if (BigInt(oldestOffset) > BigInt(resumeOffset) || BigInt(resumeOffset) > BigInt(nextOffset)) {
    throw new CommandDispatchProtocolError('命令输出流游标顺序无效')
  }
  return {
    epoch,
    oldest_offset: oldestOffset,
    next_offset: nextOffset,
    resume_offset: resumeOffset,
    truncated: requireBoolean(stream.truncated, '命令输出流截断状态无效'),
  }
}

function optionalGapReason(value: unknown) {
  return value === undefined
    ? undefined
    : requireEnum(value, gapReasons, '命令输出缺口原因无效')
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  const record = optionalRecord(value)
  if (!record) {
    throw new CommandDispatchProtocolError(message)
  }
  return record
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requireArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new CommandDispatchProtocolError(message)
  }
  return value
}

function requireString(value: unknown, message: string, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new CommandDispatchProtocolError(message)
  }
  return value
}

function optionalString(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  return requireString(value, '命令发送可选字符串无效')
}

function requireStringArray(value: unknown, message: string) {
  const items = requireArray(value, message)
  if (!items.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new CommandDispatchProtocolError(message)
  }
  return items as string[]
}

function requireBoolean(value: unknown, message: string) {
  if (typeof value !== 'boolean') {
    throw new CommandDispatchProtocolError(message)
  }
  return value
}

function requireNonNegativeInteger(value: unknown, message: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new CommandDispatchProtocolError(message)
  }
  return Number(value)
}

function optionalInteger(value: unknown, message: string) {
  if (value === undefined || value === null) {
    return undefined
  }
  if (!Number.isSafeInteger(value)) {
    throw new CommandDispatchProtocolError(message)
  }
  return Number(value)
}

function requireOffset(value: unknown, message: string) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || value.length > 20) {
    throw new CommandDispatchProtocolError(message)
  }
  if (BigInt(value) > maximumUint64) {
    throw new CommandDispatchProtocolError(message)
  }
  return value
}

function requireEnum<Value extends string>(
  value: unknown,
  values: ReadonlySet<Value>,
  message: string,
): Value {
  if (typeof value !== 'string' || !values.has(value as Value)) {
    throw new CommandDispatchProtocolError(message)
  }
  return value as Value
}

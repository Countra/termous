import { posix, win32 } from 'node:path'
import { createHash } from 'node:crypto'
import type { LocalToolContext } from '../contracts/localTools.ts'
import { isRecord } from '../contracts/validation.ts'

const taskFields = ['id', 'status', 'error_code', 'error_message', 'reason', 'exit_code', 'stdout_bytes', 'stderr_bytes', 'stored_stdout', 'stored_stderr']
const fileFields = ['path', 'working_directory', 'directory_revision']

function fields(value: unknown, names: readonly string[]) {
  if (!isRecord(value)) return {}
  return Object.fromEntries(names.flatMap(name => {
    const item = value[name]
    return typeof item === 'string' && item.length <= 32768 || typeof item === 'number' && Number.isSafeInteger(item)
      || typeof item === 'boolean' ? [[name, item]] : []
  }))
}

function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

function outputEvidence(value: Record<string, unknown>) {
  const result = fields(value, ['offset', 'next_offset', 'total_bytes', 'truncated', 'invalid_utf8'])
  if (typeof value.text === 'string') result.text_sha256 = digest(value.text)
  if (isRecord(value.tail) && typeof value.tail.text === 'string') {
    result.tail = { ...fields(value.tail, ['offset']), text_sha256: digest(value.tail.text) }
  }
  return result
}

// 仅由本地适配器调用；文件正文和命令输出不会进入恢复证据。
export function localToolResultWithContext(result: unknown, args: unknown, context: LocalToolContext) {
  if (!isRecord(result)) return result
  const value = isRecord(result.value) ? result.value : result
  const details = isRecord(result.error) && isRecord(result.error.details) ? result.error.details : undefined
  const path = typeof details?.path === 'string' ? details.path : value.path
  const paths = context.environment.platform === 'windows' || context.environment.platform === 'win32' ? win32 : posix
  if (typeof path !== 'string' || !paths.isAbsolute(path)) return result
  const relative = isRecord(args) && typeof args.path === 'string' && !paths.isAbsolute(args.path)
  return { ...result, local_file: { path: paths.normalize(path), ...(relative ? {
    working_directory: context.directory.path, directory_revision: context.directory.revision,
  } : {}) } }
}

// 实时回执与历史回放共用轻量投影，不保留正文、Base64 或完整任务规格。
export function projectLocalToolResult(result: unknown): Record<string, unknown> {
  if (!isRecord(result)) return {}
  const value = isRecord(result.value) ? result.value : result
  // calls.get 的命令回执多包一层 receipt；只取既有事实，不把正文解释成回执。
  const receipt = isRecord(value.receipt) ? value.receipt : value
  const data = { ...fields(result, ['state', 'call_id']), ...fields(value, ['path', 'task_id', 'sha256', 'size_bytes', 'offset', 'next_offset', 'truncated', 'text_sha256', 'image_sha256', 'limited', 'scanned', 'skipped']) }
  if (isRecord(result.error)) {
    const error = fields(result.error, ['code', 'message'])
    const details = fields(result.error.details, ['path', 'expected_type', 'actual_type'])
    Object.assign(data, { error: { ...error, ...(Object.keys(details).length ? { details } : {}) } })
  } else if (typeof receipt.error === 'string') {
    Object.assign(data, { error: { message: receipt.error.slice(0, 32768) } })
  }
  // 原调用的派发状态优先于内部错误说明，恢复查询不能丢失“不确定、不得重放”的结论。
  if (result.state === 'uncertain') Object.assign(data, { error: {
    ...(isRecord(data.error) ? data.error : {}), code: 'LOCAL_TOOL_UNCERTAIN',
  } })
  // 正文只保留指纹，防止内容变化被误判为重复观察，也不复制大文本。
  if (typeof value.text === 'string') Object.assign(data, { text_sha256: createHash('sha256').update(value.text).digest('hex') })
  if (isRecord(value.image_resource) && typeof value.image_resource.sha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(value.image_resource.sha256)) Object.assign(data, { image_sha256: value.image_resource.sha256 })
  if (isRecord(receipt.task)) Object.assign(data, { task: fields(receipt.task, taskFields) })
  for (const stream of ['stdout', 'stderr']) if (isRecord(value[stream])) Object.assign(data, { [stream]: outputEvidence(value[stream]) })
  for (const collection of ['entries', 'matches']) if (Array.isArray(value[collection])) {
    Object.assign(data, { [`${collection}_count`]: value[collection].length, [`${collection}_sha256`]: digest(value[collection]) })
  }
  if (typeof value.cursor === 'string') Object.assign(data, { cursor_sha256: digest(value.cursor) })
  if (isRecord(result.local_file) && typeof result.local_file.path === 'string') {
    Object.assign(data, { local_file: fields(result.local_file, fileFields) })
  }
  return data
}

export function localToolResultFailed(data: Record<string, unknown>) {
  return isRecord(data.error) || ['denied', 'not_dispatched', 'uncertain'].includes(String(data.state))
    || isRecord(data.task) && ['failed', 'timed_out', 'uncertain', 'not_dispatched'].includes(String(data.task.status))
}

export function localFileEvidence(data: Record<string, unknown>) {
  const file = isRecord(data.local_file) ? data.local_file : undefined
  if (!file || typeof file.path !== 'string' || file.path.length > 32768
    || !(win32.isAbsolute(file.path) || posix.isAbsolute(file.path))) return undefined
  if (file.working_directory !== undefined && (typeof file.working_directory !== 'string'
    || !Number.isSafeInteger(file.directory_revision))) return undefined
  return fields(file, fileFields)
}

import { StringDecoder } from 'node:string_decoder'
import type {
  CoreStartupFailure,
  DatabaseStartupState,
} from '#common/contracts'

export const coreStartupPrefix = '@termous/startup '
const maxLineLength = 16_384
const databaseRoles = ['live', 'staged', 'rollback']
const failureCodes = [
  'DB_VERSION_TOO_NEW', 'DB_LEGACY_UNSUPPORTED', 'DB_HISTORY_INVALID',
  'DB_SCHEMA_INVALID', 'DB_MIGRATION_FAILED', 'DB_OPEN_FAILED',
  'CORE_BIND_FAILED', 'CORE_START_FAILED',
]

export interface CoreStartupEvent {
  protocol: 1
  instanceId: string
  pid: number
  sequence: number
  at: string
  phase: 'starting' | 'database' | 'services' | 'failed'
  database?: DatabaseStartupState
  error?: CoreStartupFailure
  coreVersion?: string
  heartbeat?: boolean
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isEnum(value: unknown, values: readonly string[]) {
  return typeof value === 'string' && values.includes(value)
}

function isText(value: unknown, max: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
    && !Array.from(value).some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 && code !== 9 && code !== 10 && code !== 13
    })
}

export function sanitizeCoreStartupText(value: string, maxLength = 4096) {
  return Array.from(value).filter((character) => {
    const code = character.charCodeAt(0)
    return code >= 32 || code === 9 || code === 10 || code === 13
  }).join('')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|api[_-]?token|password|secret|authorization|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]')
    .trim().slice(0, maxLength)
}

function isVersion(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isTimestamp(value: unknown) {
  return typeof value === 'string' && value.length <= 40
    && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
}

function optionalFieldsValid(
  value: Record<string, unknown>,
  validators: Record<string, (field: unknown) => boolean>,
) {
  return Object.entries(validators).every(([key, validate]) => value[key] === undefined || validate(value[key]))
}

function isDatabase(value: unknown): value is DatabaseStartupState {
  return isObject(value)
    && hasOnlyKeys(value, ['status', 'operation', 'fromVersion', 'targetVersion', 'confirmedVersion', 'startedAt', 'completedAt', 'role'])
    && isEnum(value.status, ['checking', 'unchanged', 'running', 'completed', 'failed'])
    && optionalFieldsValid(value, {
      operation: (field) => isEnum(field, ['initialize', 'adopt', 'upgrade']),
      role: (field) => isEnum(field, databaseRoles),
      fromVersion: isVersion,
      targetVersion: isVersion,
      confirmedVersion: isVersion,
      startedAt: isTimestamp,
      completedAt: isTimestamp,
    })
}

function isFailure(value: unknown): value is CoreStartupFailure {
  return isObject(value)
    && hasOnlyKeys(value, ['code', 'message', 'details', 'migrationVersion', 'migrationFile', 'fromVersion', 'targetVersion', 'confirmedVersion', 'databaseRole'])
    && isEnum(value.code, failureCodes)
    && isText(value.message, 2048)
    && optionalFieldsValid(value, {
      details: (field) => isText(field, 4096),
      migrationFile: (field) => isText(field, 256) && !/[\\/\r\n]/.test(field as string),
      migrationVersion: isVersion,
      fromVersion: isVersion,
      targetVersion: isVersion,
      confirmedVersion: isVersion,
      databaseRole: (field) => isEnum(field, databaseRoles),
    })
}

export function parseCoreStartupEvent(line: string): CoreStartupEvent | null {
  if (!line.startsWith(coreStartupPrefix) || line.length > maxLineLength) return null
  let value: unknown
  try {
    value = JSON.parse(line.slice(coreStartupPrefix.length))
  } catch {
    return null
  }
  if (!isObject(value)
    || !hasOnlyKeys(value, ['protocol', 'instanceId', 'pid', 'sequence', 'at', 'phase', 'database', 'error', 'coreVersion', 'heartbeat'])
    || value.protocol !== 1
    || typeof value.instanceId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(value.instanceId)
    || !Number.isSafeInteger(value.pid) || (value.pid as number) <= 0
    || !Number.isSafeInteger(value.sequence) || (value.sequence as number) <= 0
    || !isTimestamp(value.at)
    || !isEnum(value.phase, ['starting', 'database', 'services', 'failed'])
    || !optionalFieldsValid(value, {
      database: isDatabase,
      error: isFailure,
      coreVersion: (field) => isText(field, 64),
      heartbeat: (field) => typeof field === 'boolean',
    })
    || (value.phase === 'failed') !== (value.error !== undefined)
    || (value.database && (value.database as DatabaseStartupState).status === 'failed' && value.phase !== 'failed')
  ) return null
  const event = value as unknown as CoreStartupEvent
  if (event.error) {
    event.error.message = sanitizeCoreStartupText(event.error.message, 2048)
    if (event.error.details) event.error.details = sanitizeCoreStartupText(event.error.details)
  }
  return event
}

export class CoreStartupEventParser {
  private readonly decoder = new StringDecoder('utf8')
  private pending = ''
  private discarding = false
  private ended = false
  private readonly onEvent: (event: CoreStartupEvent) => void
  private readonly onInvalid?: (reason: 'invalid_message' | 'oversized_message') => void
  private invalidReported = false

  constructor(
    onEvent: (event: CoreStartupEvent) => void,
    onInvalid?: (reason: 'invalid_message' | 'oversized_message') => void,
  ) {
    this.onEvent = onEvent
    this.onInvalid = onInvalid
  }

  write(chunk: Buffer | string) {
    if (!this.ended) this.consume(typeof chunk === 'string' ? chunk : this.decoder.write(chunk))
  }

  end() {
    if (this.ended) return
    this.consume(this.decoder.end())
    if (!this.discarding && this.pending) this.emit(this.pending)
    this.pending = ''
    this.ended = true
  }

  private consume(text: string) {
    let offset = 0
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset)
      const end = newline === -1 ? text.length : newline
      if (!this.discarding) {
        if (this.pending.length + end - offset > maxLineLength) {
          if ((this.pending + text.slice(offset, offset + coreStartupPrefix.length)).startsWith(coreStartupPrefix)) {
            this.reportInvalid('oversized_message')
          }
          // 丢弃整条超长行直到换行，不能将其尾部重新解释为可信事件。
          this.pending = ''
          this.discarding = true
        } else {
          this.pending += text.slice(offset, end)
        }
      }
      if (newline !== -1) {
        if (!this.discarding) this.emit(this.pending.replace(/\r$/, ''))
        this.pending = ''
        this.discarding = false
      }
      offset = end + 1
    }
  }

  private emit(line: string) {
    const event = parseCoreStartupEvent(line)
    if (event) this.onEvent(event)
    else if (line.startsWith(coreStartupPrefix)) this.reportInvalid('invalid_message')
  }

  private reportInvalid(reason: 'invalid_message' | 'oversized_message') {
    // 每个进程最多报告一次协议异常，既保留诊断信号，也避免异常输出灌满日志。
    if (this.invalidReported) return
    this.invalidReported = true
    this.onInvalid?.(reason)
  }
}

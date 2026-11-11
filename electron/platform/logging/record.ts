export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
export const maxRecordBytes = 16 * 1024
export interface LogRecord { line: string; bytes: number; level: LogLevel }

function text(value: string) {
  return value.slice(0, 1024)
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
    .replace(/((?:password|secret|authorization|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]')
}

// 仅复制有限的自有数据属性，不调用 getter、toJSON 或保留业务对象引用。
function snapshot(value: unknown, depth: number, budget: { left: number }): unknown {
  if (--budget.left < 0 || depth > 3) return '[omitted]'
  if (typeof value === 'string') return text(value)
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    const result: unknown[] = []
    for (let index = 0; index < Math.min(16, value.length) && budget.left > 0; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      result.push(descriptor && 'value' in descriptor ? snapshot(descriptor.value, depth + 1, budget) : null)
    }
    return result
  }
  const result: Record<string, unknown> = {}
  let count = 0
  for (const key in value) {
    if (count++ >= 16 || budget.left <= 0) break
    if (key.length > 64) continue
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) continue
    Object.defineProperty(result, key, { enumerable: true, value: sensitive(key) ? '[redacted]' : snapshot(descriptor.value, depth + 1, budget) })
  }
  return result
}

function sensitive(key: string) {
  return /(?:^|[_-])(?:password|passphrase|secret|credential|authorization|cookie|token|api[_-]?key|private[_-]?key)$/i.test(key)
}

export function createRecord(level: LogLevel, event: string, fields: Record<string, unknown>): LogRecord {
  const parts = [JSON.stringify({ timestamp: new Date().toISOString(), event: text(event), level }).slice(0, -1)]
  const budget = { left: 128 }
  let bytes = Buffer.byteLength(parts[0]) + 32
  let count = 0
  for (const key in fields) {
    if (count++ >= 64 || budget.left <= 0) break
    if (key === 'timestamp' || key === 'event' || key === 'level' || key.length > 64) continue
    const descriptor = Object.getOwnPropertyDescriptor(fields, key)
    if (!descriptor || !('value' in descriptor)) continue
    const value = sensitive(key) ? '[redacted]' : snapshot(descriptor.value, 0, budget)
    if (value === undefined) continue
    const part = `,${JSON.stringify(key)}:${JSON.stringify(value)}`
    bytes += Buffer.byteLength(part)
    if (bytes > maxRecordBytes - 64) { parts.push(',"truncated":true'); break }
    parts.push(part)
  }
  const line = `[termous:electron] ${parts.join('')}}\n`
  return { line, bytes: Buffer.byteLength(line), level }
}

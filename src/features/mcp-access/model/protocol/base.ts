export class McpAccessProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpAccessProtocolError'
  }
}

export function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function requireRecord(value: unknown, message: string) {
  const record = optionalRecord(value)
  if (!record) throw new McpAccessProtocolError(message)
  return record
}

export function requireArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw new McpAccessProtocolError(message)
  return value
}

export function optionalArray(value: unknown, message: string): unknown[] {
  return value === undefined || value === null ? [] : requireArray(value, message)
}

export function optionalStringArray(value: unknown, message: string) {
  return optionalArray(value, message).map((item) => requireString(item, message))
}

export function requireString(value: unknown, message: string) {
  if (typeof value !== 'string' || value.length === 0) throw new McpAccessProtocolError(message)
  return value
}

export function optionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function requireBoolean(value: unknown, message: string) {
  if (typeof value !== 'boolean') throw new McpAccessProtocolError(message)
  return value
}

export function optionalBoolean(value: unknown, message: string) {
  return value === undefined || value === null ? undefined : requireBoolean(value, message)
}

export function requireNonNegativeInteger(value: unknown, message: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new McpAccessProtocolError(message)
  return Number(value)
}

export function optionalNonNegativeInteger(value: unknown, message: string) {
  return value === undefined || value === null
    ? undefined
    : requireNonNegativeInteger(value, message)
}

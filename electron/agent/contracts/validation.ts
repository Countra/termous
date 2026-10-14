export function validRunID(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value)
}

export function validGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 三个入口使用同一标识格式，保留各协议字段的语义名称。
export { validRunID as validClientRequestID, validRunID as validOpaqueIdentifier }

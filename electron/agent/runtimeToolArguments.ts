import type { JsonObject } from '@earendil-works/pi-ai'
import { isRecord } from './protocol.ts'

export function isRuntimeToolArguments(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false
  // 显式栈避免深层 JSON 耗尽调用栈；只拒绝祖先环，允许重复引用同一个合法对象。
  const ancestors = new Set<object>()
  const pending: Array<{ value: unknown } | { leave: object }> = [{ value }]
  while (pending.length > 0) {
    const frame = pending.pop()!
    if ('leave' in frame) {
      ancestors.delete(frame.leave)
      continue
    }
    const item = frame.value
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) return false
      continue
    }
    if (typeof item !== 'object' || ancestors.has(item)) return false
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype
      && Object.getPrototypeOf(item) !== null) return false
    ancestors.add(item)
    pending.push({ leave: item })
    // 数组按元素迭代，使稀疏项与显式 undefined 一样被拒绝。
    for (const child of Array.isArray(item) ? item : Object.values(item)) {
      pending.push({ value: child })
    }
  }
  return true
}

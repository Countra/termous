import { isRecord } from './validation.ts'

export interface RuntimeProviderUsage {
  last_part_id: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  context_fingerprint: string
}

export function isRuntimeProviderUsage(value: unknown): value is RuntimeProviderUsage {
  if (!isRecord(value) || typeof value.last_part_id !== 'string' || value.last_part_id.length === 0
    || value.last_part_id.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(value.last_part_id)
    || typeof value.context_fingerprint !== 'string'
    || !/^[0-9a-f]{64}$/u.test(value.context_fingerprint)) return false
  return validContextTokenCounts([value.input_tokens, value.output_tokens, value.cache_read_tokens, value.cache_write_tokens, value.total_tokens])
}

export function hasValidRuntimeProviderTokens(value: unknown): boolean {
  if (!isRecord(value)) return false
  return validContextTokenCounts([value.input, value.output, value.cacheRead, value.cacheWrite, value.totalTokens])
}

function validContextTokenCounts(counts: unknown[]) {
  if (!counts.every((count) => Number.isSafeInteger(count) && Number(count) >= 0)) return false
  // 与 pi 保持一致：正 total 优先；total 为零时才使用分项合计。
  const total = Number(counts[4]) || counts.slice(0, 4).reduce<number>((sum, count) => sum + Number(count), 0)
  return Number.isSafeInteger(total) && total > 0
}

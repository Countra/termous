import { createHash } from 'node:crypto'
import type { Api, AssistantMessage, Model, Tool, Usage } from '@earendil-works/pi-ai'
import { isRecord } from './protocol.ts'

export interface RuntimeProviderUsage {
  last_part_id: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  context_fingerprint: string
}

export function runtimeContextFingerprint(
  model: Model<Api>, systemPrompt: string, tools: Tool[], providerID: string, modelID: string,
) {
  // 仅对请求的固定上下文和模型身份签名，不包含凭据；工具或资源绑定变化后不能复用旧用量。
  const value = {
    providerID, modelID, api: model.api, model: model.id, baseURL: model.baseUrl,
    contextWindow: model.contextWindow, systemPrompt,
    tools: [...tools].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
  }
  return createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) =>
    isRecord(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item,
  )).digest('hex')
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

export function runtimeProviderUsage(
  message: AssistantMessage, lastPartID: string | undefined, fingerprint: string,
): RuntimeProviderUsage | undefined {
  if (!lastPartID || message.stopReason === 'error' || message.stopReason === 'aborted') return undefined
  const value = {
    last_part_id: lastPartID, context_fingerprint: fingerprint,
    input_tokens: message.usage.input, output_tokens: message.usage.output,
    cache_read_tokens: message.usage.cacheRead, cache_write_tokens: message.usage.cacheWrite,
    total_tokens: message.usage.totalTokens,
  }
  return isRuntimeProviderUsage(value) ? value : undefined
}

export function restoreRuntimeProviderUsage(value: RuntimeProviderUsage): Usage {
  // 历史用量只供 pi 计算活动窗口，不重新计入本轮费用。
  return {
    input: value.input_tokens, output: value.output_tokens,
    cacheRead: value.cache_read_tokens, cacheWrite: value.cache_write_tokens,
    totalTokens: value.total_tokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

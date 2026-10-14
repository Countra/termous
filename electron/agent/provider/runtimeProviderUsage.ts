import { isRuntimeProviderUsage, type RuntimeProviderUsage } from '../contracts/providerUsageContract.ts'
import { createHash } from 'node:crypto'
import type { Api, AssistantMessage, Model, Tool, Usage } from '@earendil-works/pi-ai'
import { isRecord } from '../contracts/validation.ts'

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

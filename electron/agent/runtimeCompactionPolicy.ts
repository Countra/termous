import {
  createCompactionSummaryMessage,
  convertToLlm,
  estimateContextTokens,
  estimateTokens,
  type AgentMessage,
  type CompactionSettings,
  type Entry,
  type JsonValue,
} from '@earendil-works/pi-agent-core'
import type { Api, Model, Tool, Usage } from '@earendil-works/pi-ai'
import { hasValidRuntimeProviderTokens } from './runtimeProviderUsage.ts'

export interface RuntimeCompactionCheckpoint {
  summary: string
  retainedTail: AgentMessage[]
  coveredRawLength: number
  tokensBefore: number
  timestamp: number
  details?: Record<string, unknown>
}

export interface RuntimeCompactionBudget {
  triggerTokens: number
  fixedTokens: number
  availableTokens: number
  settings: CompactionSettings
}

export const runtimeCompactionEmptyUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

export function runtimeCompactionBudget(
  model: Model<Api>,
  thresholdPercent: number,
  systemPrompt: string,
  tools: Tool[],
): RuntimeCompactionBudget {
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0
    || !Number.isSafeInteger(model.maxTokens) || model.maxTokens <= 0
    || !Number.isInteger(thresholdPercent) || thresholdPercent < 50 || thresholdPercent > 95) {
    throw new Error('AGENT_RUNTIME_CONTEXT_COMPRESSION_SETTINGS_INVALID')
  }
  // 无 Provider 用量基准时，按实际系统提示和工具定义补足固定开销。
  const fixedTokens = estimateTokens({
    role: 'user',
    content: systemPrompt + (tools.length > 0 ? JSON.stringify(tools) : ''),
    timestamp: 0,
  })
  const triggerTokens = Math.min(
    Math.floor(model.contextWindow * thresholdPercent / 100),
    model.contextWindow - model.maxTokens,
  )
  const availableTokens = triggerTokens - fixedTokens
  return {
    triggerTokens,
    fixedTokens,
    availableTokens,
    settings: {
      enabled: true,
      reserveTokens: Math.min(16384, Math.floor(Math.max(0, availableTokens) / 4)),
      keepRecentTokens: Math.min(20000, Math.floor(Math.max(0, availableTokens) / 2)),
    },
  }
}

export function runtimeCompactionProjection(
  raw: AgentMessage[],
  checkpoint: RuntimeCompactionCheckpoint | undefined,
): AgentMessage[] {
  if (!checkpoint) return raw.slice()
  if (!Number.isSafeInteger(checkpoint.coveredRawLength)
    || checkpoint.coveredRawLength < 0 || checkpoint.coveredRawLength > raw.length) {
    throw new Error('AGENT_RUNTIME_CONTEXT_COMPRESSION_BOUNDARY_INVALID')
  }
  // 转成标准 user 消息，兼容主 Agent 已有的标准消息过滤器。
  const summary = convertToLlm([createCompactionSummaryMessage(
    checkpoint.summary,
    checkpoint.tokensBefore,
    checkpoint.timestamp,
  )])
  return [
    ...summary,
    ...checkpoint.retainedTail.map(clearRuntimeCompactionUsage),
    ...raw.slice(checkpoint.coveredRawLength),
  ]
}

export function runtimeCompactionEstimate(
  messages: AgentMessage[],
  model: Model<Api>,
  fixedTokens: number,
) {
  return runtimeCompactionAssessment(messages, model, fixedTokens).tokens
}

export function runtimeCompactionAssessment(
  messages: AgentMessage[],
  model: Model<Api>,
  fixedTokens: number,
) {
  const estimate = estimateContextTokens(runtimeCompactionUsageMessages(messages, model))
  // 来源取决于 pi 实际使用的基准；后续门禁不一定携带新的 Provider 用量事件。
  return {
    tokens: estimate.tokens + (estimate.lastUsageIndex === null ? fixedTokens : 0),
    basis: estimate.lastUsageIndex === null ? 'pi_estimate' as const : 'provider_usage' as const,
  }
}

export function runtimeCompactionCalibratedSettings(
  messages: AgentMessage[],
  model: Model<Api>,
  budget: RuntimeCompactionBudget,
): CompactionSettings | undefined {
  const estimate = estimateContextTokens(runtimeCompactionUsageMessages(messages, model))
  if (estimate.lastUsageIndex === null || estimate.tokens < budget.triggerTokens
    || !Number.isSafeInteger(estimate.usageTokens)) return undefined
  let anchorTokens = budget.fixedTokens
  for (let index = 0; index <= estimate.lastUsageIndex; index += 1) {
    anchorTokens += estimateTokens(messages[index]!)
  }
  if (anchorTokens <= 0 || estimate.usageTokens <= anchorTokens) return undefined
  // 官方切点用字符估算；把近期预算换算到同一尺度，固定开销也参与校准，不能将差额全归历史。
  const keepRecentTokens = Math.floor(budget.settings.keepRecentTokens * anchorTokens / estimate.usageTokens)
  if (keepRecentTokens <= 0 || keepRecentTokens >= budget.settings.keepRecentTokens) return undefined
  return { ...budget.settings, keepRecentTokens }
}

function runtimeCompactionUsageMessages(messages: AgentMessage[], model: Model<Api>) {
  return messages.map((message) => (
    message.role === 'assistant'
      && (message.model !== model.id || message.provider !== model.provider || message.api !== model.api
        || !hasValidRuntimeProviderTokens(message.usage))
      ? clearRuntimeCompactionUsage(message)
      : message
  ))
}

export function runtimeCompactionEntries(
  raw: AgentMessage[],
  checkpoint: RuntimeCompactionCheckpoint | undefined,
): Entry[] {
  const entries: Entry[] = []
  if (checkpoint) {
    entries.push({
      type: 'compaction',
      id: 'runtime-checkpoint',
      parentId: null,
      seq: 0,
      timestamp: checkpoint.timestamp,
      summary: checkpoint.summary,
      retainedTail: checkpoint.retainedTail.map(clearRuntimeCompactionUsage),
      tokensBefore: checkpoint.tokensBefore,
      fromHook: false,
      ...(checkpoint.details ? { details: runtimeCompactionJsonValue(checkpoint.details) } : {}),
    })
  }
  for (let index = checkpoint?.coveredRawLength ?? 0; index < raw.length; index += 1) {
    const message = raw[index]!
    entries.push({
      type: 'message',
      id: `runtime-message-${index}`,
      parentId: entries[entries.length - 1]?.id ?? null,
      seq: entries.length,
      timestamp: message.timestamp,
      message,
    })
  }
  return entries
}

export function clearRuntimeCompactionUsage(message: AgentMessage): AgentMessage {
  if (message.role !== 'assistant') return message
  // 保留消息原文和签名，只清除上下文投影中已过期的用量基准。
  return { ...message, usage: { ...runtimeCompactionEmptyUsage, cost: { ...runtimeCompactionEmptyUsage.cost } } }
}

export function cloneRuntimeCompactionCheckpoint(checkpoint: RuntimeCompactionCheckpoint) {
  return {
    ...checkpoint,
    retainedTail: checkpoint.retainedTail.slice(),
    ...(checkpoint.details ? { details: { ...checkpoint.details } } : {}),
  }
}

function runtimeCompactionJsonValue(value: unknown, depth = 0): JsonValue {
  if (depth > 32) throw new Error('AGENT_RUNTIME_CONTEXT_COMPRESSION_DETAILS_INVALID')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((item) => runtimeCompactionJsonValue(item, depth + 1))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, runtimeCompactionJsonValue(item, depth + 1)]))
  }
  throw new Error('AGENT_RUNTIME_CONTEXT_COMPRESSION_DETAILS_INVALID')
}

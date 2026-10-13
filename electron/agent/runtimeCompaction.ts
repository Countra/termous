import {
  type AgentMessage,
  type StreamFn,
  type ThinkingLevel,
} from '@earendil-works/pi-agent-core'
import type { Api, Model, Tool } from '@earendil-works/pi-ai'
import type { RuntimeUsage } from './runtimeUsage.ts'
import type { RuntimeProviderUsage } from './runtimeProviderUsage.ts'
import type { RuntimeRetryActivity } from './runtimeProviderRetry.ts'
import { prepareRuntimeCompaction } from './runtimeCompactionPreparation.ts'
import type { RuntimeCompactionPreparation } from './runtimeCompactionTypes.ts'
import { generateRuntimeCompaction } from './runtimeCompactionGeneration.ts'
import {
  clearRuntimeCompactionUsage,
  cloneRuntimeCompactionCheckpoint,
  runtimeCompactionAssessment,
  runtimeCompactionBudget,
  runtimeCompactionCalibratedSettings,
  runtimeCompactionEstimate,
  runtimeCompactionProjection,
  type RuntimeCompactionCheckpoint,
} from './runtimeCompactionPolicy.ts'
import {
  assertRuntimeCompactionSummary,
  createRuntimeCompactionRequest,
  RuntimeCompactionError,
  throwIfRuntimeCompactionAborted,
  toRuntimeCompactionError,
} from './runtimeCompactionSummary.ts'

export type { RuntimeCompactionCheckpoint } from './runtimeCompactionPolicy.ts'
export { RuntimeCompactionError } from './runtimeCompactionSummary.ts'

export interface RuntimeCompactionActivity {
  status: 'started' | 'completed' | 'failed' | 'cancelled'
  reason: 'threshold' | 'manual'
  tokensBefore?: number
  tokensAfter?: number
  errorCode?: string
}

export interface RuntimeCompactionContextUsage {
  estimated_tokens: number
  context_window_tokens: number
  estimated: true
  warning: boolean
  compression_available: boolean
  basis: 'pi_estimate' | 'provider_usage'
  compression_status: 'unknown' | 'available' | 'unavailable'
  provider_usage?: RuntimeProviderUsage
}

export interface RuntimeCompactionCommit<TSource> {
  source: TSource
  checkpoint: RuntimeCompactionCheckpoint
  tokensBefore: number
  tokensAfter: number
  usage: RuntimeUsage
}

export interface RuntimeCompactionOptions<TSource> {
  model: Model<Api>
  systemPrompt: string
  tools: Tool[]
  thresholdPercent?: number
  forceCompression?: boolean
  streamFn: StreamFn
  providerErrorSecrets?: readonly string[]
  thinkingLevel?: ThinkingLevel
  initialCheckpoint?: RuntimeCompactionCheckpoint
  captureSource(signal?: AbortSignal): Promise<TSource>
  commit(candidate: RuntimeCompactionCommit<TSource>, signal?: AbortSignal): Promise<void>
  onActivity(activity: RuntimeCompactionActivity): Promise<void> | void
  onUsage?(usage: RuntimeUsage): Promise<void> | void
  onRetry?(activity: RuntimeRetryActivity): Promise<void> | void
  onContextUsage?(usage: RuntimeCompactionContextUsage): Promise<void> | void
  now?: () => number
}

export interface RuntimeCompactionController {
  transformContext(messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]>
  observeContext(messages: AgentMessage[], providerUsage?: RuntimeProviderUsage): Promise<void>
  beforeProviderRequest(): void
  checkpoint(): RuntimeCompactionCheckpoint | undefined
  failure(): RuntimeCompactionError | undefined
}

export function createRuntimeCompactionController<TSource>(
  options: RuntimeCompactionOptions<TSource>,
): RuntimeCompactionController {
  const budget = runtimeCompactionBudget(
    options.model,
    options.thresholdPercent ?? 80,
    options.systemPrompt,
    options.tools,
  )
  const hasCompactionCapacity = budget.availableTokens > 0
    && budget.settings.reserveTokens > 0 && budget.settings.keepRecentTokens > 0
  let checkpoint = options.initialCheckpoint && cloneRuntimeCompactionCheckpoint(options.initialCheckpoint)
  let gateFailure: RuntimeCompactionError | undefined
  let activeSignal: AbortSignal | undefined
  let lastContextUsage: string | undefined
  let forceCompression = options.forceCompression === true

  const publishContext = async (
    messages: AgentMessage[], preparation?: RuntimeCompactionPreparation, providerUsage?: RuntimeProviderUsage,
  ) => {
    const { tokens, basis } = runtimeCompactionAssessment(messages, options.model, budget.fixedTokens)
    const compressionAvailable = hasCompactionCapacity && hasRuntimeCompactionPrefix(preparation)
    const usage: RuntimeCompactionContextUsage = {
      estimated_tokens: tokens,
      context_window_tokens: options.model.contextWindow,
      estimated: true,
      warning: tokens >= Math.min(Math.floor(options.model.contextWindow * 0.7), budget.triggerTokens),
      compression_available: compressionAvailable,
      basis,
      compression_status: compressionAvailable ? 'available' : 'unavailable',
      ...(providerUsage ? { provider_usage: providerUsage } : {}),
    }
    const fingerprint = JSON.stringify(usage)
    if (fingerprint !== lastContextUsage) {
      await options.onContextUsage?.(usage)
      lastContextUsage = fingerprint
    }
    return tokens
  }

  const prepareContext = (raw: AgentMessage[], projected: AgentMessage[]) => {
    let prepared = prepareRuntimeCompaction(raw, checkpoint, budget.settings)
    if (!hasRuntimeCompactionPrefix(prepared)) {
      const calibratedSettings = runtimeCompactionCalibratedSettings(projected, options.model, budget)
      if (calibratedSettings) {
        // 仅补救用量已过门禁但字符估算尚无切点的情况，仍保持完整工具调用边界。
        prepared = prepareRuntimeCompaction(raw, checkpoint, calibratedSettings)
      }
    }
    return prepared
  }

  const transformContext = async (raw: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> => {
    activeSignal = signal
    let projected = raw.slice()
    let started = false
    const reason = forceCompression ? 'manual' : 'threshold'
    let tokensBefore: number | undefined
    try {
      projected = runtimeCompactionProjection(raw, checkpoint)
      if (gateFailure) return projected
      throwIfRuntimeCompactionAborted(signal)
      const preparation = prepareContext(raw, projected)
      tokensBefore = await publishContext(projected, preparation)
      const forced = forceCompression
      forceCompression = false
      if (!forced && tokensBefore < budget.triggerTokens) return projected
      if (forced && tokensBefore < budget.triggerTokens && !hasRuntimeCompactionPrefix(preparation)) return projected
      if (!hasCompactionCapacity || !hasRuntimeCompactionPrefix(preparation)) {
        throw new RuntimeCompactionError('AGENT_RUNTIME_CONTEXT_COMPRESSION_UNAVAILABLE')
      }
      throwIfRuntimeCompactionAborted(signal)
      const source = await options.captureSource(signal)
      throwIfRuntimeCompactionAborted(signal)
      started = true
      await options.onActivity({ status: 'started', reason, tokensBefore })
      const summary = createRuntimeCompactionRequest(options.streamFn, options.onUsage, undefined, options.providerErrorSecrets, options.onRetry)
      const result = await generateRuntimeCompaction(
        preparation, summary.complete, options.model, options.thinkingLevel, signal,
      )
      throwIfRuntimeCompactionAborted(signal)
      assertRuntimeCompactionSummary(result)
      const candidate: RuntimeCompactionCheckpoint = {
        summary: result.trim(),
        retainedTail: preparation.retainedTail.map(clearRuntimeCompactionUsage),
        coveredRawLength: raw.length,
        tokensBefore,
        timestamp: (options.now ?? Date.now)(),
        ...(checkpoint?.details ? { details: { ...checkpoint.details } } : {}),
      }
      const nextProjection = runtimeCompactionProjection(raw, candidate)
      const tokensAfter = runtimeCompactionEstimate(nextProjection, options.model, budget.fixedTokens)
      if (tokensAfter >= budget.triggerTokens || tokensAfter >= tokensBefore) {
        throw new RuntimeCompactionError('AGENT_RUNTIME_CONTEXT_COMPRESSION_INSUFFICIENT')
      }
      throwIfRuntimeCompactionAborted(signal)
      try {
        await options.commit({ source, checkpoint: candidate, tokensBefore, tokensAfter, usage: summary.usage() }, signal)
      } catch (error) {
        throw new RuntimeCompactionError('AGENT_RUNTIME_CONTEXT_COMPRESSION_CHECKPOINT_FAILED', error)
      }
      // Core 已原子提交摘要和完成活动，此后才改变本地投影，禁止提前裁剪历史。
      checkpoint = cloneRuntimeCompactionCheckpoint(candidate)
      projected = nextProjection
      started = false
      await options.onActivity({ status: 'completed', reason, tokensBefore, tokensAfter })
      await publishContext(projected, prepareContext(raw, projected))
      throwIfRuntimeCompactionAborted(signal)
      return projected
    } catch (error) {
      gateFailure = toRuntimeCompactionError(error, signal)
      // Hook 合同禁止拒绝；失败由下一次 Provider 入口抛出，保持 Agent 标准终止序列。
      if (started) {
        try {
          await options.onActivity({
            status: gateFailure.code === 'AGENT_RUNTIME_CONTEXT_COMPRESSION_ABORTED' ? 'cancelled' : 'failed',
            reason,
            tokensBefore,
            errorCode: gateFailure.code,
          })
        } catch (activityError) {
          gateFailure = new RuntimeCompactionError(gateFailure.code, { error: gateFailure, activityError }, gateFailure.detail)
        }
      }
      return projected
    }
  }

  return {
    transformContext,
    observeContext: async (raw, providerUsage) => {
      if (gateFailure) return
      const projected = runtimeCompactionProjection(raw, checkpoint)
      // 回复结束时只刷新窗口占用；压缩仍由下一次 Provider 请求前的唯一门禁执行。
      await publishContext(projected, prepareContext(raw, projected), providerUsage)
    },
    beforeProviderRequest: () => {
      if (gateFailure) throw gateFailure
      throwIfRuntimeCompactionAborted(activeSignal)
    },
    checkpoint: () => checkpoint && cloneRuntimeCompactionCheckpoint(checkpoint),
    failure: () => gateFailure,
  }
}

function hasRuntimeCompactionPrefix(preparation: RuntimeCompactionPreparation | undefined): preparation is RuntimeCompactionPreparation {
  return preparation !== undefined
    && (preparation.messagesToSummarize.length > 0 || preparation.turnPrefixMessages.length > 0)
}

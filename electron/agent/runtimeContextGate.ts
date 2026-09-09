import { randomUUID } from 'node:crypto'
import type { AgentTool, StreamFn } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { PiEventBridge } from './piEventBridge.ts'
import { createRuntimeCompactionController } from './runtimeCompaction.ts'
import type { RuntimeContextImages } from './runtimeContextImages.ts'
import type { RuntimeEventWriter } from './runtimeEventWriter.ts'
import { isRuntimeCheckpointInput } from './runtimeCheckpoint.ts'
import { projectRuntimeToolHistory } from './runtimeToolHistory.ts'
import type {
  RuntimeBootstrap,
  RuntimeCheckpointInput,
  RuntimeCheckpointResult,
  RuntimeReasoningLevel,
} from './workerCoreClient.ts'

interface RuntimeContextGateOptions {
  bootstrap: RuntimeBootstrap
  model: Model<Api>
  systemPrompt: string
  tools: AgentTool[]
  streamFn: StreamFn
  bridge: PiEventBridge
  images: RuntimeContextImages
  events: RuntimeEventWriter
  commitCheckpoint(input: RuntimeCheckpointInput, signal?: AbortSignal): Promise<RuntimeCheckpointResult>
  now?: () => number
}

interface CompactionSource {
  id: string
  coveredSequence: number
  partSequence: number
  baseCheckpointID: string
}

export function createRuntimeContextGate(options: RuntimeContextGateOptions) {
  let persistedCheckpoint = options.bootstrap.context.checkpoint
  let active: CompactionSource | undefined
  const retryPositions = new Map<string, number>()
  const now = options.now ?? Date.now
  const checkpoint = persistedCheckpoint && {
    summary: persistedCheckpoint.summary,
    retainedTail: (persistedCheckpoint.retained_tail ?? []).map(projectRuntimeToolHistory),
    coveredRawLength: 1 + (persistedCheckpoint.retained_tail?.length ?? 0),
    tokensBefore: persistedCheckpoint.estimated_tokens,
    timestamp: now(),
    details: persistedCheckpoint.details,
  }
  return createRuntimeCompactionController({
    model: options.model,
    systemPrompt: options.systemPrompt,
    tools: options.tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    thresholdPercent: options.bootstrap.model.snapshot.context_compaction_threshold_percent ?? 80,
    forceCompression: options.bootstrap.model.snapshot.force_context_compression === true,
    thinkingLevel: minimumSummaryReasoning(options.bootstrap),
    streamFn: options.streamFn,
    providerErrorSecrets: options.bootstrap.model.api_key ? [options.bootstrap.model.api_key] : [],
    initialCheckpoint: checkpoint,
    now,
    captureSource: async () => {
      await options.events.flush()
      active = {
        id: `agc_${randomUUID()}`,
        coveredSequence: options.events.currentSequence(),
        partSequence: options.bridge.partSequence(),
        baseCheckpointID: persistedCheckpoint?.id ?? '',
      }
      return active
    },
    commit: async (candidate) => {
      const source = candidate.source
      const retainedTail = options.images.serialize(candidate.checkpoint.retainedTail)
      const payload = {
        generation: options.bootstrap.run.generation,
        compaction_id: source.id,
        base_checkpoint_id: source.baseCheckpointID,
        covered_event_sequence: source.coveredSequence,
        summary: candidate.checkpoint.summary,
        retained_tail: retainedTail,
        details: candidate.checkpoint.details,
        tokens_before: candidate.tokensBefore,
        tokens_after: candidate.tokensAfter,
      }
      // 分配完成序号前校验最大信封，避免可预见的载荷错误让事件流水线失效。
      if (!isRuntimeCheckpointInput({ ...payload, event_id: 'x'.repeat(128), sequence: Number.MAX_SAFE_INTEGER }, payload.generation)) {
        throw new Error('AGENT_RUNTIME_CHECKPOINT_INVALID')
      }
      // 完成序号一旦分配，等待短事务回执；取消仍阻止下一次模型请求，不能打断原子提交。
      const committed = await options.events.writeExternal(async (eventID, sequence) => {
        const result = await options.commitCheckpoint({
          ...payload,
          event_id: eventID,
          sequence,
        })
        return { lastSequence: result.last_sequence, value: result.checkpoint }
      })
      persistedCheckpoint = committed
    },
    onActivity: async (activity) => {
      if (activity.status === 'completed') {
        // 完成事件由 Core 与快照原子提交，不能再发送一次普通活动事件。
        active = undefined
        return
      }
      if (!active) return
      const event = options.events.push('compaction', {
        compaction: {
          compaction_id: active.id,
          status: activity.status,
          reason: activity.reason,
          assistant_message_id: options.bootstrap.run.assistant_message_id,
          after_part_sequence: active.partSequence,
          tokens_before: activity.tokensBefore ?? 0,
          ...(activity.errorCode ? { error_code: activity.errorCode } : {}),
        },
      })
      // 固定摘要期间仍可保存未消费的追加指令；恢复水位包含收件事件，但不覆盖其消费状态。
      if (activity.status === 'started') active.coveredSequence = event.sequence - 1
      await options.events.flush()
      if (activity.status !== 'started') active = undefined
    },
    onUsage: (usage) => { options.bridge.addUsage(usage) },
    onRetry: async (activity) => {
      const position = retryPositions.get(activity.retry_id) ?? options.bridge.partSequence()
      retryPositions.set(activity.retry_id, position)
      options.events.push('retry', { retry: {
        ...activity, assistant_message_id: options.bootstrap.run.assistant_message_id,
        purpose: 'compaction', after_part_sequence: position,
      } })
      await options.events.flush()
      if (activity.status === 'completed' || activity.status === 'failed' || activity.status === 'cancelled') {
        retryPositions.delete(activity.retry_id)
      }
    },
    onContextUsage: (usage) => {
      // 能力位独立于原生用量恢复，避免新版字段被严格解码的旧 Core 拒绝。
      const { basis, compression_status, ...legacy } = usage
      options.events.push('context_usage', { context_usage: options.bootstrap.context.context_assessment_supported === true
        ? { ...legacy, basis, compression_status }
        : legacy })
    },
  })
}

function minimumSummaryReasoning(bootstrap: RuntimeBootstrap): RuntimeReasoningLevel {
  const ordered: RuntimeReasoningLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const supported = bootstrap.model.snapshot.supported_reasoning_levels
  return ordered.find((level) => supported.includes(level)) ?? 'off'
}

export function runtimeContextFailureMessage(code: string, detail?: string) {
  if (code === 'AGENT_RUNTIME_CONTEXT_COMPRESSION_UNAVAILABLE'
    || code === 'AGENT_RUNTIME_CONTEXT_COMPRESSION_INSUFFICIENT') {
    return '上下文超出模型可用容量，无法继续压缩；请调整上下文窗口、输出预算或新建会话。'
  }
  if (code === 'AGENT_RUNTIME_CONTEXT_COMPRESSION_TRUNCATED') {
    return '摘要达到输出上限，未保存不完整摘要；请检查模型输出预算后重试，原始记录和上次成功摘要仍保留。'
  }
  if (code === 'AGENT_RUNTIME_CONTEXT_COMPRESSION_INVALID') {
    return '模型未返回有效的纯文本摘要，压缩未提交；原始记录和上次成功摘要仍保留。'
  }
  if (code === 'AGENT_RUNTIME_CONTEXT_COMPRESSION_CHECKPOINT_FAILED') {
    return '摘要保存未能确认，当前回复已停止；已保存的记录仍保留，下次发送时会重新加载。'
  }
  if (detail) return detail
  return '上下文压缩失败，已保留原始记录；下一次发送时可以重试。'
}

import { randomUUID } from 'node:crypto'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import {
  retryAssistantCall,
  isContextOverflow,
  type AssistantMessage,
  type AssistantMessageEvent,
} from '@earendil-works/pi-ai'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { runtimeProviderFailure, sanitizeRuntimeProviderError } from './runtimeProviderFailure.ts'
import { projectPiUsage, type RuntimeUsage } from './runtimeUsage.ts'
import type { RuntimeRetryEvent } from './workerCoreClient.ts'

export type RuntimeRetryActivity = Omit<RuntimeRetryEvent, 'assistant_message_id' | 'purpose' | 'after_part_sequence'>

export interface RuntimeProviderRetryOptions {
  onActivity?(activity: RuntimeRetryActivity): Promise<void> | void
  onDiscardedUsage?(usage: RuntimeUsage): Promise<void> | void
  providerErrorSecrets?: readonly string[]
}

const retryPolicy = { enabled: true, maxRetries: 3, baseDelayMs: 1000 } as const

class RuntimeTerminalAssistantError {
  readonly message: AssistantMessage

  constructor(message: AssistantMessage) {
    this.message = message
  }
}

// 官方流只支持正常结束；补充拒绝通道，保证回调或适配器异常不会成为悬挂请求。
class RuntimeRetryStream extends AssistantMessageEventStream {
  private failure: { error: unknown } | undefined
  private failResult!: (failure: { error: unknown }) => void
  private readonly failed = new Promise<{ error: unknown }>((resolve) => { this.failResult = resolve })

  fail(error: unknown) {
    this.failure = { error }
    this.failResult(this.failure)
    this.end()
  }

  override async result() {
    const outcome = await Promise.race([super.result().then((message) => ({ message })), this.failed])
    if ('error' in outcome) throw outcome.error
    return outcome.message
  }

  override async *[Symbol.asyncIterator]() {
    const iterator = super[Symbol.asyncIterator]()
    for (;;) {
      const next = await iterator.next()
      if (this.failure) throw this.failure.error
      if (next.done) return
      yield next.value
    }
  }
}

export function createRuntimeRetryStreamFunction(
  streamFn: StreamFn,
  options: RuntimeProviderRetryOptions = {},
): StreamFn {
  return (model, context, streamOptions) => {
    const output = new RuntimeRetryStream()
    const signal = streamOptions?.signal
    // 每个逻辑请求隔离官方退避监听器，避免多轮工具调用在同一个 Agent signal 上累积监听。
    const retrySignal = signal ? AbortSignal.any([signal]) : undefined
    let retryID: string | undefined
    let attempt = 0
    let errorMessage = ''
    let previous: AssistantMessage | undefined
    let previousAccounted = false
    let retryReady = false
    let buffered: AssistantMessageEvent[] = []

    const publish = async (status: RuntimeRetryEvent['status'], delayMs = 0) => {
      if (!retryID) return
      await options.onActivity?.({
        retry_id: retryID, status, attempt, max_retries: 3, delay_ms: delayMs,
        error_message: sanitizeRuntimeProviderError(errorMessage, options.providerErrorSecrets),
      })
    }
    const cancelledMessage = (): AssistantMessage => {
      // 退避取消沿用最后失败请求的用量；只有已单独记账时才返回零用量，防止重复累计。
      if (previous && !previousAccounted) {
        const message = { ...previous, stopReason: 'aborted' as const }
        delete message.errorMessage
        return message
      }
      return {
        role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: 'aborted',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      }
    }
    const produce = async () => {
      if (signal?.aborted) return cancelledMessage()
      buffered = []
      const isRetry = retryReady
      retryReady = false
      if (isRetry) attempt += 1
      let hasOutput = false
      let started = false
      // waiting 已确认后才进入此处；先开始调用再记录 requesting，取消期间不虚报已启动次数。
      const request = (() => {
        try {
          return Promise.resolve(streamFn(model, context, streamOptions))
            .then((stream) => ({ stream }), (error: unknown) => ({ error }))
        } catch (error) {
          return Promise.resolve({ error })
        }
      })()
      if (isRetry) await publish('requesting')
      const settled = await request
      if ('error' in settled) throw settled.error
      const stream = settled.stream
      for await (const event of stream) {
        if (event.type === 'done' || event.type === 'error') continue
        hasOutput ||= hasRuntimeAssistantOutput(event.partial)
          || ((event.type === 'text_delta' || event.type === 'thinking_delta') && event.delta.length > 0)
          || event.type === 'toolcall_start' || event.type === 'toolcall_delta' || event.type === 'toolcall_end'
        if (!started) {
          buffered.push(event)
          if (!hasOutput) continue
          for (const pending of buffered) output.push(pending)
          buffered = []
          started = true
        } else {
          output.push(event)
        }
      }
      const message = await stream.result()
      previous = message
      previousAccounted = false
      hasOutput ||= hasRuntimeAssistantOutput(message)
      // 鉴权失败可能附带暂时故障提示，须先排除，避免官方文本匹配误把确定性错误纳入重试。
      if (message.stopReason === 'error' && (hasOutput || isContextOverflow(message)
        || runtimeProviderFailure(message.errorMessage).code === 'AGENT_MODEL_AUTH_FAILED')) {
        throw new RuntimeTerminalAssistantError(message)
      }
      return message
    }
    const run = async () => {
      let message: AssistantMessage
      try {
        message = await retryAssistantCall(produce, retryPolicy, retrySignal, {
          onRetryScheduled: async (_nextAttempt, _maximum, delayMs, detail) => {
            retryID ??= `agrty_${randomUUID()}`
            errorMessage = detail
            await publish('waiting', delayMs)
          },
          onRetryAttemptStart: async () => {
            if (signal?.aborted) return
            // 只有真正离开退避才计入被替代请求，退避期间取消由最终消息统一收口。
            if (previous) {
              await options.onDiscardedUsage?.(projectPiUsage(previous.usage))
              previousAccounted = true
            }
            retryReady = true
          },
        })
      } catch (error) {
        if (!(error instanceof RuntimeTerminalAssistantError)) {
          await publish(signal?.aborted ? 'cancelled' : 'failed')
          throw error
        }
        message = error.message
      }
      if (message.stopReason === 'pending') {
        await publish('failed')
        throw new Error('AGENT_MODEL_STREAM_INVALID')
      }
      if (message.stopReason === 'error' && message.errorMessage) errorMessage = message.errorMessage
      await publish(message.stopReason === 'aborted' ? 'cancelled' : message.stopReason === 'error' ? 'failed' : 'completed')
      for (const event of buffered) output.push(event)
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        output.push({ type: 'error', reason: message.stopReason, error: message })
      } else {
        output.push({ type: 'done', reason: message.stopReason, message })
      }
      output.end()
    }
    void run().catch((error) => output.fail(error))
    return output
  }
}

function hasRuntimeAssistantOutput(message: AssistantMessage) {
  return message.content.some((part) => part.type === 'toolCall'
    || (part.type === 'text' ? part.text.length > 0 : part.thinking.length > 0))
}

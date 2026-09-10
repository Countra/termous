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
  onFailedAttempt?(message: AssistantMessage): Promise<void> | void
  providerErrorSecrets?: readonly string[]
}

const retryPolicy = { enabled: true, maxRetries: 3, baseDelayMs: 3000 } as const

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
  private emitted = 0
  private consumed = 0
  private notifyDrain: (() => void) | undefined

  override push(event: AssistantMessageEvent) {
    this.emitted += 1
    super.push(event)
  }

  async drain(signal?: AbortSignal): Promise<boolean> {
    this.assertHealthy()
    if (signal?.aborted) return false
    if (this.consumed >= this.emitted) return true
    // 等待 Agent 处理完已发出的增量，再保存失败片段并切换 part，避免迟到增量串入下一次尝试。
    const target = this.emitted
    let onAbort: (() => void) | undefined
    const drained = new Promise<boolean>((resolve) => {
      this.notifyDrain = () => { if (this.consumed >= target) resolve(true) }
      onAbort = () => resolve(false)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const result = await Promise.race([drained, this.failed])
      if (typeof result !== 'boolean') throw result.error
      this.assertHealthy()
      return result
    } finally {
      this.notifyDrain = undefined
      if (onAbort) signal?.removeEventListener('abort', onAbort)
    }
  }

  fail(error: unknown) {
    if (this.failure) return
    this.failure = { error }
    this.failResult(this.failure)
    this.end()
  }

  private assertHealthy() {
    if (this.failure) throw this.failure.error
  }

  override async result() {
    const outcome = await Promise.race([super.result().then((message) => ({ message })), this.failed])
    if ('error' in outcome) throw outcome.error
    return outcome.message
  }

  override async *[Symbol.asyncIterator]() {
    const iterator = super[Symbol.asyncIterator]()
    let finished = false
    try {
      for (;;) {
        const next = await iterator.next()
        if (this.failure) throw this.failure.error
        if (next.done) { finished = true; return }
        finished = next.value.type === 'done' || next.value.type === 'error'
        yield next.value
        this.consumed += 1
        this.notifyDrain?.()
      }
    } finally {
      if (!finished && !this.failure) this.fail(new Error('AGENT_MODEL_STREAM_CONSUMER_CLOSED'))
      await iterator.return?.()
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
    let previousArchived = false
    let retryReady = false
    let logicalStarted = false
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
        const message = { ...previous, content: previousArchived ? [] : previous.content, stopReason: 'aborted' as const }
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
      previousArchived = false
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
          for (const pending of buffered) forward(pending)
          buffered = []
          started = true
        } else {
          forward(event)
        }
      }
      const message = await stream.result()
      previous = message
      previousAccounted = false
      // 鉴权失败可能附带暂时故障提示，须先排除，避免官方文本匹配误把确定性错误纳入重试。
      if (message.stopReason === 'error' && (isContextOverflow(message)
        || runtimeProviderFailure(message.errorMessage).code === 'AGENT_MODEL_AUTH_FAILED')) {
        throw new RuntimeTerminalAssistantError(message)
      }
      return message
    }
    const forward = (event: AssistantMessageEvent) => {
      // 多次物理请求对 pi 仍是一个逻辑 Assistant，第二个 start 会把失败 partial 插入 loop 上下文。
      if (event.type === 'start') {
        if (logicalStarted) return
        logicalStarted = true
      }
      output.push(event)
    }
    const run = async () => {
      let message: AssistantMessage
      try {
        message = await retryAssistantCall(produce, retryPolicy, retrySignal, {
          onRetryScheduled: async (_nextAttempt, _maximum, delayMs, detail) => {
            errorMessage = detail
            if (options.onFailedAttempt && previous) {
              // 摘要仅消费 result，没有增量消费者；只有普通回答的历史投影需要等待消费屏障。
              if (await output.drain(signal)) {
                await options.onFailedAttempt(previous)
                previousArchived = true
              }
            }
            // 屏障期间取消也记录已发生的真实错误；官方退避会立即响应取消，不再发起请求。
            retryID ??= `agrty_${randomUUID()}`
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
      if (message.stopReason === 'aborted' && previousArchived) message = cancelledMessage()
      if (message.stopReason === 'pending') {
        await publish('failed')
        throw new Error('AGENT_MODEL_STREAM_INVALID')
      }
      if (message.stopReason === 'error' && message.errorMessage) errorMessage = message.errorMessage
      await publish(message.stopReason === 'aborted' ? 'cancelled' : message.stopReason === 'error' ? 'failed' : 'completed')
      for (const event of buffered) forward(event)
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

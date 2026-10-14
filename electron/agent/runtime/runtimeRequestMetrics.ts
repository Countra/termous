import type { StreamFn } from '@earendil-works/pi-agent-core'
import { getCurrentTools, getCurrentSystemPrompt } from '@earendil-works/pi-ai/utils/transcript'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import type { RuntimeEventWriter } from './runtimeEventWriter.ts'
import type { RuntimeExecutionBudget } from '../execution/runtimeExecutionBudget.ts'
import { projectPiUsage } from '../provider/runtimeUsage.ts'
import { estimateRuntimeMessageTokens } from '../context/runtimeContextTokens.ts'
import { runtimeImageDimensions } from '../context/runtimeImageDimensions.ts'
import { runtimeProviderFailure, sanitizeRuntimeProviderError } from '../provider/runtimeProviderFailure.ts'

export function measuredRuntimeStream(base: StreamFn, budget: RuntimeExecutionBudget, events: Pick<RuntimeEventWriter, 'push'>, supported: boolean, purpose: 'response' | 'compaction', secrets: readonly string[] = []): StreamFn {
  return (model, context, options) => {
    const tools = getCurrentTools(context.messages)
    const schemaBytes = Buffer.byteLength(JSON.stringify(tools))
    const estimatedInput = Math.ceil((schemaBytes + getCurrentSystemPrompt(context.messages).length) / 3) + context.messages.filter((message) => message.role !== 'system').reduce((sum, message) => sum + estimateRuntimeMessageTokens(message), 0)
    const decision = options?.signal?.aborted ? undefined : budget.evaluate({ type: 'before_request', estimatedInput })
    const blocked = decision && !decision.allowed ? decision.reason : undefined
    if (options?.signal?.aborted || blocked) {
      // 本地拒绝使用标准流终态，不进入请求计数、费用统计或网络重试。
      const stream = new AssistantMessageEventStream()
      const stopReason = options?.signal?.aborted ? 'aborted' : 'error'
      const message: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason, errorMessage: blocked?.code, timestamp: Date.now() }
      stream.push({ type: 'error', reason: stopReason, error: message })
      return stream
    }
    const requestIndex = budget.usage.beginRequest()
    const started = Date.now()
    const stream = new AssistantMessageEventStream()
    const images = context.messages.flatMap((message) => message.role === 'user' || message.role === 'toolResult'
      ? typeof message.content === 'string' ? [] : message.content.filter((block) => block.type === 'image').map((block) => runtimeImageDimensions(block.data)) : [])
    void (async () => {
      let final: AssistantMessage | undefined
      let charged = false
      const account = (message: AssistantMessage) => {
        if (charged) return
        charged = true
        const reported = projectPiUsage(message.usage)
        const estimatedOutput = estimateRuntimeMessageTokens(message)
        const usage = reported.total_tokens ? reported : { ...reported, input_tokens: estimatedInput, output_tokens: estimatedOutput, total_tokens: estimatedInput + estimatedOutput, estimated: true }
        budget.usage.record(usage)
        if (supported) events.push('request_usage', { request_usage: {
          request_index: requestIndex, purpose, tool_count: tools.length,
          schema_bytes: schemaBytes, schema_tokens_estimate: Math.ceil(schemaBytes / 3), images: images.slice(0, 256),
          usage, duration_ms: Date.now() - started, outcome: message.stopReason === 'error' ? 'failed' : message.stopReason === 'aborted' ? 'cancelled' : 'completed',
          ...(message.stopReason === 'error' ? { error_code: runtimeProviderFailure(message.errorMessage).code } : {}),
        } })
      }
      try {
        const source = await base(model, context, options)
        for await (const event of source) {
          if (event.type === 'done' || event.type === 'error') final = event.type === 'done' ? event.message : event.error
          // 用量与统计必须先于结束事件发布，避免工具派发或运行关闭抢先发生。
          if (final) account(final)
          stream.push(event)
        }
        final ??= await source.result()
        account(final)
      } catch (error) {
        final = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: options?.signal?.aborted ? 'aborted' : 'error', errorMessage: sanitizeRuntimeProviderError(error instanceof Error ? error.message : 'AGENT_RUNTIME_PROVIDER_STREAM_FAILED', secrets), timestamp: Date.now() }
        try { account(final) } catch { final.errorMessage = 'AGENT_RUNTIME_EVENT_WRITE_FAILED' }
        stream.push({ type: 'error', reason: final.stopReason as 'error' | 'aborted', error: final })
      } finally {
        stream.end()
      }
    })()
    return stream
  }
}

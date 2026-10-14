import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssistantMessage, Model } from '@earendil-works/pi-ai'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { measuredRuntimeStream } from './runtimeRequestMetrics.ts'
import { RuntimeExecutionBudget, defaultExecutionBudget } from './runtimeExecutionBudget.ts'
import { createRuntimeRetryStreamFunction } from './runtimeProviderRetry.ts'
import type { RuntimeEventInput } from './workerCoreClient.ts'

const model: Model<'openai-completions'> = { id: 'fixture', name: 'fixture', provider: 'fixture', api: 'openai-completions', baseUrl: 'http://127.0.0.1', reasoning: false, input: ['text', 'image'], contextWindow: 128000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
const context = normalizeContext({ systemPrompt: '测试', tools: [{ name: 'fixture', description: '测试工具', parameters: { type: 'object', properties: { secret: { type: 'string' } } } }], messages: [{ role: 'user', content: '不会进入统计的正文', timestamp: 1 }] })

test('每次实际请求和压缩共用预算，缓存用量计入，统计不保存正文', async () => {
  const budget = new RuntimeExecutionBudget({ enabled: true, limits: { ...defaultExecutionBudget.limits, model_requests: 2 } })
  const events: RuntimeEventInput[] = []
  const writer = { push: (kind: RuntimeEventInput['kind'], payload: Record<string, unknown>) => {
    const event = { event_id: 'event', generation: 1, sequence: events.length + 1, kind, payload }
    events.push(event)
    return event
  } }
  const base = () => {
    const output = new AssistantMessageEventStream()
    const message: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: 1, usage: { input: 100, output: 20, cacheRead: 900, cacheWrite: 0, totalTokens: 1020, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
    output.push({ type: 'done', reason: 'stop', message })
    return output
  }
  for (const purpose of ['response', 'compaction'] as const) {
    const stream = await measuredRuntimeStream(base, budget, writer, true, purpose)(model, context)
    await stream.result()
  }
  assert.equal(budget.usage.requests, 2)
  assert.equal(budget.usage.tokens, 2040)
  assert.deepEqual(events.map((event) => (event.payload.request_usage as { purpose: string }).purpose), ['response', 'compaction'])
  assert.doesNotMatch(JSON.stringify(events), /不会进入统计的正文|properties|secret/u)
  const retry = createRuntimeRetryStreamFunction(measuredRuntimeStream(base, budget, writer, true, 'response'), { onActivity: () => { assert.fail('本地预算拒绝不能触发供应商重试') } })
  const rejected = await retry(model, context)
  for await (const event of rejected) assert.equal(event.type, 'error')
  assert.match((await rejected.result()).errorMessage!, /REQUEST_LIMIT/u)
  assert.equal(budget.usage.requests, 2)
  assert.equal(events.length, 2)
})

test('抛出的 Provider 异常保留重试分类并脱敏；缺失用量明确记为估算', async () => {
  const budget = new RuntimeExecutionBudget()
  const events: Record<string, unknown>[] = []
  const wrapped = measuredRuntimeStream(() => { throw new Error('429 rate limit token=private-key') }, budget, { push: (kind, payload) => {
    events.push(payload)
    return { event_id: 'event', generation: 1, sequence: 1, kind, payload }
  } }, true, 'response', ['private-key'])
  const message = await (await wrapped(model, context)).result()
  assert.match(message.errorMessage!, /429/u)
  assert.doesNotMatch(message.errorMessage!, /private-key/u)
  const metrics = events[0]!.request_usage as { usage: { estimated: boolean; total_tokens: number }; error_code: string }
  assert.equal(metrics.error_code, 'AGENT_MODEL_RATE_LIMITED')
  assert.equal(metrics.usage.estimated, true)
  assert.equal(metrics.usage.total_tokens, budget.usage.tokens)
  assert.ok(budget.usage.tokens > 0)
})


test('请求前取消不调用供应商、不计请求或统计；缺失用量同时估算输入输出', async () => {
  const budget = new RuntimeExecutionBudget()
  let calls = 0
  const events: Record<string, unknown>[] = []
  const stream = measuredRuntimeStream(() => {
    calls++
    const output = new AssistantMessageEventStream()
    output.push({ type: 'done', reason: 'stop', message: { role: 'assistant', content: [{ type: 'text', text: '输出'.repeat(1000) }], api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } })
    return output
  }, budget, { push: (kind, payload) => { events.push(payload); return { event_id: 'e', generation: 1, sequence: 1, kind, payload } } }, true, 'response')
  assert.equal((await (await stream(model, context, { signal: AbortSignal.abort() })).result()).stopReason, 'aborted')
  assert.equal(calls, 0)
  assert.equal(budget.usage.requests, 0)
  assert.equal(events.length, 0)
  await (await stream(model, context)).result()
  const usage = (events[0]!.request_usage as { usage: { input_tokens: number; output_tokens: number; total_tokens: number; estimated: boolean } }).usage
  assert.ok(usage.input_tokens > 0 && usage.output_tokens > 0)
  assert.equal(usage.total_tokens, usage.input_tokens + usage.output_tokens)
  assert.equal(usage.estimated, true)
})

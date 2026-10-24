import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { measuredRuntimeStream } from './runtimeRequestMetrics.ts'
import { RuntimeExecutionBudget } from '../execution/runtimeExecutionBudget.ts'
import { createRuntimeStreamFunction } from '../provider/runtimeProviderAdapter.ts'
import { createRuntimeRetryStreamFunction } from '../provider/runtimeProviderRetry.ts'
import { compactionTestModel } from '../test-support/runtimeCompactionTestFixture.ts'

test('真实 Pi Provider 钩子将慢消费者的背压传回 SSE 解析，完整正文不丢失', async () => {
  const model = compactionTestModel
  const count = 2000
  let parsed = 0
  const chunks = Array.from({ length: count }, (_, index) => `data: ${JSON.stringify({
    id: 'response', model: model.id, choices: [{ index: 0, delta: { ...(index === 0 ? { role: 'assistant' } : {}), content: '文' }, finish_reason: null }],
  })}\n\n`).join('') + 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
  const base = createRuntimeStreamFunction('fixture', async () => new Response(chunks, { headers: { 'content-type': 'text/event-stream' } }))
  const measured = measuredRuntimeStream(base, new RuntimeExecutionBudget(), {
    push: (kind, payload) => ({ event_id: 'event', generation: 1, sequence: 1, kind, payload }),
  }, false, 'response')
  const output = await createRuntimeRetryStreamFunction(measured)(model, normalizeContext({ messages: [{ role: 'user', content: 'observe', timestamp: 0 }] }), {
    onProviderStreamEvent: () => { parsed++ },
  })
  for (let i = 0; i < 10; i++) await setImmediate()
  // 两级各 64 项窗口，加上正在解析的一项；SDK 不得趁下游暂停解析完全部输出。
  assert.ok(parsed > 0 && parsed <= 132, `已提前解析 ${parsed} 项`)
  let text = ''
  for await (const event of output) {
    if (event.type === 'text_delta') text += event.delta
    if (text.length % 100 === 0) await setImmediate()
  }
  assert.equal(text, '文'.repeat(count))
  assert.equal((await output.result()).stopReason, 'stop')
})

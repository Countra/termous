import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { RuntimeBoundedStream } from './runtimeBoundedStream.ts'

const message: AssistantMessage = { role: 'assistant', api: 'openai-completions', provider: 'openai', model: 'test', content: [], stopReason: 'stop', timestamp: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }

test('慢消费者保持最多 64 个事件，正文和顺序完整', async () => {
  const stream = new RuntimeBoundedStream()
  let produced = 0, consumed = 0, peak = 0
  const producer = (async () => {
    for (let i = 0; i < 2000; i++) {
      await stream.waitForCapacity()
      stream.push({ type: 'text_delta', contentIndex: 0, delta: String(i), partial: message })
      produced++; peak = Math.max(peak, produced - consumed)
    }
    await stream.waitForCapacity()
    stream.push({ type: 'done', reason: 'stop', message }); stream.end()
  })()
  await setImmediate()
  assert.equal(produced, 64)
  for await (const event of stream) {
    if (event.type === 'text_delta') { assert.equal(event.delta, String(consumed++)); if (consumed % 20 === 0) await setImmediate() }
  }
  await producer
  assert.equal(consumed, 2000); assert.ok(peak <= 64)
})

test('result 消费不会死锁，提前关闭释放生产者等待', async () => {
  const stream = new RuntimeBoundedStream()
  const producer = (async () => {
    for (let i = 0; i < 100; i++) { await stream.waitForCapacity(); stream.push({ type: 'text_delta', contentIndex: 0, delta: 'x', partial: message }) }
    stream.push({ type: 'done', reason: 'stop', message }); stream.end()
  })()
  assert.equal(await stream.result(), message); await producer
  const closed = new RuntimeBoundedStream()
  for (let i = 0; i < 64; i++) closed.push({ type: 'text_delta', contentIndex: 0, delta: 'x', partial: message })
  const waiting = closed.waitForCapacity()
  for await (const event of closed) { assert.equal(event.type, 'text_delta'); break }
  await assert.rejects(waiting, /CONSUMER_CLOSED/u)
})

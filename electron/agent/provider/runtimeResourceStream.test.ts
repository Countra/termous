import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { runtimeResourceStream } from './runtimeResourceStream.ts'
import { resourceImage } from '../contracts/runtimeResourceImages.ts'
import { compactionTestAssistant, compactionTestModel } from '../test-support/runtimeCompactionTestFixture.ts'

const reference = { resource_id: 'agres_lifecycle', kind: 'image' as const, mime_type: 'image/png',
  sha256: 'a'.repeat(64), size_bytes: 100, image: { width: 1, height: 1 } }
const context = normalizeContext({ messages: [{ role: 'toolResult', toolCallId: 'call_image', toolName: 'capture', timestamp: 1, isError: false,
  content: [resourceImage(reference), resourceImage({ ...reference, resource_id: 'agres_second', sha256: 'b'.repeat(64) })] }] })

for (const phase of ['before', 'reserve', 'read'] as const) test(`图片请求在 ${phase} 阶段取消，不继续读取或派发并释放预算`, async () => {
  const controller = new AbortController()
  const reason = new Error('fixture cancelled')
  let reads = 0, dispatches = 0, reservations = 0, releases = 0
  if (phase === 'before') controller.abort(reason)
  const stream = runtimeResourceStream(() => {
    dispatches++
    return completedStream()
  }, async () => {
    reads++
    if (phase === 'read') controller.abort(reason)
    // 模拟取消发生时已经完成的读取，调用方必须在 await 返回后再次检查。
    return 'fixture-pixels'
  }, async () => {
    reservations++
    if (phase === 'reserve') controller.abort(reason)
    return () => { releases++ }
  })
  await assert.rejects(async () => stream(compactionTestModel, context, { signal: controller.signal }), error => error === reason)
  assert.equal(dispatches, 0)
  assert.equal(reads, phase === 'read' ? 1 : 0)
  assert.equal(reservations, phase === 'before' ? 0 : 1)
  assert.equal(releases, reservations)
})

for (const phase of ['reserve', 'read', 'dispatch'] as const) test(`图片请求在 ${phase} 阶段失败，保留原错误并归还已取得的预算`, async () => {
  const reason = new Error(`fixture ${phase} failed`)
  let dispatches = 0, reads = 0, releases = 0
  const stream = runtimeResourceStream(() => {
    dispatches++
    throw reason
  }, async () => {
    reads++
    if (phase === 'read') throw reason
    return 'fixture-pixels'
  }, async () => {
    if (phase === 'reserve') throw reason
    return () => { releases++ }
  })
  await assert.rejects(async () => stream(compactionTestModel, context), error => error === reason)
  assert.equal(dispatches, phase === 'dispatch' ? 1 : 0)
  assert.equal(reads, phase === 'reserve' ? 0 : phase === 'read' ? 1 : 2)
  assert.equal(releases, phase === 'reserve' ? 0 : 1)
})

test('停止消费或取消不提前释放仍在排空的图片请求，真实终态只归还一次预算', async () => {
  const controller = new AbortController()
  const source = new AssistantMessageEventStream()
  let releases = 0
  const stream = await runtimeResourceStream(() => source, async () => 'fixture-pixels',
    async () => () => { releases++ })(compactionTestModel, context, { signal: controller.signal })
  source.push({ type: 'start', partial: compactionTestAssistant('') })
  const iterator = stream[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value?.type, 'start')
  await iterator.return?.()
  controller.abort()
  assert.equal(releases, 0)
  const cancelled = { ...compactionTestAssistant(''), stopReason: 'aborted' as const }
  source.push({ type: 'error', reason: 'aborted', error: cancelled })
  assert.equal((await stream.result()).stopReason, 'aborted')
  await stream.result()
  assert.equal(releases, 1)
})

function completedStream() {
  const source = new AssistantMessageEventStream()
  source.push({ type: 'done', reason: 'stop', message: compactionTestAssistant('完成') })
  return source
}

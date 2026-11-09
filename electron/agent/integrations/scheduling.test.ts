import assert from 'node:assert/strict'
import test from 'node:test'
import { IntegrationScheduler } from './scheduling.ts'

test('慢调用时队列按条数和字节有界，取消立即释放等待项', async () => {
  const scheduler = new IntegrationScheduler(1, 1, 100)
  let finish!: () => void
  const first = scheduler.run(20, undefined, () => new Promise<void>(resolve => { finish = resolve }))
  const cancel = new AbortController()
  const second = scheduler.run(40, cancel.signal, async () => { assert.fail('取消项不能执行') })
  const cancelled = assert.rejects(second, { name: 'AbortError' })
  assert.deepEqual(scheduler.usage(), { active: 1, queued: 1, bytes: 40 })
  await assert.rejects(scheduler.run(1, undefined, async () => {}), /QUEUE_FULL/u)
  cancel.abort()
  await cancelled
  assert.equal(scheduler.usage().bytes, 0)
  finish()
  await first
  assert.deepEqual(scheduler.usage(), { active: 0, queued: 0, bytes: 0 })
})

test('失败后名额归还，关闭会拒绝等待和新请求', async () => {
  const scheduler = new IntegrationScheduler(1)
  await assert.rejects(scheduler.run(0, undefined, async () => { throw new Error('failure') }), /failure/u)
  let finish!: () => void
  const first = scheduler.run(0, undefined, () => new Promise<void>(resolve => { finish = resolve }))
  const second = scheduler.run(0, undefined, async () => {})
  const rejected = assert.rejects(second, /HOST_CLOSED/u)
  scheduler.close()
  await rejected
  finish()
  await first
  await assert.rejects(scheduler.run(0, undefined, async () => {}), /HOST_CLOSED/u)
})

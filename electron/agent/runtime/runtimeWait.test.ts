import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { RuntimeWait } from './runtimeWait.ts'

test('runtime wait expires without a model poll or retained abort listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const wait = new RuntimeWait(), controller = new AbortController()
  let progress = 0
  const task = wait.tool(() => undefined, () => { progress++ }).execute('call', { duration_seconds: 20 }, controller.signal)
  assert.equal(progress, 1)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1)
  t.mock.timers.tick(20_000)
  const result = await task
  assert.equal((result.details as { wake_reason: string }).wake_reason, 'elapsed')
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})

for (const reason of ['steer', 'task_update'] as const) {
  test(`runtime wait wakes for ${reason}, including a receipt already queued`, async () => {
    const wait = new RuntimeWait()
    const tool = wait.tool(() => undefined, () => {})
    const task = tool.execute('call', { duration_seconds: 60 }, new AbortController().signal)
    wait.wake(reason)
    assert.equal((await task).details?.wake_reason, reason)
    const queued = await wait.tool(() => reason, () => {}).execute('queued', { duration_seconds: 60 })
    assert.equal(queued.details?.wake_reason, reason)
  })
}

test('abort and worker close settle the active wait and release listeners', async () => {
  for (let i = 0; i < 50; i++) {
    const wait = new RuntimeWait(), controller = new AbortController()
    const task = wait.tool(() => undefined, () => {}).execute('call', { duration_seconds: 60 }, controller.signal)
    const settled = assert.rejects(task)
    if (i % 2) controller.abort(new Error('stopped'))
    else wait.close()
    await settled
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    wait.wake('task_update')
  }
})

test('invalid or historical waits are not silently resumed', async () => {
  const wait = new RuntimeWait(), tool = wait.tool(() => undefined, () => {})
  for (const duration_seconds of [0, 61, 1.5, NaN]) await assert.rejects(tool.execute('bad', { duration_seconds }), /ARGUMENTS_INVALID/u)
  wait.close()
  await assert.rejects(tool.execute('old', { duration_seconds: 1 }), /CLOSED/u)
})

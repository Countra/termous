import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canApplyReloadedValue,
  SerialMutationQueue,
} from '#shared/async'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

test('串行写队列等待慢请求完成后才提交较新的设置意图', async () => {
  const queue = new SerialMutationQueue()
  const first = createDeferred<string>()
  const second = createDeferred<string>()
  const started: string[] = []
  const committed: string[] = []

  const firstResult = queue.enqueue(async () => {
    started.push('first')
    const value = await first.promise
    committed.push(value)
    return value
  })
  const secondResult = queue.enqueue(async () => {
    started.push('second')
    const value = await second.promise
    committed.push(value)
    return value
  })

  await flushPromises()
  assert.deepEqual(started, ['first'])
  second.resolve('latest')
  await flushPromises()
  assert.deepEqual(started, ['first'])

  first.resolve('older')
  assert.equal(await firstResult, 'older')
  await flushPromises()
  assert.deepEqual(started, ['first', 'second'])
  assert.equal(await secondResult, 'latest')
  assert.deepEqual(committed, ['older', 'latest'])
  assert.equal(committed[committed.length - 1], 'latest')
})

test('较早写入失败不会阻塞队列中的最新设置', async () => {
  const queue = new SerialMutationQueue()
  const expectedError = new Error('older failed')
  const committed: string[] = []

  const firstResult = queue.enqueue(async () => {
    throw expectedError
  })
  const secondResult = queue.enqueue(async () => {
    committed.push('latest')
    return 'latest'
  })

  await assert.rejects(firstResult, expectedError)
  assert.equal(await secondResult, 'latest')
  assert.deepEqual(committed, ['latest'])
})

test('过期 reload 不会覆盖在加载期间完成的设置写入', () => {
  const checkpoint = { generation: 4, hadPendingWrites: false }

  assert.equal(canApplyReloadedValue(checkpoint, 4, 0), true)
  assert.equal(canApplyReloadedValue(checkpoint, 5, 0), false)
  assert.equal(canApplyReloadedValue(checkpoint, 4, 1), false)
  assert.equal(canApplyReloadedValue({ generation: 4, hadPendingWrites: true }, 4, 0), false)
})

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

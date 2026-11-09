import assert from 'node:assert/strict'
import test from 'node:test'
import { ImageMaterializationBudget } from './imageMaterializationBudget.ts'
import { ImageMaterializationLease } from '../worker/imageMaterializationLease.ts'

test('图片预算保持 FIFO，超预算单请求独占，退出释放等待者', () => {
  const pool = new ImageMaterializationBudget(100)
  const grants: string[] = []
  const add = (id: string, bytes: number) => pool.acquire({ owner: id, id, bytes, grant: () => { grants.push(id) } })
  add('a', 60); add('b', 90); add('c', 10)
  assert.deepEqual(grants, ['a'])
  pool.release('a')
  assert.deepEqual(grants, ['a', 'b', 'c'])
  add('large', 1000); add('last', 1)
  pool.release('b'); pool.release('c')
  assert.deepEqual(grants, ['a', 'b', 'c', 'large'])
  pool.release('large')
  assert.equal(grants[grants.length - 1], 'last')
})

test('取消物化等待会释放排队项，迟到准入不会留下租约', async () => {
  const messages: Array<{ id: string; action: string }> = []
  const lease = new ImageMaterializationLease((id, _bytes, action) => { messages.push({ id, action }) })
  const controller = new AbortController()
  const pending = lease.acquire(800 * 1024 * 1024, controller.signal)
  const id = messages[0]!.id
  controller.abort(new Error('cancelled'))
  await assert.rejects(pending, /cancelled/u)
  lease.granted(id)
  assert.deepEqual(messages.map(value => value.action), ['acquire', 'release'])
  await assert.rejects(lease.acquire(Number.POSITIVE_INFINITY), /BUDGET_INVALID/u)
})

test('已准入租约只释放一次', async () => {
  const actions: string[] = []
  const lease = new ImageMaterializationLease((id, _bytes, action) => {
    actions.push(action)
    if (action === 'acquire') queueMicrotask(() => lease.granted(id))
  })
  const release = await lease.acquire(1024)
  release(); release()
  assert.deepEqual(actions, ['acquire', 'release'])
})

test('同一 Worker 不能积累物化请求，通信失败释放额度并明确失败', async () => {
  const pool = new ImageMaterializationBudget(100)
  pool.acquire({ owner: 'worker', id: 'first', bytes: 100, grant: () => {} })
  assert.throws(() => pool.acquire({ owner: 'worker', id: 'second', bytes: 10, grant: () => {} }), /PENDING/u)
  let failure: unknown
  pool.acquire({ owner: 'broken', id: 'third', bytes: 50, grant: () => { throw new Error('closed') }, reject: error => { failure = error } })
  pool.release('worker')
  assert.match(String(failure), /closed/u)
  let granted = false
  pool.acquire({ owner: 'next', id: 'next', bytes: 100, grant: () => { granted = true } })
  assert.ok(granted)
  const lease = new ImageMaterializationLease((id, _bytes, action) => { if (action === 'acquire') queueMicrotask(() => lease.rejected(id)) })
  await assert.rejects(lease.acquire(50), /UNAVAILABLE/u)
})

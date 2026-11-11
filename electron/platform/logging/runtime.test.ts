import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { ProcessLogger } from './runtime.ts'
import { createRecord, maxRecordBytes } from './record.ts'

const entries = (batches: string[]) => batches.join('').trim().split('\n').filter(Boolean).map(line => JSON.parse(line.slice('[termous:electron] '.length)))

test('单个输出端阻塞时另一个仍能记录新故障，阻塞端只有一次在途写入', async () => {
  for (const stalled of ['file', 'stderr'] as const) {
    const healthy: string[] = [], slow: string[] = []
    let release!: () => void, calls = 0
    const blocked = new Promise<void>(resolve => { release = resolve })
    const logger = new ProcessLogger([
      { name: stalled, async write(batch) { slow.push(batch); calls++; await blocked } },
      { name: stalled === 'file' ? 'stderr' : 'file', async write(batch) { healthy.push(batch) } },
    ])
    logger.report('first', {})
    await nextTurn(); await nextTurn()
    logger.report('important_failure', { error_code: 'desktop_ice_timeout' }, 'warn')
    await nextTurn(); await nextTurn()
    assert.ok(entries(healthy).some(value => value.event === 'important_failure'))
    assert.equal(calls, 1)
    assert.equal(await logger.flush(5), false)
    release(); assert.equal(await logger.flush(), true)
    assert.ok(entries(slow).some(value => value.event === 'important_failure'))
    logger.report('after_recovery', {}); await logger.flush()
    assert.equal(calls, 3)
  }
})

test('正常突发日志完整送达快慢输出端', async () => {
  const fast: string[] = [], slow: string[] = []
  let release!: () => void, calls = 0
  const blocked = new Promise<void>(resolve => { release = resolve })
  const logger = new ProcessLogger([
    { name: 'file', async write(batch) { slow.push(batch); if (++calls === 1) await blocked } },
    { name: 'stderr', async write(batch) { fast.push(batch) } },
  ])
  for (let i = 0; i < 200; i++) logger.report('burst', { i })
  assert.equal(await logger.flush(5), false)
  release(); assert.equal(await logger.flush(), true)
  assert.deepEqual(entries(slow), entries(fast))
  assert.equal(entries(slow).length, 200)
})

test('长期单端阻塞仅淘汰其积压副本，健康端继续接收新日志并保留告警', async () => {
  const fast: string[] = [], slow: string[] = []
  let release!: () => void, delivered!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const logger = new ProcessLogger([
    { name: 'file', async write(batch) { slow.push(batch); await blocked } },
    { name: 'stderr', async write(batch) { fast.push(batch); if (entries([batch]).some(value => value.event === 'boundary')) delivered() } },
  ])
  logger.report('first', {}); await nextTurn()
  for (let burst = 0; burst < 5; burst++) {
    const read = new Promise<void>(resolve => { delivered = resolve })
    for (let i = 0; i < 250; i++) logger.report('progress', { i, burst })
    logger.report('boundary', { burst }, 'warn')
    await read
  }
  assert.equal(slow.length, 1)
  assert.equal(entries(fast).filter(value => value.event === 'progress').length, 1250)
  release(); assert.equal(await logger.flush(), true)
  const logs = entries(slow)
  assert.equal(logs.filter(value => value.event === 'boundary').length, 5)
  assert.ok(logs.filter(value => value.event === 'progress').length < 1250)
  assert.ok(logs.length <= 1026)
  assert.ok(logs.some(value => value.event === 'logging.output_dropped' && value.file > 0))
})

test('慢输出不会阻塞调用，队列满载有界并为失败摘要保留空间', async () => {
  const batches: string[] = []
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  const logger = new ProcessLogger([{ name: 'file', async write(batch) { batches.push(batch); if (++calls === 1) await blocked } }])
  logger.report('first', {})
  assert.equal(calls, 0)
  await nextTurn()
  assert.equal(calls, 1)
  for (let i = 0; i < 4000; i++) logger.report('progress', { i })
  logger.report('desktop.remote.connection', { error_code: 'desktop_ice_timeout' }, 'warn')
  assert.equal(await logger.flush(5), false)
  assert.equal(calls, 1)
  release()
  assert.equal(await logger.flush(), true)
  const logs = entries(batches)
  assert.ok(logs.some(value => value.error_code === 'desktop_ice_timeout'))
  assert.ok(logs.some(value => value.event === 'logging.queue_dropped' && value.info > 0))
  assert.ok(logs.length <= 1026)
  assert.ok(Buffer.byteLength(batches.join('')) <= 1024 * 1024 + maxRecordBytes)
  assert.ok(batches.every(batch => Buffer.byteLength(batch) <= 64 * 1024 && batch.trim().split('\n').length <= 64))
})

test('两个输出端同时阻塞时有界等待，迟到失败不拖住另一端恢复', async () => {
  let reject!: (error: Error) => void, release!: () => void, fileCalls = 0, stderrCalls = 0
  let delivered!: () => void
  const deliveredFailure = new Promise<void>(resolve => { delivered = resolve })
  const failed = new Promise<void>((_, no) => { reject = no })
  const stalled = new Promise<void>(yes => { release = yes })
  const batches: string[] = []
  const logger = new ProcessLogger([
    { name: 'file', async write() { fileCalls++; await failed } },
    { name: 'stderr', async write(batch) { batches.push(batch); if (batch.includes('important_failure')) delivered(); if (++stderrCalls === 1) await stalled } },
  ])
  logger.report('first', {}); await nextTurn()
  for (let i = 0; i < 4000; i++) logger.report('progress', { i })
  logger.report('important_failure', {}, 'error')
  await nextTurn()
  assert.equal(fileCalls, 1); assert.equal(stderrCalls, 1)
  assert.equal(await logger.flush(5), false)
  release(); await deliveredFailure
  assert.ok(entries(batches).some(value => value.event === 'important_failure'))
  reject(new Error('private-output-error'))
  assert.equal(await logger.flush(), true)
  logger.report('after_failure', {}); await logger.flush()
  const logs = entries(batches)
  assert.equal(fileCalls, 1)
  assert.equal(logs.filter(value => value.event === 'logging.output_failed').length, 1)
  assert.ok(logs.some(value => value.event === 'logging.output_dropped' && value.file > 0))
  assert.ok(logs.length <= 1030)
  assert.doesNotMatch(batches.join(''), /private-output-error/)
})

test('字节预算生效且高等级记录可以淘汰普通积压', async () => {
  const batches: string[] = []
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  const logger = new ProcessLogger([{ name: 'file', async write(batch) { batches.push(batch); if (++calls === 1) await blocked } }])
  logger.report('first', {}); await nextTurn()
  const large = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i), 'x'.repeat(1024)]))
  for (let i = 0; i < 500; i++) logger.report('large', large)
  for (let i = 0; i < 128; i++) logger.report('failure', { i }, 'error')
  release(); assert.equal(await logger.flush(), true)
  const logs = entries(batches)
  assert.equal(logs.filter(value => value.event === 'failure').length, 128)
  assert.ok(Buffer.byteLength(batches.join('')) <= 1024 * 1024 + maxRecordBytes)
})

test('快照不会保留业务对象，不调用 getter，正文和单条大小受限', async () => {
  const batches: string[] = [], logger = new ProcessLogger([{ name: 'file', async write(batch) { batches.push(batch) } }])
  let getters = 0
  const fields = { nested: { count: 1 }, items: ['one', { enabled: true }], token: 'private-token', message: 'Bearer private-bearer https://user:pass@example.test' }
  Object.defineProperty(fields, 'unsafe', { enumerable: true, get() { getters++; throw new Error('private') } })
  logger.report('snapshot', fields)
  fields.nested.count = 2
  await logger.flush()
  assert.equal(entries(batches)[0].nested.count, 1)
  assert.deepEqual(entries(batches)[0].items, ['one', { enabled: true }])
  assert.equal(getters, 0)
  assert.doesNotMatch(batches.join(''), /private-token|private-bearer|user:pass/)
  const oversized = createRecord('info', 'oversized', Object.fromEntries(Array.from({ length: 100 }, (_, i) => [String(i), '汉'.repeat(4000)])))
  assert.ok(oversized.bytes <= maxRecordBytes)
  assert.doesNotThrow(() => JSON.parse(oversized.line.slice('[termous:electron] '.length)))
  const prefix = 'k'.repeat(64)
  logger.report('nested_keys', { nested: { [prefix + 'a']: 1, [prefix + 'b']: 2, result: 'retained' } })
  await logger.flush()
  const snapshots = entries(batches)
  assert.deepEqual(snapshots[snapshots.length - 1].nested, { result: 'retained' })
})

test('写入失败不会递归或持续重试，恢复后继续使用同一日志入口', async t => {
  let now = 0, writes = 0
  t.mock.method(performance, 'now', () => now)
  const batches: string[] = []
  const logger = new ProcessLogger([
    { name: 'file', async write() { writes++; if (writes === 1) throw new Error('private-path') } },
    { name: 'stderr', async write(batch) { batches.push(batch) } },
  ])
  logger.report('first', {}); assert.equal(await logger.flush(), true)
  await nextTurn(); assert.equal(writes, 1)
  logger.report('second', {}); await logger.flush(); assert.equal(writes, 1)
  assert.equal(entries(batches).filter(value => value.event === 'logging.output_failed').length, 1)
  now = 30_001
  logger.report('recovered', {}); await logger.flush(); assert.equal(writes, 2)
  assert.doesNotMatch(batches.join(''), /private-path/)
})

test('排空不关闭日志，后续恢复日志仍可写', async () => {
  const batches: string[] = [], logger = new ProcessLogger([{ name: 'file', async write(batch) { batches.push(batch) } }])
  logger.report('update_ready', {}); await logger.flush()
  logger.report('update_failed', {}, 'error'); await logger.flush()
  assert.deepEqual(entries(batches).map(value => value.event), ['update_ready', 'update_failed'])
})

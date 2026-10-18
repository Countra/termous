import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalOutput } from './terminalOutput.ts'

test('网络额度合并发送，渲染回执不等待网络', async () => {
  const credits: number[] = []
  let unblock!: () => void
  const output = new TerminalOutput((_data, done) => done(), bytes => {
    credits.push(bytes)
    return credits.length === 2 ? new Promise(resolve => { unblock = resolve }) : Promise.resolve()
  }, () => assert.fail('不应出现发送错误'))
  await output.start()
  await output.consume(Uint8Array.of(1))
  await output.consume(Uint8Array.of(2, 3))
  await output.consume(Uint8Array.of(4))
  assert.deepEqual(credits, [65536, 1])
  unblock()
  await Promise.resolve()
  assert.deepEqual(credits, [65536, 1, 3])
  output.dispose()
})

test('发送结果不明只报告一次，迟到渲染不补发额度', async () => {
  const rendering: (() => void)[] = []
  const error = new Error('发送结果不明')
  const failures: unknown[] = []
  let sends = 0
  const output = new TerminalOutput((_data, done) => { rendering.push(done) }, async () => { if (++sends === 2) throw error }, failure => failures.push(failure))
  await output.start()
  const first = output.consume(Uint8Array.of(1))
  const second = output.consume(Uint8Array.of(2))
  rendering[0]!()
  await Promise.all([first, second])
  rendering[1]!()
  await output.consume(Uint8Array.of(3))
  assert.equal(sends, 2)
  assert.deepEqual(failures, [error])
})

test('视图销毁收口所有渲染回执，迟到失败不通知新视图', async () => {
  let reject!: (error: Error) => void
  let done!: () => void
  const output = new TerminalOutput((_data, callback) => { done = callback }, () => new Promise((_, fail) => { reject = fail }), () => assert.fail('旧视图不能通知新页面'))
  const opening = output.start()
  const received = output.consume(Uint8Array.of(1))
  output.dispose()
  await received
  done()
  reject(new Error('迟到发送失败'))
  assert.equal(await opening, false)
})

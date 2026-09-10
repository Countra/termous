import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import type { AgentWorkerProcess } from '../agent/workerProcess.ts'
import { TerminalCompletionRuntime } from './runtime.ts'
import { completionFailure } from './protocol.ts'
import { completionTestBootstrap, completionTestRequest } from './testFixture.ts'
import { emptyRuntimeUsage } from '../agent/runtimeUsage.ts'

test('bootstrap 与 Worker 全流程受一个期限约束，超时后迟到准备结果不能启动进程', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let resolve!: (value: ReturnType<typeof completionTestBootstrap>) => void
  let creates = 0
  const runtime = new TerminalCompletionRuntime({ bootstrap: () => new Promise((done) => { resolve = done }), workerFactory: { create() { creates++; return new FakeWorker() } } })
  const task = runtime.generate(completionTestRequest(), 1)
  t.mock.timers.tick(30000)
  const result = await task
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') assert.equal(result.code, 'TERMINAL_AI_TIMEOUT')
  resolve(completionTestBootstrap())
  await setImmediate()
  assert.equal(creates, 0)
})

test('bootstrap 已消耗的时间不能在 Worker 启动后重新计时', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const worker = new FakeWorker()
  let resolve!: (value: ReturnType<typeof completionTestBootstrap>) => void
  const runtime = new TerminalCompletionRuntime({ bootstrap: () => new Promise((done) => { resolve = done }), workerFactory: { create: () => worker } })
  const task = runtime.generate(completionTestRequest(), 1)
  t.mock.timers.tick(10000)
  resolve(completionTestBootstrap())
  await setImmediate()
  worker.spawn?.()
  t.mock.timers.tick(19999)
  assert.equal(worker.messages.length, 1)
  t.mock.timers.tick(1)
  const result = await task
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') assert.equal(result.code, 'TERMINAL_AI_TIMEOUT')
  assert.deepEqual(worker.messages[1], { type: 'abort', requestId: 'req_test' })
  worker.exit?.(0)
  assert.equal(await runtime.stop(), true)
})

test('运行中最多一个补全，取消只允许所属窗口和请求，2秒后回收且不接受迟到结果', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const worker = new FakeWorker()
  const runtime = new TerminalCompletionRuntime({ bootstrap: async () => completionTestBootstrap(), workerFactory: { create: () => worker } })
  const request = completionTestRequest()
  const task = runtime.generate(request, 1)
  await setImmediate()
  worker.spawn?.()
  const busy = await runtime.generate({ ...request, requestId: 'req_other' }, 1)
  assert.equal(busy.status, 'failed')
  if (busy.status === 'failed') assert.equal(busy.code, 'TERMINAL_AI_BUSY')
  runtime.cancel(request, 2)
  assert.equal(worker.messages.length, 1)
  runtime.cancel(request, 1)
  assert.equal((await task).status, 'cancelled')
  assert.equal(worker.messages.length, 2)
  worker.message?.(completionFailure(request, 'TERMINAL_AI_REQUEST_FAILED', '迟到的错误'))
  t.mock.timers.tick(1999)
  assert.equal(worker.kills, 0)
  t.mock.timers.tick(1)
  assert.equal(worker.kills, 1)
  assert.equal(await runtime.stop(), true)
})

test('未确认 Worker 退出时保留运行槽位，退出确认后才允许新请求', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const worker = new FakeWorker()
  worker.kill = () => { worker.kills++; return false }
  const runtime = new TerminalCompletionRuntime({ bootstrap: async () => completionTestBootstrap(), workerFactory: { create: () => worker } })
  const request = completionTestRequest()
  const task = runtime.generate(request, 1)
  await setImmediate()
  worker.spawn?.()
  const stopping = runtime.stop()
  assert.equal((await task).status, 'cancelled')
  t.mock.timers.tick(4000)
  assert.equal(await stopping, false)
  assert.equal(worker.kills, 1)
  runtime.resume()
  const busy = await runtime.generate(request, 1)
  assert.equal(busy.status, 'failed')
  if (busy.status === 'failed') assert.equal(busy.code, 'TERMINAL_AI_BUSY')
  worker.exit?.(0)
  const next = runtime.generate(request, 1)
  await setImmediate()
  worker.spawn?.()
  worker.exit?.(9)
  const result = await next
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') assert.equal(result.code, 'TERMINAL_AI_WORKER_EXITED')
  assert.equal(await runtime.stop(), true)
})

test('Worker 返回前严格校验请求快照，退出后正常释放下一请求', async () => {
  const worker = new FakeWorker()
  const runtime = new TerminalCompletionRuntime({ bootstrap: async () => completionTestBootstrap(), workerFactory: { create: () => worker }, abortGraceMs: 1 })
  const request = completionTestRequest()
  const task = runtime.generate(request, 1)
  await setImmediate()
  worker.spawn?.()
  worker.message?.(completionFailure({ ...request, inputSnapshot: { ...request.inputSnapshot, revision: 99 } }, 'TERMINAL_AI_REQUEST_FAILED', '错误'))
  const result = await task
  assert.equal(result.status, 'failed')
  if (result.status === 'failed') assert.equal(result.code, 'TERMINAL_AI_RESPONSE_INVALID')
  worker.exit?.(0)
  assert.equal(await runtime.stop(), true)
})

test('准备阶段关闭窗口会取消HTTP且不创建Worker，敏感异常不会向界面透传', async () => {
  let signal: AbortSignal | undefined
  const runtime = new TerminalCompletionRuntime({
    bootstrap: async (_request, current) => { signal = current; throw new Error('key=private; /private/context') },
    workerFactory: { create: () => { throw new Error('不应启动') } },
  })
  const request = completionTestRequest()
  const task = runtime.generate(request, 1)
  runtime.cancelOwner(1)
  assert.equal((await task).status, 'cancelled')
  assert.equal(signal?.aborted, true)
  const failed = await runtime.generate(request, 1)
  assert.equal(failed.status, 'failed')
  assert.doesNotMatch(JSON.stringify(failed), /private/u)
})

test('终态诊断仅包含模型、用量和计时，取消后到达的用量保留且不重复记录', async () => {
  const worker = new FakeWorker()
  const logs: unknown[] = []
  const runtime = new TerminalCompletionRuntime({ bootstrap: async () => completionTestBootstrap(), workerFactory: { create: () => worker }, onFinished: (entry) => logs.push(entry) })
  const request = completionTestRequest()
  const task = runtime.generate(request, 1)
  await setImmediate()
  worker.spawn?.()
  runtime.cancel(request, 1)
  const result = await task
  worker.message?.({ type: 'usage', requestId: request.requestId, usage: { ...emptyRuntimeUsage(), input_tokens: 10, total_tokens: 10 } })
  worker.exit?.(0)
  assert.equal(result.status, 'cancelled')
  assert.equal(logs.length, 1)
  assert.match(JSON.stringify(logs), /test-model|input_tokens/u)
  assert.doesNotMatch(JSON.stringify(logs), /fixture-secret|\/home\/test|df|查看磁盘/u)
  assert.equal(await runtime.stop(), true)
})

class FakeWorker implements AgentWorkerProcess {
  messages: unknown[] = []
  kills = 0
  spawn?: () => void
  exit?: (code: number) => void
  message?: (value: unknown) => void
  postMessage(value: unknown) { this.messages.push(value) }
  kill() { this.kills++; this.exit?.(0); return true }
  onSpawn(listener: () => void) { this.spawn = listener; return () => { this.spawn = undefined } }
  onExit(listener: (code: number) => void) { this.exit = listener; return () => { this.exit = undefined } }
  onMessage(listener: (value: unknown) => void) { this.message = listener; return () => { this.message = undefined } }
}

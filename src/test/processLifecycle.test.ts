import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { AsyncSingleflight } from '../../electron/asyncSingleflight.ts'
import {
  waitForChildProcessExit,
  type ChildProcessExitObservable,
} from '../../electron/childProcessLifecycle.ts'

class FakeChildProcess extends EventEmitter implements ChildProcessExitObservable {
  exitCode: number | null = null

  exit(code = 0) {
    this.exitCode = code
    this.emit('exit')
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

test('进程退出等待在收到 exit 后立即清理监听器', async () => {
  const child = new FakeChildProcess()
  const waiting = waitForChildProcessExit(child, 1000)

  assert.equal(child.listenerCount('exit'), 1)
  child.exit()

  assert.equal(await waiting, true)
  assert.equal(child.listenerCount('exit'), 0)
})

test('进程退出等待超时后清理监听器且迟到事件不会改变结果', async () => {
  const child = new FakeChildProcess()
  const waiting = waitForChildProcessExit(child, 5)

  assert.equal(await waiting, false)
  assert.equal(child.listenerCount('exit'), 0)
  child.exit()
  assert.equal(child.listenerCount('exit'), 0)
})

test('已经退出的进程不注册额外监听器', async () => {
  const child = new FakeChildProcess()
  child.exitCode = 0

  assert.equal(await waitForChildProcessExit(child, 1000), true)
  assert.equal(child.listenerCount('exit'), 0)
})

test('异步 singleflight 复用进行中 Promise 并在终态后释放', async () => {
  const gate = new AsyncSingleflight<number>()
  const operation = deferred<number>()
  let calls = 0

  const first = gate.run(() => {
    calls += 1
    return operation.promise
  })
  const second = gate.run(() => {
    calls += 1
    return Promise.resolve(2)
  })

  assert.equal(first, second)
  assert.equal(gate.isRunning(), true)
  operation.resolve(1)
  assert.equal(await first, 1)
  await Promise.resolve()
  assert.equal(gate.isRunning(), false)
  assert.equal(await gate.run(async () => {
    calls += 1
    return 2
  }), 2)
  assert.equal(calls, 2)
})

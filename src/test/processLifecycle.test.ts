import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { AsyncSingleflight } from '../../electron/asyncSingleflight.ts'
import {
  clearObservedChildProcess,
  stopOwnedChildProcess,
  waitForChildProcessExit,
  type ChildProcessExitObservable,
  type ChildProcessTerminationObservable,
} from '../../electron/childProcessLifecycle.ts'

class FakeChildProcess extends EventEmitter implements ChildProcessExitObservable {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  onExitListenerAttached: (() => void) | null = null

  override once(event: 'exit', listener: () => void) {
    const result = super.once(event, listener)
    this.onExitListenerAttached?.()
    return result
  }

  exit(code = 0) {
    this.exitCode = code
    this.emit('exit')
  }
}

class FakeTerminableChildProcess extends FakeChildProcess implements ChildProcessTerminationObservable {
  pid: number | undefined = 4242
  readonly killSignals: Array<NodeJS.Signals | number> = []
  onKill: ((signal: NodeJS.Signals | number) => void) | null = null

  kill(signal: NodeJS.Signals | number = 'SIGTERM') {
    this.killSignals.push(signal)
    this.onKill?.(signal)
    return true
  }

  exitWithSignal(signal: NodeJS.Signals) {
    this.signalCode = signal
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

test('信号退出以及监听注册竞态都能识别终态', async () => {
  const alreadyExited = new FakeChildProcess()
  alreadyExited.signalCode = 'SIGTERM'
  assert.equal(await waitForChildProcessExit(alreadyExited, 1000), true)
  assert.equal(alreadyExited.listenerCount('exit'), 0)

  const racedExit = new FakeChildProcess()
  racedExit.onExitListenerAttached = () => {
    racedExit.signalCode = 'SIGKILL'
  }
  assert.equal(await waitForChildProcessExit(racedExit, 1000), true)
  assert.equal(racedExit.listenerCount('exit'), 0)
})

test('旧进程迟到退出时不会清除已经替换的新进程引用', () => {
  const oldChild = new FakeChildProcess()
  const replacement = new FakeChildProcess()

  assert.equal(
    clearObservedChildProcess(replacement, oldChild),
    replacement,
  )
  assert.equal(
    clearObservedChildProcess(oldChild, oldChild),
    null,
  )
})

test('停止托管子进程会先等待优雅退出', async () => {
  const child = new FakeTerminableChildProcess()
  child.onKill = (signal) => {
    if (signal === 'SIGTERM') {
      child.exitWithSignal('SIGTERM')
    }
  }

  await stopOwnedChildProcess(child, {
    gracefulTimeoutMs: 100,
    forceTimeoutMs: 100,
  })

  assert.deepEqual(child.killSignals, ['SIGTERM'])
  assert.equal(child.listenerCount('exit'), 0)
})

test('优雅退出超时后强制终止并再次确认退出', async () => {
  const child = new FakeTerminableChildProcess()
  child.onKill = (signal) => {
    if (signal === 'SIGKILL') {
      child.exitWithSignal('SIGKILL')
    }
  }

  await stopOwnedChildProcess(child, {
    gracefulTimeoutMs: 0,
    forceTimeoutMs: 100,
  })

  assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL'])
  assert.equal(child.listenerCount('exit'), 0)
})

test('强制终止后仍未退出会抛错并保留失败信号', async () => {
  const child = new FakeTerminableChildProcess()

  await assert.rejects(stopOwnedChildProcess(child, {
    gracefulTimeoutMs: 0,
    forceTimeoutMs: 0,
  }), /无法终止/)

  assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL'])
  assert.equal(child.listenerCount('exit'), 0)
})

test('spawn 未创建系统进程时不发送终止信号', async () => {
  const child = new FakeTerminableChildProcess()
  child.pid = undefined

  await stopOwnedChildProcess(child, {
    gracefulTimeoutMs: 0,
    forceTimeoutMs: 0,
  })

  assert.deepEqual(child.killSignals, [])
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

import assert from 'node:assert/strict'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type { CoreRuntimeConfig } from './coreProcess.ts'

const managerURL = new URL('./coreProcess.ts', import.meta.url).href
const electronStub = `data:text/javascript,${encodeURIComponent("export const app={getVersion:()=> 'test'}; export const BrowserWindow={getAllWindows:()=>[]}")}`
// 仅为被测管理器替换 Electron 宿主，进程状态和异步生命周期使用真实实现。
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === managerURL) {
      if (specifier === 'electron') return { url: electronStub, shortCircuit: true }
      if (specifier.startsWith('./') && !specifier.endsWith('.ts')) return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})
const CoreProcessManager = await (async () => {
  try {
    const module = await import(managerURL)
    return module.CoreProcessManager as typeof import('./coreProcess.ts').CoreProcessManager
  } finally {
    hooks.deregister()
  }
})()

interface ManagerInternals {
  child: ChildProcessWithoutNullStreams | null
  config: CoreRuntimeConfig
  runtimeReady: boolean
  shuttingDown: boolean
  lastHeartbeatAt: number
  initializeOnce(): Promise<CoreRuntimeConfig>
  stopChildOnly(): Promise<void>
  stopHeartbeat(): void
  sendHeartbeat(): Promise<void>
  fetchWithTimeout(pathname: string, init?: RequestInit): Promise<Response>
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

function fakeChild(pid = 123) {
  return Object.assign(new EventEmitter(), {
    pid, exitCode: null as number | null, signalCode: null, kill: () => true,
  })
}

test('启动状态订阅者同步重入 initialize 仍复用同一个启动 Promise', async (t) => {
  const manager = new CoreProcessManager()
  const internals = manager as unknown as ManagerInternals
  let launches = 0
  t.mock.method(internals, 'initializeOnce', async () => { launches += 1; return internals.config })
  let nested: ReturnType<typeof manager.initialize> | undefined
  manager.onStatusChanged(() => { nested ??= manager.initialize() })
  const first = manager.initialize()
  await first
  assert.equal(nested, first)
  assert.equal(launches, 1)
})

test('自动失败清理期间用户退出不会被清理结束覆盖，也不会再次初始化 Core', async (t) => {
  const manager = new CoreProcessManager()
  const internals = manager as unknown as ManagerInternals
  const child = fakeChild()
  internals.child = child as unknown as ChildProcessWithoutNullStreams
  const cleaning = internals.stopChildOnly()
  const exiting = manager.shutdownGracefully()
  child.exitCode = 0
  child.emit('exit')
  await cleaning
  assert.equal(await exiting, true)
  assert.equal(internals.shuttingDown, true)
  let launches = 0
  t.mock.method(internals, 'initializeOnce', async () => { launches += 1; return internals.config })
  await manager.initialize()
  assert.equal(launches, 0)
  await assert.rejects(manager.recoverAfterFailedUpdateInstall(), /正在退出/)
})

test('停止或替换 Core 后的迟到心跳既不触发失败也不更新健康时间', async (t) => {
  for (const ok of [false, true]) {
    const manager = new CoreProcessManager()
    const internals = manager as unknown as ManagerInternals
    internals.config = { ...internals.config, managed: true }
    internals.runtimeReady = true
    internals.child = fakeChild() as unknown as ChildProcessWithoutNullStreams
    internals.lastHeartbeatAt = 0
    const response = deferred<Response>()
    t.mock.method(internals, 'fetchWithTimeout', () => response.promise)
    const pending = internals.sendHeartbeat()
    internals.stopHeartbeat()
    internals.child = fakeChild(456) as unknown as ChildProcessWithoutNullStreams
    response.resolve(new Response(null, { status: ok ? 200 : 500 }))
    await pending
    assert.equal(manager.getFatal(), null)
    assert.equal(internals.lastHeartbeatAt, 0)
  }
})

test('恢复正在等待旧 Core 退出时用户退出，不会在旧进程结束后重启', async (t) => {
  const manager = new CoreProcessManager()
  const internals = manager as unknown as ManagerInternals
  const child = fakeChild()
  internals.child = child as unknown as ChildProcessWithoutNullStreams
  internals.runtimeReady = true
  internals.config = { ...internals.config, managed: true }
  t.mock.method(manager, 'initialize', async () => internals.config)
  const response = deferred<Response>()
  t.mock.method(internals, 'fetchWithTimeout', () => response.promise)
  const restoring = manager.restartAfterRestore()
  await Promise.resolve()
  const exiting = manager.shutdownGracefully()
  const rejected = assert.rejects(restoring, /正在退出/)
  child.exitCode = 0
  child.emit('exit')
  response.resolve(new Response(null, { status: 200 }))
  await rejected
  assert.equal(await exiting, true)
  assert.equal(internals.shuttingDown, true)
})

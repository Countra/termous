import assert from 'node:assert/strict'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type { CoreRuntimeConfig } from './coreProcess.ts'
import type { CoreStartupState } from './coreStartupState.ts'

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
  startup: CoreStartupState
  initializeOnce(): Promise<CoreRuntimeConfig>
  stopChildOnly(): Promise<void>
  stopHeartbeat(): void
  startHeartbeat(): void
  sendHeartbeat(): Promise<void>
  waitUntilReady(apiBaseUrl: string, token: string, child: ChildProcessWithoutNullStreams): Promise<void>
  fetchStatusWithTimeout(pathname: string, init?: RequestInit): Promise<Pick<Response, 'ok' | 'status'>>
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

function activeManager() {
  const manager = new CoreProcessManager({ channel: 'production' })
  const internals = manager as unknown as ManagerInternals
  const child = fakeChild()
  internals.config = { ...internals.config, apiBaseUrl: 'http://127.0.0.1:8122', managed: true }
  internals.runtimeReady = true
  internals.child = child as unknown as ChildProcessWithoutNullStreams
  internals.lastHeartbeatAt = 0
  return { manager, internals, child }
}

test('退出时等待维护状态正文读取完成，再提交关闭请求', async (t) => {
  const { manager, internals, child } = activeManager()
  t.after(() => internals.stopHeartbeat())
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const pathname = new URL(url).pathname
    requests.push(pathname)
    if (pathname === '/api/v1/ai-service/runtime') {
      return new Response(new ReadableStream({
        start(controller) {
          const timer = setTimeout(() => {
            controller.enqueue(new TextEncoder().encode('{"task":null}'))
            controller.close()
          }, 5)
          init.signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            controller.error(new DOMException('请求已中止', 'AbortError'))
          }, { once: true })
        },
      }))
    }
    assert.equal(pathname, '/api/v1/runtime/shutdown')
    child.exitCode = 0
    return new Response(null, { status: 202 })
  })
  assert.equal(await manager.shutdownGracefully(), true)
  assert.deepEqual(requests, ['/api/v1/ai-service/runtime', '/api/v1/runtime/shutdown'])
  assert.equal(manager.getShutdownFailure(), '')
})

test('维护状态正文停滞仍按单次请求期限中止，并保留 Core 和心跳', async (t) => {
  const { manager, internals } = activeManager()
  t.after(() => internals.stopHeartbeat())
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const pathname = new URL(url).pathname
    requests.push(pathname)
    if (pathname === '/api/v1/runtime/heartbeat') return new Response(null, { status: 200 })
    assert.equal(pathname, '/api/v1/ai-service/runtime')
    return new Response(new ReadableStream({
      start(controller) {
        init.signal?.addEventListener('abort', () => controller.error(new DOMException('超时', 'AbortError')), { once: true })
      },
    }))
  })
  const exiting = manager.shutdownGracefully()
  t.mock.timers.tick(5000)
  assert.equal(await exiting, false)
  assert.equal(internals.child?.exitCode, null)
  assert.equal(internals.shuttingDown, false)
  assert.deepEqual(requests, ['/api/v1/ai-service/runtime', '/api/v1/runtime/heartbeat'])
})

test('无法解析维护状态时保留应用，不能把错误响应当作没有维护任务', async (t) => {
  for (const value of [null, [], { task: [] }, { task: { id: 'install', phase: 'installing' } }]) {
    const { manager, internals } = activeManager()
    t.after(() => internals.stopHeartbeat())
    const requests: string[] = []
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      const pathname = new URL(url).pathname
      requests.push(pathname)
      return pathname === '/api/v1/ai-service/runtime' ? Response.json(value) : new Response(null, { status: 200 })
    })
    assert.equal(await manager.shutdownGracefully(), false)
    assert.equal(internals.child?.exitCode, null)
    assert.ok(!requests.includes('/api/v1/runtime/shutdown'))
    internals.stopHeartbeat()
  }
})

test('维护任务取消冲突后等待不可取消的写入完成，随后才关闭 Core', async (t) => {
  const { manager, internals, child } = activeManager()
  t.after(() => internals.stopHeartbeat())
  const tasks = [
    { id: 'install', phase: 'downloading', cancellable: true },
    { id: 'install', phase: 'installing', cancellable: false },
    { id: 'install', phase: 'complete', cancellable: false },
  ]
  let cancellations = 0
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const pathname = new URL(url).pathname
    if (pathname === '/api/v1/ai-service/runtime') return Response.json({ task: tasks.shift() })
    if (pathname === '/api/v1/ai-service/runtime/tasks/install') {
      assert.equal(init.method, 'DELETE')
      cancellations += 1
      return new Response(null, { status: 409 })
    }
    assert.equal(pathname, '/api/v1/runtime/shutdown')
    assert.equal(tasks.length, 0)
    child.exitCode = 0
    return new Response(null, { status: 202 })
  })
  assert.equal(await manager.shutdownGracefully(), true)
  assert.equal(cancellations, 1)
})

test('运行中短暂失联可恢复，连续一分钟失败才报告心跳超时', async (t) => {
  const { manager, internals } = activeManager()
  let now = 45_000
  let status = 503
  t.mock.method(performance, 'now', () => now)
  t.mock.method(internals, 'fetchStatusWithTimeout', async () => new Response(null, { status }))
  await internals.sendHeartbeat()
  assert.equal(manager.getFatal(), null)
  status = 200
  await internals.sendHeartbeat()
  assert.equal(internals.lastHeartbeatAt, 45_000)
  status = 503
  now = 104_999
  await internals.sendHeartbeat()
  assert.equal(manager.getFatal(), null)
  now = 105_000
  await internals.sendHeartbeat()
  assert.equal(manager.getFatal()?.code, 'CORE_HEARTBEAT_TIMEOUT')
  assert.match(manager.getFatal()!.message, /60 秒/)
})

test('系统校时不会把一次心跳失败误判为持续失联或延后真正超时', async (t) => {
  const { manager, internals } = activeManager()
  let elapsed = 10_000
  let wallTime = Date.now() + 3_600_000
  t.mock.method(performance, 'now', () => elapsed)
  t.mock.method(Date, 'now', () => wallTime)
  t.mock.method(internals, 'fetchStatusWithTimeout', async () => ({ ok: false, status: 503 }))
  await internals.sendHeartbeat()
  assert.equal(manager.getFatal(), null)
  wallTime -= 7_200_000
  elapsed = 60_000
  await internals.sendHeartbeat()
  assert.equal(manager.getFatal()?.code, 'CORE_HEARTBEAT_TIMEOUT')
})

test('就绪探针不能放行已经进入不可逆关闭的 Core', async (t) => {
  for (const phase of ['closing', 'closed']) {
    const { internals } = activeManager()
    internals.startup.begin('attempt', Date.now())
    t.mock.method(globalThis, 'fetch', async () => Response.json({ pid: 123, shutdown_phase: phase }))
    await assert.rejects(internals.waitUntilReady('http://127.0.0.1:8122', 'fixture', internals.child!), { code: 'CORE_START_FAILED' })
  }
})

test('就绪后立即发送心跳，同代请求不重叠，旧请求不能清除新代占用', async (t) => {
  const { manager, internals } = activeManager()
  t.after(() => internals.stopHeartbeat())
  const responses: ReturnType<typeof deferred<Response>>[] = []
  t.mock.method(internals, 'fetchStatusWithTimeout', () => {
    const response = deferred<Response>()
    responses.push(response)
    return response.promise
  })
  internals.startHeartbeat()
  assert.equal(responses.length, 1)
  await internals.sendHeartbeat()
  assert.equal(responses.length, 1)
  internals.stopHeartbeat()
  internals.startHeartbeat()
  assert.equal(responses.length, 2)
  responses[0].resolve(new Response(null, { status: 200 }))
  await Promise.resolve()
  await internals.sendHeartbeat()
  assert.equal(responses.length, 2)
  responses[1].resolve(new Response(null, { status: 200 }))
  await Promise.resolve()
  assert.equal(manager.getFatal(), null)
})

test('启动探针接受 45 秒慢启动，仍在固定期限拒绝迟到响应', async (t) => {
  for (const finishedAt of [45_000, 120_000]) {
    let now = 0
    t.mock.method(performance, 'now', () => now)
    const { internals } = activeManager()
    internals.startup.begin('attempt', 0)
    internals.startup.beginInstance('instance', 0)
    internals.startup.bindPID(123)
    now = 45_000
    t.mock.method(Date, 'now', () => now)
    t.mock.method(globalThis, 'fetch', async () => {
      now = finishedAt
      return Response.json({ pid: 123 })
    })
    const pending = internals.waitUntilReady('http://127.0.0.1:8122', 'fixture', internals.child!)
    if (finishedAt === 45_000) await pending
    else await assert.rejects(pending, { code: 'CORE_START_TIMEOUT' })
  }
})

test('探针在用户退出后才返回时不能宣告启动成功', async (t) => {
  const { internals } = activeManager()
  internals.startup.begin('attempt', Date.now())
  const response = deferred<Response>()
  t.mock.method(globalThis, 'fetch', () => response.promise)
  const pending = internals.waitUntilReady('http://127.0.0.1:8122', 'fixture', internals.child!)
  internals.shuttingDown = true
  response.resolve(Response.json({ pid: 123 }))
  await assert.rejects(pending, /已取消/)
})

test('启动状态订阅者同步重入 initialize 仍复用同一个启动 Promise', async (t) => {
  const manager = new CoreProcessManager({ channel: 'production' })
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
  const manager = new CoreProcessManager({ channel: 'production' })
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
    const manager = new CoreProcessManager({ channel: 'production' })
    const internals = manager as unknown as ManagerInternals
    internals.config = { ...internals.config, managed: true }
    internals.runtimeReady = true
    internals.child = fakeChild() as unknown as ChildProcessWithoutNullStreams
    internals.lastHeartbeatAt = 0
    const response = deferred<Response>()
    t.mock.method(internals, 'fetchStatusWithTimeout', () => response.promise)
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
  const manager = new CoreProcessManager({ channel: 'production' })
  const internals = manager as unknown as ManagerInternals
  const child = fakeChild()
  internals.child = child as unknown as ChildProcessWithoutNullStreams
  internals.runtimeReady = true
  internals.config = { ...internals.config, apiBaseUrl: 'http://127.0.0.1:8122', managed: true }
  t.mock.method(manager, 'initialize', async () => internals.config)
  const response = deferred<Response>()
  t.mock.method(globalThis, 'fetch', () => response.promise)
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

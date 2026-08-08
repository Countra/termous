import { expect, test, vi } from 'vitest'
import type { ForwardInstance } from '#entities/forward'
import type { AppData } from '../model/appData'
import { initialData } from '../model/appDataState'
import type { ForwardStartCompletionWaiter } from '../model/forwardRuntimeState'
import type { SetAppData } from '../model/runtimeTypes'
import { createForwardCommands } from './forwardCommands'

function forward(overrides: Partial<ForwardInstance> = {}): ForwardInstance {
  return {
    id: 'forward-1',
    name: 'Forward 1',
    mode: 'local',
    scope: 'background_once',
    status: 'running',
    phase: 'ready',
    progress: 100,
    host_id: 'host-1',
    bind_host: '127.0.0.1',
    bind_port: 8022,
    target_host: '127.0.0.1',
    target_port: 22,
    active_connections: 0,
    total_connections: 0,
    bytes_in: 0,
    bytes_out: 0,
    started_at: '2026-08-08T00:00:00Z',
    ...overrides,
  }
}

test('端口转发重启在停止成功但启动失败后先完成权威对账再抛出原错误', async () => {
  const currentForward = forward()
  const calls: string[] = []
  const startError = new Error('start failed')
  let data = { ...structuredClone(initialData), forwards: [currentForward] }
  const setData: SetAppData = (update) => {
    data = typeof update === 'function' ? update(data) : update
  }
  const commands = createForwardCommands({
    api: {
      getForward: vi.fn(),
      forwards: async () => {
        calls.push('reconcile')
        return []
      },
      startForward: async () => {
        calls.push('start')
        throw startError
      },
      stopForward: async () => {
        calls.push('stop')
      },
    },
    forwards: data.forwards,
    setData,
    setForwardErrorEvent: vi.fn(),
    forwardStartCompletionWaiters: new Map(),
    forwardEventRevisions: new Map(),
    forwardEventSnapshots: new Map(),
  })

  await expect(commands.restartForward(currentForward.id)).rejects.toBe(startError)
  expect(calls).toEqual(['stop', 'start', 'reconcile'])
  expect(data.forwards).toEqual([])
})

test('端口转发终态事件先释放启动 waiter 与其快照修订，再更新可见状态和错误事件', () => {
  const failedForward = forward({ status: 'failed', phase: 'failed', last_error: 'listen failed' })
  let data = { ...structuredClone(initialData), forwards: [forward()] }
  const setData: SetAppData = (update) => {
    data = typeof update === 'function' ? update(data) : update
  }
  const resolve = vi.fn()
  const cleanupTimer = window.setTimeout(() => undefined, 60_000)
  const waiters = new Map<string, ForwardStartCompletionWaiter>([
    [failedForward.id, { resolve, registeredAt: performance.now(), cleanupTimer }],
  ])
  const snapshots = new Map<string, ForwardInstance>()
  const revisions = new Map<string, number>([[failedForward.id, 3]])
  const setForwardErrorEvent = vi.fn()
  const commands = createForwardCommands({
    api: {
      getForward: vi.fn(),
      forwards: vi.fn(),
      startForward: vi.fn(),
      stopForward: vi.fn(),
    },
    forwards: data.forwards,
    setData,
    setForwardErrorEvent,
    forwardStartCompletionWaiters: waiters,
    forwardEventRevisions: revisions,
    forwardEventSnapshots: snapshots,
  })

  commands.updateForward({ type: 'error', forward: failedForward, message: 'listen failed' })

  expect(resolve).toHaveBeenCalledOnce()
  expect(resolve).toHaveBeenCalledWith(failedForward)
  expect(waiters.size).toBe(0)
  expect(snapshots.size).toBe(0)
  expect(revisions.size).toBe(0)
  expect(setForwardErrorEvent).toHaveBeenCalledWith({
    type: 'error',
    forward: failedForward,
    message: 'listen failed',
  })
  expect(data.forwards).toEqual([])
})

test('同一转发重复注册启动等待时释放旧 waiter 并只保留最新等待', async () => {
  vi.useFakeTimers()
  try {
    const startingForward = forward({ status: 'starting', phase: 'starting_listener', progress: 10 })
    let data: AppData = { ...structuredClone(initialData), forwards: [] }
    const setData: SetAppData = (update) => {
      data = typeof update === 'function' ? update(data) : update
    }
    const waiters = new Map<string, ForwardStartCompletionWaiter>()
    const commands = createForwardCommands({
      api: {
        getForward: vi.fn(async () => startingForward),
        forwards: vi.fn(async () => [startingForward]),
        startForward: vi.fn(async () => startingForward),
        stopForward: vi.fn(),
      },
      forwards: data.forwards,
      setData,
      setForwardErrorEvent: vi.fn(),
      forwardStartCompletionWaiters: waiters,
      forwardEventRevisions: new Map(),
      forwardEventSnapshots: new Map(),
    })

    await commands.startForward({
      name: 'Forward 1',
      mode: 'local',
      scope: 'background_once',
      host_id: 'host-1',
      bind_host: '127.0.0.1',
      bind_port: 8022,
      target_host: '127.0.0.1',
      target_port: 22,
    })
    const previousWaiter = waiters.get(startingForward.id)
    expect(previousWaiter).toBeDefined()
    const previousResolve = vi.fn(previousWaiter?.resolve)
    if (previousWaiter) {
      previousWaiter.resolve = previousResolve
    }

    await commands.startForward({
      name: 'Forward 1',
      mode: 'local',
      scope: 'background_once',
      host_id: 'host-1',
      bind_host: '127.0.0.1',
      bind_port: 8022,
      target_host: '127.0.0.1',
      target_port: 22,
    })

    expect(previousResolve).toHaveBeenCalledWith(null)
    expect(waiters.get(startingForward.id)).not.toBe(previousWaiter)
    commands.updateForward({ type: 'updated', forward: forward(), message: '' })
    expect(waiters.size).toBe(0)
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

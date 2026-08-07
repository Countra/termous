import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LinuxMonitorSnapshot,
  RemoteProcessListResult,
  RemoteProcessTerminateResult,
} from '#entities/observability'
import type {
  ObservabilityGateway,
  ObservabilitySessionContext,
} from './contracts'
import { useSessionMonitor } from './useSessionMonitor'
import {
  defaultProcessQuery,
  useSessionProcesses,
} from './useSessionProcesses'

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = 0
  closeCalls = 0
  sent: string[] = []

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  emit(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }))
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closeCalls += 1
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

const connectedSession = {
  id: 'session-a',
  kind: 'ssh',
  status: 'connected',
  started_at: '2026-01-01T00:00:00Z',
  pty_cols: 120,
  pty_rows: 32,
} as ObservabilitySessionContext

function monitorSample(index: number): LinuxMonitorSnapshot {
  return {
    status: 'ready',
    collected_at: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}Z`,
    interval_seconds: 5,
    cpu: {
      usage_percent: index,
      total_delta: index + 1,
      idle_delta: 1,
      cores: [{ name: 'cpu0', usage_percent: index }],
    },
    memory: {
      total_bytes: 1024,
      available_bytes: 512,
      used_bytes: 512,
      used_percent: 50,
      swap_total_bytes: 0,
      swap_used_bytes: 0,
    },
    networks: [],
    disk_io: { status: 'ready', devices: [] },
    disks: [],
  }
}

function processList(pid: number): RemoteProcessListResult {
  return {
    items: [{
      pid,
      ppid: 1,
      user: 'root',
      state: 'S',
      cpu_percent: 1,
      memory_percent: 1,
      rss_bytes: 1024,
      runtime_seconds: 10,
      name: `process-${pid}`,
      command_line: `process-${pid}`,
    }],
    ports: [],
    total: 1,
    filtered: 1,
    collected_at: `2026-01-01T00:00:${String(pid % 60).padStart(2, '0')}Z`,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('会话监控运行时合同', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('归一化可选集合，并仅在最新快照保留逐核心数据', () => {
    const api = {
      sessionMonitorUrl: (sessionId: string) => `ws://core.test/${sessionId}/monitor`,
    } as unknown as ObservabilityGateway
    const view = renderHook(({ enabled }) => useSessionMonitor({
      api,
      session: connectedSession,
      enabled,
      intervalSeconds: 5,
    }), { initialProps: { enabled: true } })
    const socket = FakeWebSocket.instances[0]

    act(() => {
      socket.open()
      const incomplete = monitorSample(0) as unknown as {
        cpu: { cores?: unknown }
        networks?: unknown
        disks?: unknown
        disk_io?: unknown
      }
      incomplete.cpu.cores = undefined
      incomplete.networks = undefined
      incomplete.disks = null
      incomplete.disk_io = undefined
      socket.emit({ type: 'sample', sample: incomplete })
    })

    expect(view.result.current.sample?.cpu.cores).toEqual([])
    expect(view.result.current.sample?.networks).toEqual([])
    expect(view.result.current.sample?.disks).toEqual([])
    expect(view.result.current.sample?.disk_io).toEqual({ status: 'unsupported', devices: [] })

    act(() => {
      for (let index = 1; index <= 121; index += 1) {
        socket.emit({ type: 'sample', sample: monitorSample(index) })
      }
    })

    expect(view.result.current.history).toHaveLength(120)
    expect(view.result.current.history[0].cpu.usage_percent).toBe(2)
    expect(view.result.current.history.every((sample) => sample.cpu.cores.length === 0)).toBe(true)
    expect(view.result.current.sample?.cpu.cores).toEqual([{ name: 'cpu0', usage_percent: 121 }])
  })

  it('禁用时关闭连接并保留快照，重连后恢复暂停状态', () => {
    const api = {
      sessionMonitorUrl: (sessionId: string) => `ws://core.test/${sessionId}/monitor`,
    } as unknown as ObservabilityGateway
    const view = renderHook(({ enabled }) => useSessionMonitor({
      api,
      session: connectedSession,
      enabled,
      intervalSeconds: 10,
    }), { initialProps: { enabled: true } })
    const firstSocket = FakeWebSocket.instances[0]

    act(() => {
      firstSocket.open()
      firstSocket.emit({ type: 'sample', sample: monitorSample(3) })
      view.result.current.pause()
    })
    expect(firstSocket.sent.map((message) => JSON.parse(message))).toEqual([
      { type: 'configure', interval_seconds: 10 },
      { type: 'pause' },
    ])

    view.rerender({ enabled: false })
    expect(firstSocket.closeCalls).toBe(1)
    expect(view.result.current.sample?.cpu.usage_percent).toBe(3)

    view.rerender({ enabled: true })
    const secondSocket = FakeWebSocket.instances[1]
    act(() => secondSocket.open())

    expect(secondSocket.sent.map((message) => JSON.parse(message))).toEqual([
      { type: 'configure', interval_seconds: 10 },
      { type: 'pause' },
    ])
  })
})

describe('远端进程运行时合同', () => {
  it('禁用时不请求，并将合法 PID、端口和排序转换为 API 查询', async () => {
    const sessionProcesses = vi.fn(async () => processList(42))
    const api = { sessionProcesses } as unknown as ObservabilityGateway
    const view = renderHook(({ enabled }) => useSessionProcesses({
      api,
      session: connectedSession,
      enabled,
    }), { initialProps: { enabled: false } })

    expect(sessionProcesses).not.toHaveBeenCalled()

    view.rerender({ enabled: true })
    await waitFor(() => expect(sessionProcesses).toHaveBeenCalledTimes(1))
    await act(async () => {
      await view.result.current.refresh({
        ...defaultProcessQuery,
        text: ' nginx ',
        pid: '0042',
        port: '0',
        sort: 'runtime',
        limit: 50,
      })
    })

    expect(sessionProcesses).toHaveBeenLastCalledWith(
      'session-a',
      { query: ' nginx ', pid: 42, port: undefined, sort: 'runtime', limit: 50 },
      { signal: expect.any(AbortSignal) },
    )
  })

  it('取消旧请求，并阻止迟到结果覆盖最新列表', async () => {
    const first = deferred<RemoteProcessListResult>()
    const second = deferred<RemoteProcessListResult>()
    const sessionProcesses = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const api = { sessionProcesses } as unknown as ObservabilityGateway
    const view = renderHook(() => useSessionProcesses({
      api,
      session: connectedSession,
      enabled: true,
    }))

    await waitFor(() => expect(sessionProcesses).toHaveBeenCalledTimes(1))
    const firstSignal = sessionProcesses.mock.calls[0][2].signal as AbortSignal
    act(() => {
      void view.result.current.refresh()
    })
    await waitFor(() => expect(sessionProcesses).toHaveBeenCalledTimes(2))
    expect(firstSignal.aborted).toBe(true)

    await act(async () => {
      second.resolve(processList(2))
      await second.promise
    })
    expect(view.result.current.list?.items[0].pid).toBe(2)

    await act(async () => {
      first.resolve(processList(1))
      await first.promise
    })
    expect(view.result.current.list?.items[0].pid).toBe(2)
  })

  it('禁用时取消进行中的请求，并阻止忽略取消的迟到结果回写', async () => {
    const pending = deferred<RemoteProcessListResult>()
    const sessionProcesses = vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(processList(2))
    const api = { sessionProcesses } as unknown as ObservabilityGateway
    const view = renderHook(({ enabled }) => useSessionProcesses({
      api,
      session: connectedSession,
      enabled,
    }), { initialProps: { enabled: true } })

    await waitFor(() => expect(sessionProcesses).toHaveBeenCalledTimes(1))
    const signal = sessionProcesses.mock.calls[0][2].signal as AbortSignal
    expect(view.result.current.loading).toBe(true)

    view.rerender({ enabled: false })
    expect(signal.aborted).toBe(true)
    expect(view.result.current.loading).toBe(false)

    await act(async () => {
      pending.resolve(processList(1))
      await pending.promise
    })
    expect(view.result.current.list).toBeNull()

    view.rerender({ enabled: true })
    await waitFor(() => expect(sessionProcesses).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.result.current.list?.items[0].pid).toBe(2))
  })

  it('终止请求跨越页面失活后不刷新隐藏会话，重新启用时再加载', async () => {
    const terminate = deferred<RemoteProcessTerminateResult>()
    const sessionProcesses = vi.fn()
      .mockResolvedValueOnce(processList(1))
      .mockResolvedValueOnce(processList(2))
    const terminateSessionProcess = vi.fn(() => terminate.promise)
    const api = { sessionProcesses, terminateSessionProcess } as unknown as ObservabilityGateway
    const view = renderHook(({ enabled }) => useSessionProcesses({
      api,
      session: connectedSession,
      enabled,
    }), { initialProps: { enabled: true } })

    await waitFor(() => expect(sessionProcesses).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(view.result.current.list?.items[0].pid).toBe(1))

    let terminatePromise!: Promise<RemoteProcessTerminateResult | null>
    act(() => {
      terminatePromise = view.result.current.terminateProcess(42)
    })
    expect(view.result.current.terminatingPid).toBe(42)

    view.rerender({ enabled: false })
    terminate.resolve({ pid: 42, signal: 'term', attempted: true, message: '' })
    await act(async () => {
      await terminatePromise
    })

    expect(sessionProcesses).toHaveBeenCalledTimes(1)
    expect(view.result.current.list).toBeNull()

    view.rerender({ enabled: true })
    await waitFor(() => expect(sessionProcesses).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.result.current.list?.items[0].pid).toBe(2))
  })
})

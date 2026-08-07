import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  SystemServiceCapability,
  SystemServiceDetail,
  SystemServiceListResult,
  SystemServiceOperation,
} from '#entities/service'
import type { ServiceGateway, ServiceSessionContext } from './contracts'
import { defaultServiceQuery, useSessionServices } from './useSessionServices'

const connectedSession = {
  id: 'session-a',
  kind: 'ssh',
  status: 'connected',
} as ServiceSessionContext

const serviceCapability: SystemServiceCapability = {
  provider: 'systemd',
  available: true,
  manageable: true,
  status: 'ready',
  manage_mode: 'direct',
  journal_readable: true,
  warnings: [],
  collected_at: '2026-01-01T00:00:00Z',
}

const serviceList: SystemServiceListResult = {
  items: [],
  total: 0,
  filtered: 0,
  running: 0,
  failed: 0,
  collected_at: '2026-01-01T00:00:01Z',
  warnings: [],
}

const serviceDetail: SystemServiceDetail = {
  summary: {
    id: 'example.service',
    names: ['example.service'],
    load_state: 'loaded',
    active_state: 'active',
    sub_state: 'running',
    unit_file_state: 'enabled',
    template: false,
  },
  main_pid: 1,
  control_pid: 0,
  exec_main_status: 0,
  restart_count: 0,
  can_start: true,
  can_stop: true,
  can_reload: true,
  refuse_manual_start: false,
  refuse_manual_stop: false,
  drop_in_paths: [],
  active_duration_seconds: 1,
  warnings: [],
  collected_at: '2026-01-01T00:00:01Z',
}

const queuedServiceOperation: SystemServiceOperation = {
  id: 'operation-a',
  revision: 1,
  session_id: 'session-a',
  unit_id: 'example.service',
  action: 'restart',
  phase: 'queued',
  message: '',
  started_at: '2026-01-01T00:00:02Z',
  updated_at: '2026-01-01T00:00:02Z',
}

const completedServiceOperation: SystemServiceOperation = {
  ...queuedServiceOperation,
  revision: 2,
  phase: 'succeeded',
  updated_at: '2026-01-01T00:00:03Z',
  completed_at: '2026-01-01T00:00:03Z',
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

describe('系统服务运行时合同', () => {
  it('启用后加载能力与列表，并保持查询转换语义', async () => {
    const sessionServiceCapability = vi.fn(async () => serviceCapability)
    const sessionServices = vi.fn(async () => serviceList)
    const api = { sessionServiceCapability, sessionServices } as unknown as ServiceGateway
    const view = renderHook(({ enabled }) => useSessionServices({
      api,
      session: connectedSession,
      enabled,
    }), { initialProps: { enabled: false } })

    expect(sessionServiceCapability).not.toHaveBeenCalled()
    view.rerender({ enabled: true })
    await waitFor(() => expect(sessionServices).toHaveBeenCalledTimes(1))

    await act(async () => {
      await view.result.current.refreshList({
        ...defaultServiceQuery,
        text: ' ssh ',
        runtimeState: 'running',
        unitFileState: 'enabled',
        sort: 'runtime',
        order: 'desc',
        limit: 50,
      })
    })

    expect(sessionServices).toHaveBeenLastCalledWith(
      'session-a',
      {
        query: ' ssh ',
        runtime_state: 'running',
        unit_file_state: 'enabled',
        sort: 'runtime',
        order: 'desc',
        limit: 50,
      },
      { signal: expect.any(AbortSignal) },
    )
  })

  it('页面失活时取消能力探测请求', async () => {
    const pending = deferred<typeof serviceCapability>()
    const sessionServiceCapability = vi.fn<ServiceGateway['sessionServiceCapability']>(() => pending.promise)
    const api = { sessionServiceCapability } as unknown as ServiceGateway
    const view = renderHook(({ enabled }) => useSessionServices({
      api,
      session: connectedSession,
      enabled,
    }), { initialProps: { enabled: true } })

    await waitFor(() => expect(sessionServiceCapability).toHaveBeenCalledTimes(1))
    const signal = sessionServiceCapability.mock.calls[0][1]?.signal as AbortSignal
    view.rerender({ enabled: false })
    expect(signal.aborted).toBe(true)

    await act(async () => {
      pending.reject({ code: 'REQUEST_ABORTED' })
      await Promise.resolve()
    })
    expect(view.result.current.loadingCapability).toBe(false)
  })

  it('列表读取被失活取消后在重新启用时恢复', async () => {
    const pending = deferred<SystemServiceListResult>()
    const sessionServiceCapability = vi.fn<ServiceGateway['sessionServiceCapability']>().mockResolvedValue(serviceCapability)
    const sessionServices = vi.fn<ServiceGateway['sessionServices']>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(serviceList)
    const api = { sessionServiceCapability, sessionServices } as unknown as ServiceGateway
    const view = renderHook(({ enabled }) => useSessionServices({
      api,
      session: connectedSession,
      enabled,
    }), { initialProps: { enabled: true } })

    await waitFor(() => expect(sessionServices).toHaveBeenCalledTimes(1))
    const signal = sessionServices.mock.calls[0][2]?.signal as AbortSignal
    view.rerender({ enabled: false })
    expect(signal.aborted).toBe(true)
    await act(async () => {
      pending.reject({ code: 'REQUEST_ABORTED' })
      await Promise.resolve()
    })

    view.rerender({ enabled: true })
    await waitFor(() => expect(sessionServices).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.result.current.list).toEqual(serviceList))
  })

  it('详情读取被断连取消后在重连时恢复', async () => {
    const pending = deferred<SystemServiceDetail>()
    const sessionServiceCapability = vi.fn<ServiceGateway['sessionServiceCapability']>().mockResolvedValue(serviceCapability)
    const sessionServices = vi.fn<ServiceGateway['sessionServices']>().mockResolvedValue(serviceList)
    const sessionServiceDetail = vi.fn<ServiceGateway['sessionServiceDetail']>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(serviceDetail)
    const api = { sessionServiceCapability, sessionServices, sessionServiceDetail } as unknown as ServiceGateway
    const view = renderHook(({ status }) => useSessionServices({
      api,
      session: { ...connectedSession, status },
      enabled: true,
    }), { initialProps: { status: 'connected' } })

    await waitFor(() => expect(sessionServices).toHaveBeenCalledTimes(1))
    act(() => {
      void view.result.current.selectService('example.service')
    })
    await waitFor(() => expect(sessionServiceDetail).toHaveBeenCalledTimes(1))
    const signal = sessionServiceDetail.mock.calls[0][2]?.signal as AbortSignal
    view.rerender({ status: 'disconnected' })
    expect(signal.aborted).toBe(true)
    await act(async () => {
      pending.reject({ code: 'REQUEST_ABORTED' })
      await Promise.resolve()
    })

    view.rerender({ status: 'connected' })
    await waitFor(() => expect(sessionServiceDetail).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.result.current.detail).toEqual(serviceDetail))
  })

  it('终态刷新期间失活后不继续读取详情', async () => {
    const pendingList = deferred<SystemServiceListResult>()
    const sessionServiceCapability = vi.fn<ServiceGateway['sessionServiceCapability']>().mockResolvedValue(serviceCapability)
    const sessionServices = vi.fn<ServiceGateway['sessionServices']>()
      .mockResolvedValueOnce(serviceList)
      .mockImplementationOnce(() => pendingList.promise)
    const sessionServiceDetail = vi.fn<ServiceGateway['sessionServiceDetail']>().mockResolvedValue(serviceDetail)
    const runSessionServiceAction = vi.fn<ServiceGateway['runSessionServiceAction']>().mockResolvedValue(queuedServiceOperation)
    const sessionServiceOperation = vi.fn<ServiceGateway['sessionServiceOperation']>().mockResolvedValue(completedServiceOperation)
    const api = {
      sessionServiceCapability,
      sessionServices,
      sessionServiceDetail,
      runSessionServiceAction,
      sessionServiceOperation,
    } as unknown as ServiceGateway
    const view = renderHook(({ enabled }) => useSessionServices({
      api,
      session: connectedSession,
      enabled,
    }), { initialProps: { enabled: true } })

    await waitFor(() => expect(sessionServices).toHaveBeenCalledTimes(1))
    await act(async () => {
      await view.result.current.selectService('example.service')
      await view.result.current.runAction('example.service', 'restart')
    })
    expect(sessionServiceDetail).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(sessionServiceOperation).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(sessionServices).toHaveBeenCalledTimes(2))

    const signal = sessionServices.mock.calls[1][2]?.signal as AbortSignal
    view.rerender({ enabled: false })
    expect(signal.aborted).toBe(true)
    await act(async () => {
      pendingList.reject({ code: 'REQUEST_ABORTED' })
      await Promise.resolve()
    })

    expect(sessionServiceDetail).toHaveBeenCalledTimes(1)
  })
})

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DockerActionResult, DockerCapability, DockerContainerDetail, DockerListResult } from '#entities/docker'
import type { DockerGateway, DockerSessionContext } from './contracts'
import { defaultDockerQuery, useSessionDocker } from './useSessionDocker'

const connectedSession = {
  id: 'session-a',
  kind: 'ssh',
  status: 'connected',
} as DockerSessionContext

const dockerCapability: DockerCapability = {
  available: true,
  status: 'available',
  collected_at: '2026-01-01T00:00:00Z',
}

const dockerList: DockerListResult = {
  items: [],
  total: 0,
  filtered: 0,
  collected_at: '2026-01-01T00:00:01Z',
}

const dockerDetail: DockerContainerDetail = {
  summary: {
    id: 'container-a',
    short_id: 'container-a',
    name: 'container-a',
    image: 'example:latest',
    state: 'running',
  },
  collected_at: '2026-01-01T00:00:01Z',
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

describe('远端管理运行时合同', () => {
  it('Docker 启用后加载能力与列表，并保持查询转换语义', async () => {
    const sessionDockerCapability = vi.fn(async () => dockerCapability)
    const sessionDockerContainers = vi.fn(async () => dockerList)
    const api = { sessionDockerCapability, sessionDockerContainers } as unknown as DockerGateway
    const view = renderHook(({ enabled }) => useSessionDocker({
      api,
      session: connectedSession,
      enabled,
    }), { initialProps: { enabled: false } })

    expect(sessionDockerCapability).not.toHaveBeenCalled()
    view.rerender({ enabled: true })
    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(1))

    await act(async () => {
      await view.result.current.refreshList({
        ...defaultDockerQuery,
        text: ' nginx ',
        state: 'running',
        health: 'healthy',
        port: '00443',
        limit: 50,
      })
    })

    expect(sessionDockerContainers).toHaveBeenLastCalledWith(
      'session-a',
      { query: ' nginx ', state: 'running', health: 'healthy', port: 443, limit: 50 },
      { signal: expect.any(AbortSignal) },
    )
  })

  it('Docker 页面失活时取消能力探测请求', async () => {
    const pending = deferred<DockerCapability>()
    const sessionDockerCapability = vi.fn<DockerGateway['sessionDockerCapability']>(() => pending.promise)
    const api = { sessionDockerCapability } as unknown as DockerGateway
    const view = renderHook(({ enabled }) => useSessionDocker({
      api,
      session: connectedSession,
      enabled,
    }), { initialProps: { enabled: true } })

    await waitFor(() => expect(sessionDockerCapability).toHaveBeenCalledTimes(1))
    const signal = sessionDockerCapability.mock.calls[0][1]?.signal as AbortSignal
    view.rerender({ enabled: false })
    expect(signal.aborted).toBe(true)

    await act(async () => {
      pending.reject({ code: 'REQUEST_ABORTED' })
      await Promise.resolve()
    })
    expect(view.result.current.loadingCapability).toBe(false)
  })

  it('Docker 列表读取被失活取消后在重新启用时恢复', async () => {
    const pending = deferred<DockerListResult>()
    const sessionDockerCapability = vi.fn<DockerGateway['sessionDockerCapability']>().mockResolvedValue(dockerCapability)
    const sessionDockerContainers = vi.fn<DockerGateway['sessionDockerContainers']>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(dockerList)
    const api = { sessionDockerCapability, sessionDockerContainers } as unknown as DockerGateway
    const view = renderHook(({ enabled }) => useSessionDocker({
      api,
      session: connectedSession,
      enabled,
    }), { initialProps: { enabled: true } })

    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(1))
    const signal = sessionDockerContainers.mock.calls[0][2]?.signal as AbortSignal
    view.rerender({ enabled: false })
    expect(signal.aborted).toBe(true)
    await act(async () => {
      pending.reject({ code: 'REQUEST_ABORTED' })
      await Promise.resolve()
    })

    view.rerender({ enabled: true })
    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(2))
    expect(view.result.current.list).toEqual(dockerList)
  })

  it('Docker 详情读取被断连取消后在重连时恢复', async () => {
    const pending = deferred<DockerContainerDetail>()
    const sessionDockerCapability = vi.fn<DockerGateway['sessionDockerCapability']>().mockResolvedValue(dockerCapability)
    const sessionDockerContainers = vi.fn<DockerGateway['sessionDockerContainers']>().mockResolvedValue(dockerList)
    const sessionDockerContainerDetail = vi.fn<DockerGateway['sessionDockerContainerDetail']>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(dockerDetail)
    const api = {
      sessionDockerCapability,
      sessionDockerContainers,
      sessionDockerContainerDetail,
    } as unknown as DockerGateway
    const view = renderHook(({ status }) => useSessionDocker({
      api,
      session: { ...connectedSession, status },
      enabled: true,
    }), { initialProps: { status: 'connected' } })

    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(1))
    act(() => {
      void view.result.current.selectContainer('container-a')
    })
    await waitFor(() => expect(sessionDockerContainerDetail).toHaveBeenCalledTimes(1))
    const signal = sessionDockerContainerDetail.mock.calls[0][2]?.signal as AbortSignal
    view.rerender({ status: 'disconnected' })
    expect(signal.aborted).toBe(true)
    await act(async () => {
      pending.reject({ code: 'REQUEST_ABORTED' })
      await Promise.resolve()
    })

    view.rerender({ status: 'connected' })
    await waitFor(() => expect(sessionDockerContainerDetail).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.result.current.detail).toEqual(dockerDetail))
  })

  it('Docker 动作完成时页面已失活，重新启用后刷新列表与当前详情', async () => {
    const pending = deferred<DockerActionResult>()
    const sessionDockerCapability = vi.fn<DockerGateway['sessionDockerCapability']>().mockResolvedValue(dockerCapability)
    const sessionDockerContainers = vi.fn<DockerGateway['sessionDockerContainers']>().mockResolvedValue(dockerList)
    const sessionDockerContainerDetail = vi.fn<DockerGateway['sessionDockerContainerDetail']>().mockResolvedValue(dockerDetail)
    const sessionDockerContainerAction = vi.fn<DockerGateway['sessionDockerContainerAction']>(() => pending.promise)
    const api = {
      sessionDockerCapability,
      sessionDockerContainers,
      sessionDockerContainerDetail,
      sessionDockerContainerAction,
    } as unknown as DockerGateway
    const view = renderHook(({ enabled }) => useSessionDocker({
      api,
      session: connectedSession,
      enabled,
    }), { initialProps: { enabled: true } })

    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(1))
    await act(async () => {
      await view.result.current.selectContainer('container-a')
    })
    expect(sessionDockerContainerDetail).toHaveBeenCalledTimes(1)
    let actionPromise: Promise<DockerActionResult | null> | undefined
    act(() => {
      actionPromise = view.result.current.runAction('container-a', 'restart')
    })
    await waitFor(() => expect(sessionDockerContainerAction).toHaveBeenCalledTimes(1))
    view.rerender({ enabled: false })
    await act(async () => {
      pending.resolve({
        id: 'container-a',
        action: 'restart',
        attempted: true,
        message: 'ok',
        completed_at: '2026-01-01T00:00:02Z',
      })
      await actionPromise
    })

    expect(sessionDockerContainers).toHaveBeenCalledTimes(1)
    expect(sessionDockerContainerDetail).toHaveBeenCalledTimes(1)

    view.rerender({ enabled: true })
    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(sessionDockerContainerDetail).toHaveBeenCalledTimes(2))
    expect(view.result.current.refreshRequired).toBe(false)
  })

  it('并发 Docker 动作完成时不会丢失较新的刷新代际', async () => {
    const firstAction = deferred<DockerActionResult>()
    const secondAction = deferred<DockerActionResult>()
    const firstRefresh = deferred<DockerListResult>()
    const sessionDockerCapability = vi.fn<DockerGateway['sessionDockerCapability']>().mockResolvedValue(dockerCapability)
    const sessionDockerContainers = vi.fn<DockerGateway['sessionDockerContainers']>()
      .mockResolvedValueOnce(dockerList)
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockResolvedValueOnce(dockerList)
    const sessionDockerContainerAction = vi.fn<DockerGateway['sessionDockerContainerAction']>()
      .mockImplementationOnce(() => firstAction.promise)
      .mockImplementationOnce(() => secondAction.promise)
    const api = {
      sessionDockerCapability,
      sessionDockerContainers,
      sessionDockerContainerAction,
    } as unknown as DockerGateway
    const view = renderHook(() => useSessionDocker({ api, session: connectedSession, enabled: true }))

    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(1))
    let firstPromise: Promise<DockerActionResult | null> | undefined
    let secondPromise: Promise<DockerActionResult | null> | undefined
    act(() => {
      firstPromise = view.result.current.runAction('container-a', 'restart')
      secondPromise = view.result.current.runAction('container-b', 'restart')
    })
    await waitFor(() => expect(sessionDockerContainerAction).toHaveBeenCalledTimes(2))

    await act(async () => {
      firstAction.resolve({ action: 'restart', attempted: true, message: 'a', completed_at: '2026-01-01T00:00:02Z' })
      await Promise.resolve()
    })
    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(2))
    await act(async () => {
      secondAction.resolve({ action: 'restart', attempted: true, message: 'b', completed_at: '2026-01-01T00:00:03Z' })
      await secondPromise
      firstRefresh.resolve(dockerList)
      await firstPromise
    })

    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(view.result.current.refreshRequired).toBe(false))
  })

  it('手动列表刷新抢占动作补刷后仍会覆盖最新动作代际', async () => {
    const firstAction = deferred<DockerActionResult>()
    const secondAction = deferred<DockerActionResult>()
    const firstActionRefresh = deferred<DockerListResult>()
    const manualRefresh = deferred<DockerListResult>()
    const sessionDockerCapability = vi.fn<DockerGateway['sessionDockerCapability']>().mockResolvedValue(dockerCapability)
    const sessionDockerContainers = vi.fn<DockerGateway['sessionDockerContainers']>()
      .mockResolvedValueOnce(dockerList)
      .mockImplementationOnce(() => firstActionRefresh.promise)
      .mockImplementationOnce(() => manualRefresh.promise)
      .mockResolvedValueOnce(dockerList)
    const sessionDockerContainerAction = vi.fn<DockerGateway['sessionDockerContainerAction']>()
      .mockImplementationOnce(() => firstAction.promise)
      .mockImplementationOnce(() => secondAction.promise)
    const api = {
      sessionDockerCapability,
      sessionDockerContainers,
      sessionDockerContainerAction,
    } as unknown as DockerGateway
    const view = renderHook(() => useSessionDocker({ api, session: connectedSession, enabled: true }))

    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(1))
    let firstPromise: Promise<DockerActionResult | null> | undefined
    let secondPromise: Promise<DockerActionResult | null> | undefined
    act(() => {
      firstPromise = view.result.current.runAction('container-a', 'restart')
      secondPromise = view.result.current.runAction('container-b', 'restart')
    })
    await waitFor(() => expect(sessionDockerContainerAction).toHaveBeenCalledTimes(2))

    await act(async () => {
      firstAction.resolve({ action: 'restart', attempted: true, message: 'a', completed_at: '2026-01-01T00:00:02Z' })
      await Promise.resolve()
    })
    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(2))

    let manualRefreshPromise: Promise<void> | undefined
    act(() => {
      manualRefreshPromise = view.result.current.refreshList()
    })
    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(3))
    await act(async () => {
      manualRefresh.resolve(dockerList)
      await manualRefreshPromise
    })

    await act(async () => {
      secondAction.resolve({ action: 'restart', attempted: true, message: 'b', completed_at: '2026-01-01T00:00:03Z' })
      await secondPromise
    })
    await act(async () => {
      firstActionRefresh.resolve(dockerList)
      await firstPromise
    })

    await waitFor(() => expect(sessionDockerContainers).toHaveBeenCalledTimes(4))
    await waitFor(() => expect(view.result.current.refreshRequired).toBe(false))
  })

})

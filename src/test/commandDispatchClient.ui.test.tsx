import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'

describe('CommandDispatchClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('将空最新任务作为正常结果并合并并发恢复请求', async () => {
    let releaseResponse: (() => void) | undefined
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      releaseResponse = () => resolve(new Response(null, { status: 204 }))
    }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createRuntimeGatewaysFromConfig({
      apiBaseUrl: 'http://127.0.0.1:18131',
      apiToken: 'test-token',
    }).commandDispatch
    const firstController = new AbortController()
    const first = client.latestTask({ signal: firstController.signal })
    const second = client.latestTask()
    firstController.abort()
    releaseResponse?.()

    await expect(first).rejects.toMatchObject({ code: 'REQUEST_ABORTED' })
    await expect(second).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('权威确认可以绕过仍在途的启动恢复请求', async () => {
    let releaseInitial: (() => void) | undefined
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        releaseInitial = () => resolve(new Response(null, { status: 204 }))
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createRuntimeGatewaysFromConfig({
      apiBaseUrl: 'http://127.0.0.1:18131',
      apiToken: 'test-token',
    }).commandDispatch

    const initial = client.latestTask()
    await expect(client.latestTask({ fresh: true })).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    releaseInitial?.()
    await expect(initial).resolves.toBeNull()
  })

  it('全局任务流复用动态 Core 地址并跨任务保持连接', () => {
    const client = createRuntimeGatewaysFromConfig({
      apiBaseUrl: 'http://127.0.0.1:49217',
      apiToken: 'renderer-token',
    }).commandDispatch

    expect(client.latestTasksEventsUrl()).toBe(
      'ws://127.0.0.1:49217/api/v1/command-dispatch-tasks/events?token=renderer-token',
    )
  })
})

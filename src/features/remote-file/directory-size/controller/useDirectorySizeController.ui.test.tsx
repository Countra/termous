import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RemoteDirectorySize } from '#entities/file'
import { DirectorySizeResultCache } from '../model/DirectorySizeResultCache.ts'
import type { DirectorySizeSource } from '../model/types.ts'
import {
  useDirectorySizeController,
  type DirectorySizeGateway,
} from './useDirectorySizeController.ts'

function result(patch: Partial<RemoteDirectorySize> = {}): RemoteDirectorySize {
  return {
    file_session_id: 'file-session-1',
    path: '/srv/data',
    total_bytes: 1024,
    estimated: true,
    connection_generation: 3,
    calculated_at: '2026-09-14T10:00:00Z',
    duration_ms: 12,
    ...patch,
  }
}

function source(patch: Partial<DirectorySizeSource> = {}): DirectorySizeSource {
  return {
    fileSessionId: 'file-session-1',
    connectionGeneration: 3,
    path: '/srv/data',
    listingReadAt: '2026-09-14T09:59:00Z',
    ...patch,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('目录总大小控制器', () => {
  it('提交精确连接代次并保存有效结果', async () => {
    const cache = new DirectorySizeResultCache()
    const api: DirectorySizeGateway = {
      calculateFileSessionDirectorySize: vi.fn(async () => result()),
    }
    const view = renderHook(() => useDirectorySizeController({
      api,
      cache,
      source: source(),
      enabled: true,
    }))

    await act(async () => {
      await view.result.current.calculate()
    })

    expect(api.calculateFileSessionDirectorySize).toHaveBeenCalledWith(
      'file-session-1',
      {
        path: '/srv/data',
        expected_connection_generation: 3,
      },
      expect.any(AbortSignal),
    )
    expect(view.result.current.state).toMatchObject({
      status: 'success',
      result: { total_bytes: 1024, estimated: true },
    })
    expect(cache.get(source())?.total_bytes).toBe(1024)
  })

  it('目录刷新后取消旧请求并忽略迟到结果', async () => {
    const cache = new DirectorySizeResultCache()
    const pending = deferred<RemoteDirectorySize>()
    const api: DirectorySizeGateway = {
      calculateFileSessionDirectorySize: vi.fn(() => pending.promise),
    }
    const initialSource = source()
    const view = renderHook(
      ({ currentSource }) => useDirectorySizeController({
        api,
        cache,
        source: currentSource,
        enabled: true,
      }),
      { initialProps: { currentSource: initialSource } },
    )

    let calculation!: Promise<void>
    act(() => {
      calculation = view.result.current.calculate()
    })
    const signal = vi.mocked(api.calculateFileSessionDirectorySize).mock.calls[0][2]
    expect(signal?.aborted).toBe(false)

    view.rerender({
      currentSource: source({ listingReadAt: '2026-09-14T10:01:00Z' }),
    })
    expect(signal?.aborted).toBe(true)
    pending.resolve(result())
    await act(async () => {
      await calculation
    })
    expect(view.result.current.state.status).toBe('idle')
    expect(cache.get(initialSource)).toBeUndefined()
  })

  it('目录请求开始时立即取消当前计算', async () => {
    const cache = new DirectorySizeResultCache()
    const pending = deferred<RemoteDirectorySize>()
    const api: DirectorySizeGateway = {
      calculateFileSessionDirectorySize: vi.fn(() => pending.promise),
    }
    const view = renderHook(
      ({ enabled }) => useDirectorySizeController({
        api,
        cache,
        source: source(),
        enabled,
      }),
      { initialProps: { enabled: true } },
    )

    let calculation!: Promise<void>
    act(() => {
      calculation = view.result.current.calculate()
    })
    const signal = vi.mocked(api.calculateFileSessionDirectorySize).mock.calls[0][2]
    expect(signal?.aborted).toBe(false)

    view.rerender({ enabled: false })
    expect(signal?.aborted).toBe(true)
    pending.resolve(result())
    await act(async () => {
      await calculation
    })
    expect(view.result.current.state.status).toBe('idle')
  })

  it('主动取消不报告错误并回到初始状态', async () => {
    const cache = new DirectorySizeResultCache()
    const onError = vi.fn()
    const api: DirectorySizeGateway = {
      calculateFileSessionDirectorySize: vi.fn((_id, _input, signal) => (
        new Promise<RemoteDirectorySize>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('cancelled'), { code: 'REQUEST_ABORTED' }))
          }, { once: true })
        })
      )),
    }
    const view = renderHook(() => useDirectorySizeController({
      api,
      cache,
      source: source(),
      enabled: true,
      onError,
    }))

    let calculation!: Promise<void>
    act(() => {
      calculation = view.result.current.calculate()
    })
    act(() => view.result.current.cancel())
    await act(async () => {
      await calculation
    })
    await waitFor(() => expect(view.result.current.state.status).toBe('idle'))
    expect(onError).not.toHaveBeenCalled()
  })

  it('拒绝身份不一致的响应并通知真实失败', async () => {
    const cache = new DirectorySizeResultCache()
    const onError = vi.fn()
    const api: DirectorySizeGateway = {
      calculateFileSessionDirectorySize: vi.fn(async () => result({
        connection_generation: 4,
      })),
    }
    const view = renderHook(() => useDirectorySizeController({
      api,
      cache,
      source: source(),
      enabled: true,
      onError,
    }))

    await act(async () => {
      await view.result.current.calculate()
    })
    expect(view.result.current.state.status).toBe('error')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(cache.get(source())).toBeUndefined()
  })

  it('切换目录和刷新列表后恢复当前会话的缓存结果', async () => {
    const cache = new DirectorySizeResultCache()
    const api: DirectorySizeGateway = {
      calculateFileSessionDirectorySize: vi.fn(async (_id, input) => result({
        path: input.path,
      })),
    }
    const initialSource = source()
    const view = renderHook(
      ({ currentSource }) => useDirectorySizeController({
        api,
        cache,
        source: currentSource,
        enabled: true,
      }),
      { initialProps: { currentSource: initialSource } },
    )

    await act(async () => {
      await view.result.current.calculate()
    })
    view.rerender({ currentSource: source({ path: '/srv/other' }) })
    await waitFor(() => expect(view.result.current.state.status).toBe('idle'))

    view.rerender({
      currentSource: source({ listingReadAt: '2026-09-14T10:02:00Z' }),
    })
    expect(view.result.current.state).toMatchObject({
      status: 'success',
      result: { total_bytes: 1024 },
    })
    expect(api.calculateFileSessionDirectorySize).toHaveBeenCalledTimes(1)
  })

  it('取消重新计算后恢复上一次成功结果', async () => {
    const cache = new DirectorySizeResultCache()
    const currentSource = source()
    cache.set(currentSource, result({ total_bytes: 1024 }))
    const api: DirectorySizeGateway = {
      calculateFileSessionDirectorySize: vi.fn((_id, _input, signal) => (
        new Promise<RemoteDirectorySize>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('cancelled'), { code: 'REQUEST_ABORTED' }))
          }, { once: true })
        })
      )),
    }
    const view = renderHook(() => useDirectorySizeController({
      api,
      cache,
      source: currentSource,
      enabled: true,
    }))

    let calculation!: Promise<void>
    act(() => {
      calculation = view.result.current.calculate()
    })
    expect(view.result.current.state.status).toBe('running')
    act(() => view.result.current.cancel())
    await act(async () => {
      await calculation
    })

    expect(view.result.current.state).toMatchObject({
      status: 'success',
      result: { total_bytes: 1024 },
    })
  })
})

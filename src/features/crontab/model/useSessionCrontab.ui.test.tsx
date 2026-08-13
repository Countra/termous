import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CrontabCapability, CrontabSnapshot } from '#entities/crontab'
import type { CrontabGateway, CrontabSessionContext } from './contracts'
import { useSessionCrontab } from './useSessionCrontab'

const session = {
  id: 'session-a',
  kind: 'ssh',
  status: 'connected',
} as CrontabSessionContext

const capability: CrontabCapability = {
  status: 'ready',
  available: true,
  readable: true,
  writable: true,
  username: 'deploy',
  warnings: [],
  checked_at: '2026-01-01T00:00:00Z',
}

const snapshot: CrontabSnapshot = {
  session_id: 'session-a',
  username: 'deploy',
  exists: true,
  revision: 'revision-a',
  jobs: [],
  unmanaged_line_count: 0,
  warnings: [],
  collected_at: '2026-01-01T00:00:00Z',
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

describe('Crontab 会话运行时合同', () => {
  it('仅在面板启用时按能力和快照顺序加载', async () => {
    const sessionCrontabCapability = vi.fn<CrontabGateway['sessionCrontabCapability']>().mockResolvedValue(capability)
    const sessionCrontab = vi.fn<CrontabGateway['sessionCrontab']>().mockResolvedValue(snapshot)
    const api = { sessionCrontabCapability, sessionCrontab } as unknown as CrontabGateway
    const view = renderHook(({ enabled }) => useSessionCrontab({ api, session, enabled }), {
      initialProps: { enabled: false },
    })

    expect(sessionCrontabCapability).not.toHaveBeenCalled()
    view.rerender({ enabled: true })
    await waitFor(() => expect(view.result.current.snapshot).toEqual(snapshot))
    expect(sessionCrontabCapability).toHaveBeenCalledWith('session-a', { signal: expect.any(AbortSignal) })
    expect(sessionCrontab).toHaveBeenCalledWith('session-a', { signal: expect.any(AbortSignal) })
  })

  it('原文只在显式请求时读取且不会保留在 Hook 快照中', async () => {
    const sourceSnapshot = { ...snapshot, content: '0 2 * * * /usr/bin/true\n' }
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>().mockResolvedValue(capability),
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>().mockResolvedValue(snapshot),
      sessionCrontabSource: vi.fn<CrontabGateway['sessionCrontabSource']>().mockResolvedValue(sourceSnapshot),
    } as unknown as CrontabGateway
    const view = renderHook(() => useSessionCrontab({ api, session, enabled: true }))
    await waitFor(() => expect(view.result.current.snapshot).toEqual(snapshot))

    let source: CrontabSnapshot | null = null
    await act(async () => {
      source = await view.result.current.loadSource()
    })

    expect(source).toEqual(sourceSnapshot)
    expect(api.sessionCrontabSource).toHaveBeenCalledTimes(1)
    expect(view.result.current.snapshot?.content).toBeUndefined()
  })

  it('原文保存使用草稿配对的 revision 而不是 Hook 后续刷新的 revision', async () => {
    const refreshedSnapshot = { ...snapshot, revision: 'revision-b' }
    const savedSnapshot = { ...snapshot, revision: 'revision-c' }
    const replaceSessionCrontab = vi.fn<CrontabGateway['replaceSessionCrontab']>()
      .mockResolvedValue(savedSnapshot)
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>().mockResolvedValue(capability),
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>()
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce(refreshedSnapshot),
      replaceSessionCrontab,
    } as unknown as CrontabGateway
    const view = renderHook(() => useSessionCrontab({ api, session, enabled: true }))
    await waitFor(() => expect(view.result.current.snapshot?.revision).toBe('revision-a'))

    await act(async () => {
      await view.result.current.refresh()
    })
    expect(view.result.current.snapshot?.revision).toBe('revision-b')

    await act(async () => {
      await view.result.current.replaceContent('0 2 * * * /usr/bin/true\n', 'revision-a')
    })
    expect(replaceSessionCrontab).toHaveBeenCalledWith('session-a', {
      content: '0 2 * * * /usr/bin/true\n',
      expected_revision: 'revision-a',
    })
  })

  it('面板失活时取消正在进行的只读请求', async () => {
    const pending = deferred<CrontabCapability>()
    const sessionCrontabCapability = vi.fn<CrontabGateway['sessionCrontabCapability']>(() => pending.promise)
    const api = { sessionCrontabCapability } as unknown as CrontabGateway
    const view = renderHook(({ enabled }) => useSessionCrontab({ api, session, enabled }), {
      initialProps: { enabled: true },
    })
    await waitFor(() => expect(sessionCrontabCapability).toHaveBeenCalledTimes(1))
    const signal = sessionCrontabCapability.mock.calls[0][1]?.signal as AbortSignal

    view.rerender({ enabled: false })
    expect(signal.aborted).toBe(true)
    expect(view.result.current.loading).toBe(false)

    await act(async () => {
      pending.reject(new Error('aborted'))
      await Promise.resolve()
    })
  })

  it('切换会话时取消旧读取并忽略迟到响应', async () => {
    const pendingSessionA = deferred<CrontabSnapshot>()
    const sessionB = { ...session, id: 'session-b' }
    const snapshotB = { ...snapshot, session_id: 'session-b', revision: 'revision-b' }
    const sessionCrontab = vi.fn<CrontabGateway['sessionCrontab']>((sessionId) => (
      sessionId === 'session-a' ? pendingSessionA.promise : Promise.resolve(snapshotB)
    ))
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>().mockResolvedValue(capability),
      sessionCrontab,
    } as unknown as CrontabGateway
    const view = renderHook(({ activeSession }) => useSessionCrontab({
      api,
      session: activeSession,
      enabled: true,
    }), {
      initialProps: { activeSession: session },
    })
    await waitFor(() => expect(sessionCrontab).toHaveBeenCalledWith(
      'session-a',
      { signal: expect.any(AbortSignal) },
    ))
    const sessionASignal = sessionCrontab.mock.calls[0][1]?.signal as AbortSignal

    view.rerender({ activeSession: sessionB })
    await waitFor(() => expect(view.result.current.snapshot).toEqual(snapshotB))
    expect(sessionASignal.aborted).toBe(true)

    await act(async () => {
      pendingSessionA.resolve(snapshot)
      await Promise.resolve()
    })
    expect(view.result.current.snapshot).toEqual(snapshotB)
  })

  it('页签隐藏不取消已提交写操作且服务端快照替换本地状态', async () => {
    const pending = deferred<CrontabSnapshot>()
    const nextSnapshot = { ...snapshot, revision: 'revision-b', content: '0 2 * * * /usr/bin/true\n', jobs: [{
      id: 'job-a',
      line_number: 1,
      enabled: true,
      schedule_kind: 'standard' as const,
      expression: '0 2 * * *',
      command: '/usr/bin/true',
      editable: true,
      warnings: [],
    }] }
    const createSessionCrontabJob = vi.fn<CrontabGateway['createSessionCrontabJob']>(() => pending.promise)
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>().mockResolvedValue(capability),
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>().mockResolvedValue(snapshot),
      createSessionCrontabJob,
    } as unknown as CrontabGateway
    const view = renderHook(({ enabled }) => useSessionCrontab({ api, session, enabled }), {
      initialProps: { enabled: true },
    })
    await waitFor(() => expect(view.result.current.snapshot).toEqual(snapshot))

    let mutation: Promise<CrontabSnapshot>
    act(() => {
      mutation = view.result.current.createJob({
        schedule: '0 2 * * *',
        command: '/usr/bin/true',
        enabled: true,
      })
    })
    await waitFor(() => expect(createSessionCrontabJob).toHaveBeenCalledTimes(1))
    expect(createSessionCrontabJob).toHaveBeenCalledWith('session-a', {
      expected_revision: 'revision-a',
      schedule: '0 2 * * *',
      command: '/usr/bin/true',
      enabled: true,
    })

    view.rerender({ enabled: false })
    await act(async () => {
      pending.resolve(nextSnapshot)
      await mutation!
    })
    expect(view.result.current.snapshot).toEqual({
      ...nextSnapshot,
      content: undefined,
    })
    expect(view.result.current.snapshot).not.toHaveProperty('content')
  })

  it('只读能力在前端运行时边界拒绝写请求', async () => {
    const createSessionCrontabJob = vi.fn<CrontabGateway['createSessionCrontabJob']>()
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>().mockResolvedValue({
        ...capability,
        status: 'read_only',
        writable: false,
      }),
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>().mockResolvedValue(snapshot),
      createSessionCrontabJob,
    } as unknown as CrontabGateway
    const view = renderHook(() => useSessionCrontab({ api, session, enabled: true }))
    await waitFor(() => expect(view.result.current.snapshot).toEqual(snapshot))

    await expect(view.result.current.createJob({
      schedule: '0 2 * * *',
      command: '/usr/bin/true',
      enabled: true,
    })).rejects.toMatchObject({ code: 'CRONTAB_UNSUPPORTED', status: 400 })
    expect(createSessionCrontabJob).not.toHaveBeenCalled()
  })

  it('进入原文编辑前以最新能力复核写权限', async () => {
    const sessionCrontabSource = vi.fn<CrontabGateway['sessionCrontabSource']>()
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>()
        .mockResolvedValueOnce(capability)
        .mockResolvedValueOnce({
          ...capability,
          status: 'read_only',
          writable: false,
        }),
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>().mockResolvedValue(snapshot),
      sessionCrontabSource,
    } as unknown as CrontabGateway
    const view = renderHook(() => useSessionCrontab({ api, session, enabled: true }))
    await waitFor(() => expect(view.result.current.snapshot).toEqual(snapshot))

    let source: CrontabSnapshot | null = snapshot
    await act(async () => {
      source = await view.result.current.loadSource(true)
    })

    expect(source).toBeNull()
    expect(view.result.current.capability).toMatchObject({ status: 'read_only', writable: false })
    expect(sessionCrontabSource).not.toHaveBeenCalled()
  })

  it('已有缓存的普通刷新失败后不继续暴露旧快照和旧写权限', async () => {
    const sessionCrontabCapability = vi.fn<CrontabGateway['sessionCrontabCapability']>()
      .mockResolvedValueOnce(capability)
      .mockRejectedValueOnce(new Error('remote unavailable'))
    const api = {
      sessionCrontabCapability,
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>().mockResolvedValue(snapshot),
    } as unknown as CrontabGateway
    const view = renderHook(({ enabled }) => useSessionCrontab({ api, session, enabled }), {
      initialProps: { enabled: true },
    })
    await waitFor(() => expect(view.result.current.snapshot).toEqual(snapshot))

    view.rerender({ enabled: false })
    view.rerender({ enabled: true })

    await waitFor(() => expect(view.result.current.errorMessage).toBe('remote unavailable'))
    expect(view.result.current.snapshot).toBeNull()
    expect(view.result.current.capability).toBeNull()
  })

  it('原文重新加载失败时保留结构化快照供用户核对', async () => {
    const api = {
      sessionCrontabCapability: vi.fn<CrontabGateway['sessionCrontabCapability']>().mockResolvedValue(capability),
      sessionCrontab: vi.fn<CrontabGateway['sessionCrontab']>().mockResolvedValue(snapshot),
      sessionCrontabSource: vi.fn<CrontabGateway['sessionCrontabSource']>().mockRejectedValue(new Error('source unavailable')),
    } as unknown as CrontabGateway
    const view = renderHook(() => useSessionCrontab({ api, session, enabled: true }))
    await waitFor(() => expect(view.result.current.snapshot).toEqual(snapshot))

    await expect(view.result.current.loadSource()).rejects.toThrow('source unavailable')

    expect(view.result.current.snapshot).toEqual(snapshot)
    expect(view.result.current.capability).toEqual(capability)
  })
})

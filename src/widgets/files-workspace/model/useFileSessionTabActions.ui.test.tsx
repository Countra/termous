import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { FileSession } from '#entities/file'
import { fileSessionTabPreferencesKey, useFileSessionTabActions } from './useFileSessionTabActions'

const session: FileSession = {
  id: 'files-source', host_id: 'host', origin: 'app', status: 'connected',
  file_access_profile_id: 's3-profile', source_session_id: 'ssh-source',
  current_path: '/initial', started_at: '2026-09-28T00:00:00Z',
}
const replacement: FileSession = { ...session, id: 'files-new' }

afterEach(() => localStorage.removeItem(fileSessionTabPreferencesKey))

function setup() {
  const options = {
    initialPath: '/background-tab',
    onConnect: vi.fn(async () => replacement),
    onRestart: vi.fn<() => Promise<FileSession | null>>(async () => replacement),
  }
  return { ...renderHook(() => useFileSessionTabActions()), options }
}

test('复制保留准确的文件配置和目录，但不复用 SSH 来源文件会话', async () => {
  const harness = setup()
  await act(async () => {
    expect(await harness.result.current.run('duplicate', session, harness.options)).toEqual(replacement)
  })
  expect(harness.options.onConnect).toHaveBeenCalledWith({ fileAccessProfileId: 's3-profile', initialPath: '/background-tab' })
  expect(harness.options.onRestart).not.toHaveBeenCalled()
})

test('等待重启时拦截同一会话的重复操作，其他会话可以独立复制', async () => {
  const harness = setup()
  let resolve!: (value: FileSession) => void
  harness.options.onRestart.mockReturnValue(new Promise<FileSession>((done) => { resolve = done }))
  let restart!: Promise<FileSession | null>
  act(() => { restart = harness.result.current.run('restart', session, harness.options) })
  expect(harness.result.current.pendingIds.has(session.id)).toBe(true)
  await act(async () => {
    expect(await harness.result.current.run('duplicate', session, harness.options)).toBeNull()
    await harness.result.current.run('duplicate', { ...session, id: 'another' }, harness.options)
  })
  expect(harness.options.onConnect).toHaveBeenCalledTimes(1)
  expect(harness.options.onRestart).toHaveBeenCalledExactlyOnceWith(session, '/background-tab')
  await act(async () => { resolve(replacement); await restart })
  expect(harness.result.current.pendingIds.size).toBe(0)
})

test('重启返回未执行时不创建备用连接，也不改写原标签', async () => {
  const harness = setup()
  act(() => harness.result.current.update(session.id, () => ({ title: 'archive' })))
  harness.options.onRestart.mockResolvedValue(null)
  await act(async () => { expect(await harness.result.current.run('restart', session, harness.options)).toBeNull() })
  expect(harness.options.onConnect).not.toHaveBeenCalled()
  expect(harness.result.current.preferences).toEqual({ [session.id]: { title: 'archive' } })
  expect(harness.result.current.pendingIds.size).toBe(0)
})

test('请求失败向调用方报告并解除防重状态，允许再次执行', async () => {
  const harness = setup()
  const failure = new Error('profile unavailable')
  harness.options.onConnect.mockRejectedValueOnce(failure)
  await act(async () => { await expect(harness.result.current.run('duplicate', session, harness.options)).rejects.toBe(failure) })
  expect(harness.result.current.pendingIds.size).toBe(0)
  await act(async () => { await harness.result.current.run('duplicate', session, harness.options) })
  expect(harness.options.onConnect).toHaveBeenCalledTimes(2)
})

test('缺少原配置或连接尚未结束时不发起重启', async () => {
  const harness = setup()
  await act(async () => {
    expect(await harness.result.current.run('restart', { ...session, file_access_profile_id: undefined }, harness.options)).toBeNull()
    expect(await harness.result.current.run('restart', { ...session, status: 'waiting_trust' }, harness.options)).toBeNull()
  })
  expect(harness.options.onRestart).not.toHaveBeenCalled()
  expect(harness.options.onConnect).not.toHaveBeenCalled()
})

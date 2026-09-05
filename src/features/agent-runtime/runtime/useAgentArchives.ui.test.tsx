import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentMessagePage, AgentSessionPage } from '#entities/agent'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import { agentMessageFixture, agentSessionFixture } from '../model/agentRuntimeTestFixtures.ts'
import { useAgentArchives } from './useAgentArchives.ts'

const archive = (id: string) => agentSessionFixture({ id, title: id, archived_at: '2026-09-05T00:00:00Z' })
const message = (sessionId: string, sequence = 1) => agentMessageFixture({
  id: `${sessionId}-${sequence}`, session_id: sessionId, sequence,
})

function gatewayFixture() {
  return {
    sessions: vi.fn<AgentWorkspaceGateway['sessions']>().mockResolvedValue({ items: [archive('one'), archive('two')] }),
    messages: vi.fn<AgentWorkspaceGateway['messages']>().mockImplementation(async (id) => ({ items: [message(id)] })),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useAgentArchives', () => {
  it('关闭时不请求数据，打开后独立读取所有归档页及所选会话记录', async () => {
    const gateway = gatewayFixture()
    gateway.sessions.mockResolvedValueOnce({ items: [archive('one')], next_cursor: 'next' })
      .mockResolvedValueOnce({ items: [archive('two')] })
    const view = renderHook(({ open }) => useAgentArchives(gateway, open), { initialProps: { open: false } })
    expect(gateway.sessions).not.toHaveBeenCalled()
    view.rerender({ open: true })
    await waitFor(() => expect(view.result.current.sessions).toHaveLength(2))
    expect(gateway.sessions).toHaveBeenNthCalledWith(2, {
      archived: true, query: '', cursor: 'next', limit: 200, signal: expect.any(AbortSignal),
    })
    expect(view.result.current.selectedSession).toBeUndefined()
    act(() => view.result.current.selectSession('two'))
    await waitFor(() => expect(view.result.current.messages).toEqual([message('two')]))
    expect(view.result.current.selectedSession?.id).toBe('two')
    expect(gateway.messages).toHaveBeenCalledWith('two', { afterSequence: 0, limit: 200, signal: expect.any(AbortSignal) })
  })

  it('搜索时取消旧请求，即便网关忽略 AbortSignal 也不能用旧结果覆盖新查询', async () => {
    const gateway = gatewayFixture()
    const old = deferred<AgentSessionPage>()
    gateway.sessions.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ items: [archive('new')] })
    const view = renderHook(() => useAgentArchives(gateway, true))
    const signal = gateway.sessions.mock.calls[0][0]?.signal
    act(() => view.result.current.setQuery('  新标题  '))
    await waitFor(() => expect(view.result.current.sessions[0]?.id).toBe('new'))
    expect(signal?.aborted).toBe(true)
    expect(gateway.sessions.mock.calls[1][0]).toMatchObject({ query: '新标题', archived: true })
    await act(async () => old.resolve({ items: [archive('old')] }))
    expect(view.result.current.sessions.map(({ id }) => id)).toEqual(['new'])
    expect(view.result.current.listError).toBeUndefined()
  })

  it('快速切换预览与重复选择时不串消息，也不会把已选会话清空后卡住', async () => {
    const gateway = gatewayFixture()
    const old = deferred<AgentMessagePage>()
    gateway.messages.mockReturnValueOnce(old.promise)
    const view = renderHook(() => useAgentArchives(gateway, true))
    await waitFor(() => expect(view.result.current.sessions).toHaveLength(2))
    act(() => view.result.current.selectSession('one'))
    const oldSignal = gateway.messages.mock.calls[0][1]?.signal
    act(() => view.result.current.selectSession('two'))
    await waitFor(() => expect(view.result.current.messages).toEqual([message('two')]))
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => old.resolve({ items: [message('one')] }))
    act(() => view.result.current.selectSession('two'))
    expect(view.result.current.messages).toEqual([message('two')])
    expect(view.result.current.previewLoading).toBe(false)
    expect(gateway.messages).toHaveBeenCalledTimes(2)
  })

  it('关闭后终止列表和预览读取；重新打开不保留旧搜索、选择和错误', async () => {
    const gateway = gatewayFixture()
    const pending = deferred<AgentMessagePage>()
    gateway.messages.mockReturnValueOnce(pending.promise)
    const view = renderHook(({ open }) => useAgentArchives(gateway, open), { initialProps: { open: true } })
    await waitFor(() => expect(view.result.current.sessions).toHaveLength(2))
    act(() => view.result.current.setQuery('搜索'))
    await waitFor(() => expect(view.result.current.listLoading).toBe(false))
    act(() => view.result.current.selectSession('one'))
    const signal = gateway.messages.mock.calls[0][1]?.signal
    view.rerender({ open: false })
    expect(signal?.aborted).toBe(true)
    await act(async () => pending.reject(new Error('late failure')))
    expect(view.result.current.previewError).toBeUndefined()
    view.rerender({ open: true })
    await waitFor(() => expect(view.result.current.listLoading).toBe(false))
    expect(view.result.current.query).toBe('')
    expect(view.result.current.selectedSession).toBeUndefined()
    expect(view.result.current.messages).toEqual([])
  })

  it('预览拒绝属于其他会话的消息，重试后恢复并保留原归档选择', async () => {
    const gateway = gatewayFixture()
    gateway.messages.mockResolvedValueOnce({ items: [message('other')] })
    const view = renderHook(() => useAgentArchives(gateway, true))
    await waitFor(() => expect(view.result.current.sessions).toHaveLength(2))
    act(() => view.result.current.selectSession('one'))
    await waitFor(() => expect(view.result.current.previewError).toBe('AGENT_MESSAGE_OWNER_INVALID'))
    expect(view.result.current.messages).toEqual([])
    act(() => view.result.current.reloadPreview())
    await waitFor(() => expect(view.result.current.messages).toEqual([message('one')]))
    expect(view.result.current.previewError).toBeUndefined()
    expect(view.result.current.selectedSession?.id).toBe('one')
  })

  it('列表拒绝循环游标，错误只保存在归档状态且可以重试', async () => {
    const gateway = gatewayFixture()
    gateway.sessions.mockResolvedValue({ items: [], next_cursor: 'same' })
    const view = renderHook(() => useAgentArchives(gateway, true))
    await waitFor(() => expect(view.result.current.listError).toBe('AGENT_SESSION_CURSOR_INVALID'))
    expect(gateway.sessions).toHaveBeenCalledTimes(2)
    gateway.sessions.mockResolvedValue({ items: [archive('one')] })
    act(() => view.result.current.reload())
    await waitFor(() => expect(view.result.current.sessions).toHaveLength(1))
    expect(view.result.current.listError).toBeUndefined()
  })

  it('移除已恢复或删除的归档时取消旧列表，重新对账且保留其他预览', async () => {
    const gateway = gatewayFixture()
    const view = renderHook(() => useAgentArchives(gateway, true))
    await waitFor(() => expect(view.result.current.sessions).toHaveLength(2))
    act(() => view.result.current.selectSession('one'))
    await waitFor(() => expect(view.result.current.messages).toEqual([message('one')]))
    const removeFromEarlierRender = view.result.current.removeSession
    act(() => view.result.current.selectSession('two'))
    await waitFor(() => expect(view.result.current.messages).toEqual([message('two')]))
    const old = deferred<AgentSessionPage>()
    gateway.sessions.mockReturnValueOnce(old.promise).mockResolvedValue({ items: [archive('two')] })
    act(() => view.result.current.reload())
    act(() => removeFromEarlierRender('one'))
    await waitFor(() => expect(view.result.current.listLoading).toBe(false))
    await act(async () => old.resolve({ items: [archive('one'), archive('two')] }))
    expect(view.result.current.sessions.map(({ id }) => id)).toEqual(['two'])
    expect(view.result.current.messages).toEqual([message('two')])
    expect(view.result.current.selectedSession?.id).toBe('two')
  })

  it('会话同步变化刷新归档并中止旧查询，保留仍存在的预览且关闭后不读取', async () => {
    const gateway = gatewayFixture()
    const initial = { open: true, snapshot: [agentSessionFixture()] }
    const view = renderHook(({ open, snapshot }) => useAgentArchives(gateway, open, snapshot), { initialProps: initial })
    await waitFor(() => expect(view.result.current.sessions).toHaveLength(2))
    act(() => view.result.current.selectSession('two'))
    await waitFor(() => expect(view.result.current.messages).toEqual([message('two')]))
    view.rerender(initial)
    expect(gateway.sessions).toHaveBeenCalledTimes(1)

    const old = deferred<AgentSessionPage>()
    gateway.sessions.mockReturnValueOnce(old.promise)
    view.rerender({ open: true, snapshot: [...initial.snapshot] })
    const oldSignal = gateway.sessions.mock.calls[1][0]?.signal
    gateway.sessions.mockResolvedValue({ items: [archive('two')] })
    view.rerender({ open: true, snapshot: [...initial.snapshot] })
    await waitFor(() => expect(view.result.current.sessions.map(({ id }) => id)).toEqual(['two']))
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => old.resolve({ items: [archive('one'), archive('two')] }))
    expect(view.result.current.sessions.map(({ id }) => id)).toEqual(['two'])
    expect(view.result.current.selectedSession?.id).toBe('two')
    expect(view.result.current.messages).toEqual([message('two')])
    expect(gateway.messages).toHaveBeenCalledTimes(1)

    gateway.sessions.mockResolvedValue({ items: [] })
    view.rerender({ open: true, snapshot: [...initial.snapshot] })
    await waitFor(() => expect(view.result.current.selectedSession).toBeUndefined())
    expect(view.result.current.messages).toEqual([])
    view.rerender({ open: false, snapshot: [...initial.snapshot] })
    expect(gateway.sessions).toHaveBeenCalledTimes(4)
  })
})

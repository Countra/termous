import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession, AgentSessionGroup, AgentSessionPage } from '#entities/agent'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import { AgentWorkspaceController } from '../runtime/AgentWorkspaceController.ts'
import { agentFixtureTime, agentSessionFixture } from './agentRuntimeTestFixtures.ts'
import { useAgentSessionManagement } from './useAgentSessionManagement.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function fixture() {
  const sessions = [agentSessionFixture({ id: 'one', revision: 4 }), agentSessionFixture({ id: 'two', revision: 7 })]
  const group: AgentSessionGroup = { id: 'group', name: '运维', revision: 2, sort_order: 0, created_at: agentFixtureTime, updated_at: agentFixtureTime }
  const methods = {
    sessions: vi.fn<AgentWorkspaceGateway['sessions']>().mockResolvedValue({ items: sessions }),
    session: vi.fn<AgentWorkspaceGateway['session']>().mockImplementation(async (id) => sessions.find((item) => item.id === id)!),
    createSession: vi.fn<AgentWorkspaceGateway['createSession']>().mockImplementation(async (input) => sessions.find(({ id }) => id === input.title)!),
    sessionGroups: vi.fn<AgentWorkspaceGateway['sessionGroups']>().mockResolvedValue({ items: [group] }),
    updateSessionMetadata: vi.fn<AgentWorkspaceGateway['updateSessionMetadata']>().mockImplementation(async (id, input) => ({
      ...sessions.find((item) => item.id === id)!, ...input, revision: input.expected_revision + 1,
    })),
    moveSessionPin: vi.fn<AgentWorkspaceGateway['moveSessionPin']>().mockResolvedValue({ items: sessions }),
    moveSession: vi.fn<AgentWorkspaceGateway['moveSession']>().mockResolvedValue({ items: sessions }),
    createSessionGroup: vi.fn<AgentWorkspaceGateway['createSessionGroup']>().mockResolvedValue(group),
    updateSessionGroup: vi.fn<AgentWorkspaceGateway['updateSessionGroup']>().mockResolvedValue(group),
    deleteSessionGroup: vi.fn<AgentWorkspaceGateway['deleteSessionGroup']>().mockResolvedValue(undefined),
    moveSessionGroup: vi.fn<AgentWorkspaceGateway['moveSessionGroup']>().mockResolvedValue({ items: [group] }),
    eventsUrl: () => 'ws://session-management.test/events',
    runtimeStatus: vi.fn<AgentWorkspaceGateway['runtimeStatus']>().mockResolvedValue({ state: 'ready' }),
    onRuntimeStatus: vi.fn().mockReturnValue(() => undefined),
    messages: vi.fn<AgentWorkspaceGateway['messages']>().mockResolvedValue({ items: [] }),
    queuedTurns: vi.fn<AgentWorkspaceGateway['queuedTurns']>().mockResolvedValue({ items: [] }),
    context: vi.fn<AgentWorkspaceGateway['context']>().mockImplementation(async (id) => ({
      session_id: id, estimated_tokens: 100, context_window_tokens: 32_768, estimated: true,
      warning: false, compression_available: false,
    })),
    usage: vi.fn<AgentWorkspaceGateway['usage']>().mockImplementation(async (id) => ({
      session_id: id, run_count: 0, input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
      output_tokens: 0, reasoning_tokens: 0, total_tokens: 0, estimated: false, updated_at: agentFixtureTime,
    })),
  }
  // 使用真实 Controller，只补本测试可达的网关方法，未实现的方法不会被主动调用。
  const gateway = methods as unknown as AgentWorkspaceGateway
  const socket = Object.assign(new EventTarget(), { readyState: 0, close: vi.fn() })
  const controller = new AgentWorkspaceController({ gateway, socketFactory: () => socket as unknown as WebSocket })
  for (const session of sessions) await controller.createSession({ title: session.id, model_id: session.model_id, reasoning_level: session.reasoning_level })
  controller.start()
  await controller.reload()
  await controller.reloadSessionGroups()
  methods.sessions.mockClear()
  return { gateway, methods, controller, sessions }
}

describe('useAgentSessionManagement', () => {
  it('提交时使用最新 revision，发送窄 metadata 并保留主选择、草稿和上下文', async () => {
    const { controller, gateway, methods, sessions } = await fixture()
    controller.updateDraft('two', '未发送的正文')
    const before = controller.getSnapshot()
    const view = renderHook(() => useAgentSessionManagement(controller, gateway, sessions, true))
    await act(async () => { await view.result.current.metadata('one', { title: '人工标题' }, { ...sessions[0], revision: 1 }) })
    expect(methods.updateSessionMetadata).toHaveBeenCalledWith('one', { title: '人工标题', expected_revision: 4 })
    expect(controller.getSnapshot().selected_session_id).toBe(before.selected_session_id)
    expect(controller.getSnapshot().drafts).toEqual(before.drafts)
    expect(controller.getSnapshot().session_contexts).toEqual(before.session_contexts)
    controller.close()
  })

  it('按会话阻止重复提交，同时允许不相关会话继续操作', async () => {
    const { controller, gateway, methods, sessions } = await fixture()
    const pending = deferred<AgentSession>()
    methods.updateSessionMetadata.mockReturnValueOnce(pending.promise)
    const view = renderHook(() => useAgentSessionManagement(controller, gateway, sessions, true))
    let first!: Promise<AgentSession>
    act(() => { first = view.result.current.metadata('one', { title: '正在保存' }) })
    expect(view.result.current.pendingIds.has('one')).toBe(true)
    await act(async () => {
      await expect(view.result.current.metadata('one', { group_id: 'group' })).rejects.toThrow('AGENT_MUTATION_IN_PROGRESS')
      await view.result.current.metadata('two', { title: '独立保存' })
    })
    expect(methods.updateSessionMetadata).toHaveBeenCalledTimes(2)
    await act(async () => { pending.resolve({ ...sessions[0], revision: 5 }); await first })
    expect(view.result.current.pendingIds.size).toBe(0)
    controller.close()
  })

  it('metadata 冲突对账但不自动重发旧意图，对账失败也保留原错误', async () => {
    const { controller, gateway, methods, sessions } = await fixture()
    const conflict = Object.assign(new Error('保存冲突'), { code: 'AGENT_REVISION_CONFLICT' })
    methods.updateSessionMetadata.mockRejectedValue(conflict)
    methods.session.mockResolvedValue({ ...sessions[0], title: '别处更新', revision: 9 })
    methods.sessionGroups.mockRejectedValue(new Error('无法加载分组'))
    const view = renderHook(() => useAgentSessionManagement(controller, gateway, sessions, true))
    await act(async () => { await expect(view.result.current.metadata('one', { title: '旧意图' })).rejects.toBe(conflict) })
    expect(methods.updateSessionMetadata).toHaveBeenCalledTimes(1)
    expect(methods.session).toHaveBeenCalledWith('one')
    expect(controller.getSnapshot().sessions.find(({ id }) => id === 'one')?.title).toBe('别处更新')
    expect(view.result.current.pendingIds.size).toBe(0)
    controller.close()
  })

  it('置顶移动传递双方 CAS，失败后读取双方最新版本并解除忙碌', async () => {
    const { controller, gateway, methods, sessions } = await fixture()
    const conflict = new Error('顺序冲突')
    methods.moveSessionPin.mockRejectedValue(conflict)
    const view = renderHook(() => useAgentSessionManagement(controller, gateway, sessions, true))
    await act(async () => { await expect(view.result.current.movePin('one', 'two', 'after')).rejects.toBe(conflict) })
    expect(methods.moveSessionPin).toHaveBeenCalledWith('one', { expected_revision: 4, target_id: 'two', target_expected_revision: 7, placement: 'after' })
    expect(methods.session).toHaveBeenCalledWith('one')
    expect(methods.session).toHaveBeenCalledWith('two')
    expect(view.result.current.pendingIds.size).toBe(0)
    controller.close()
  })

  it('跨区拖动只提交一次相对移动，保持草稿且冲突后读取双方最新版本', async () => {
    const { controller, gateway, methods, sessions } = await fixture()
    controller.updateDraft('two', '继续保留草稿')
    const view = renderHook(() => useAgentSessionManagement(controller, gateway, sessions, true))
    await act(async () => { await view.result.current.moveSession('one', 'two', 'before') })
    expect(methods.moveSession).toHaveBeenCalledWith('one', { expected_revision: 4, target_id: 'two', target_expected_revision: 7, placement: 'before' })
    expect(methods.updateSessionMetadata).not.toHaveBeenCalled()
    expect(methods.moveSessionPin).not.toHaveBeenCalled()
    expect(controller.getSnapshot().drafts.two?.text).toBe('继续保留草稿')
    const conflict = new Error('目的会话已移组')
    methods.moveSession.mockRejectedValueOnce(conflict)
    await act(async () => { await expect(view.result.current.moveSession('one', 'two', 'after')).rejects.toBe(conflict) })
    expect(methods.session).toHaveBeenCalledWith('one')
    expect(methods.session).toHaveBeenCalledWith('two')
    expect(view.result.current.pendingIds.size).toBe(0)
    controller.close()
  })

  it('切换搜索取消旧请求；迟到响应不覆盖新结果，也不替换主会话集合', async () => {
    const { controller, gateway, methods, sessions } = await fixture()
    const old = deferred<AgentSessionPage>()
    methods.sessions.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ items: [sessions[1]] })
    const view = renderHook(() => useAgentSessionManagement(controller, gateway, sessions, true))
    act(() => view.result.current.setQuery('旧查询'))
    await waitFor(() => expect(methods.sessions).toHaveBeenCalledTimes(1))
    const signal = methods.sessions.mock.calls[0][0]?.signal
    act(() => view.result.current.setQuery('新查询'))
    await waitFor(() => expect(view.result.current.searchResults).toEqual([sessions[1]]))
    await act(async () => old.resolve({ items: [sessions[0]] }))
    expect(signal?.aborted).toBe(true)
    expect(view.result.current.searchResults).toEqual([sessions[1]])
    expect(controller.getSnapshot().sessions).toHaveLength(2)
    expect(controller.getSnapshot().selected_session_id).toBe('two')
    controller.close()
  })

  it('后台停用取消搜索，重新激活读取新结果；空查询不再请求服务器', async () => {
    const { controller, gateway, methods, sessions } = await fixture()
    const old = deferred<AgentSessionPage>()
    methods.sessions.mockReturnValueOnce(old.promise).mockResolvedValue({ items: [sessions[1]] })
    const view = renderHook(({ enabled }) => useAgentSessionManagement(controller, gateway, sessions, enabled), { initialProps: { enabled: true } })
    act(() => view.result.current.setQuery('标题'))
    await waitFor(() => expect(methods.sessions).toHaveBeenCalledTimes(1))
    const signal = methods.sessions.mock.calls[0][0]?.signal
    view.rerender({ enabled: false })
    expect(signal?.aborted).toBe(true)
    await act(async () => old.resolve({ items: [sessions[0]] }))
    view.rerender({ enabled: true })
    await waitFor(() => expect(view.result.current.searchResults).toEqual([sessions[1]]))
    act(() => view.result.current.setQuery(''))
    expect(view.result.current.searchResults).toEqual([])
    expect(view.result.current.searchLoading).toBe(false)
    expect(methods.sessions).toHaveBeenCalledTimes(2)
    controller.close()
  })
})

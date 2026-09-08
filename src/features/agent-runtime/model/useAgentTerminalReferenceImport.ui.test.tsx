import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentLaunchIntent, AgentQueuedTurn, AgentResourceBinding, AgentSession, AgentSSHResourceState } from '#entities/agent'
import type { AgentWorkspaceController } from '../runtime/AgentWorkspaceController.ts'
import { createAgentWorkspaceState, type AgentWorkspaceState } from './agentWorkspaceState.ts'
import { agentFixtureTime, agentRunFixture, agentSessionFixture } from './agentRuntimeTestFixtures.ts'
import { useAgentTerminalReferenceImport } from './useAgentTerminalReferenceImport.ts'

type Options = Parameters<typeof useAgentTerminalReferenceImport>[0]
type Intent = Extract<AgentLaunchIntent, { source: 'terminal_selection' }>

describe('useAgentTerminalReferenceImport', () => {
  it('同源活动会话只追加引用并保持已有草稿，重复意图只接管一次', async () => {
    const fixture = setup({ runs: { run: agentRunFixture() } })
    fixture.state.drafts[targetId] = { text: '用户正在编辑的提问', updated_at: 1 }
    const options = fixture.options()
    const view = renderHook((value: Options) => useAgentTerminalReferenceImport(value), { initialProps: options })
    await waitFor(() => expect(options.addReference).toHaveBeenCalledOnce())
    await waitFor(() => expect(view.result.current.current).toBeUndefined())
    expect(fixture.state.drafts[targetId]?.text).toBe('用户正在编辑的提问')
    expect(options.createSession).not.toHaveBeenCalled()
    expect(options.onFocus).toHaveBeenCalledOnce()
    expect(options.addReference).toHaveBeenCalledWith(targetId, options.intent, 'draft')
    view.rerender({ ...options, intent: { ...options.intent! } })
    expect(options.onHandled).toHaveBeenCalledExactlyOnceWith(options.intent!.key)
    expect(options.addReference).toHaveBeenCalledOnce()
  })

  it('跨源替换需要确认，取消保留原关联和草稿且不上传', async () => {
    const fixture = setup({ sessions: [session({ resource_binding: binding('ssh-old') })] })
    const options = fixture.options()
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(view.result.current.current?.stage).toBe('confirm'))
    expect(view.result.current.current?.confirmation?.resource_binding?.session_id).toBe('ssh-old')
    expect(fixture.controller.replaceResourceBinding).not.toHaveBeenCalled()
    act(() => view.result.current.dismiss())
    expect(view.result.current.current).toBeUndefined()
    expect(options.addReference).not.toHaveBeenCalled()
    expect(fixture.state.sessions[0]?.resource_binding?.session_id).toBe('ssh-old')
  })

  it('确认期间其他窗口再次换绑必须重新确认，使用最新 revision 提交', async () => {
    const fixture = setup({ sessions: [session({ resource_binding: binding('ssh-old') })] })
    const options = fixture.options()
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(view.result.current.current?.stage).toBe('confirm'))
    fixture.patch({ sessions: [session({ revision: 7, resource_binding: binding('ssh-third') })] })
    act(() => view.result.current.confirm())
    await waitFor(() => expect(view.result.current.current?.confirmation?.resource_binding?.session_id).toBe('ssh-third'))
    expect(fixture.controller.replaceResourceBinding).not.toHaveBeenCalled()
    act(() => view.result.current.confirm())
    await waitFor(() => expect(options.addReference).toHaveBeenCalledOnce())
    expect(fixture.controller.replaceResourceBinding).toHaveBeenCalledWith(targetId, {
      kind: 'ssh_session', session_id: source.session_id, expected_revision: 7,
    })
  })

  it.each(['run', 'queue'] as const)('存在 %s 时拒绝跨源引用，不进入确认或修改绑定', async (lockedBy) => {
    const fixture = setup({ sessions: [session({ resource_binding: binding('ssh-old') })],
      ...(lockedBy === 'run' ? { runs: { run: agentRunFixture() } } : { queued_turns: { [targetId]: [queuedTurn()] } }),
    })
    const options = fixture.options()
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(view.result.current.current?.errorCode).toBe('AGENT_TERMINAL_REFERENCE_BINDING_LOCKED'))
    expect(view.result.current.current?.stage).toBe('failed')
    expect(fixture.controller.replaceResourceBinding).not.toHaveBeenCalled()
    expect(options.addReference).not.toHaveBeenCalled()
  })

  it('缺少默认模型时保留新会话引用，配置恢复后只创建一次', async () => {
    const fixture = setup()
    const options = fixture.options({ intent: intent({ target: { kind: 'new' } }), modelReady: false })
    const view = renderHook((value: Options) => useAgentTerminalReferenceImport(value), { initialProps: options })
    await waitFor(() => expect(view.result.current.current?.stage).toBe('configuration'))
    expect(view.result.current.current?.request.text).toBe('first\nsecond')
    expect(options.createSession).not.toHaveBeenCalled()
    view.rerender({ ...options, active: false, modelReady: true })
    expect(options.createSession).not.toHaveBeenCalled()
    view.rerender({ ...options, modelReady: true })
    await waitFor(() => expect(view.result.current.current).toBeUndefined())
    expect(options.createSession).toHaveBeenCalledOnce()
    expect(options.addReference).toHaveBeenCalledWith('ags-created', options.intent, 'draft')
    view.rerender({ ...options, modelReady: true })
    expect(options.createSession).toHaveBeenCalledOnce()
  })

  it('新建后附件拒绝可重试同一目标，不重复创建或丢失原文', async () => {
    const fixture = setup()
    const addReference = vi.fn<Options['addReference']>().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const options = fixture.options({ intent: intent({ target: { kind: 'new' } }), addReference })
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(view.result.current.current?.errorCode).toBe('AGENT_TERMINAL_REFERENCE_ATTACHMENT_REJECTED'))
    expect(view.result.current.current?.targetId).toBe('ags-created')
    act(() => view.result.current.retry())
    await waitFor(() => expect(view.result.current.current).toBeUndefined())
    expect(options.createSession).toHaveBeenCalledOnce()
    expect(addReference).toHaveBeenCalledTimes(2)
    expect(addReference.mock.calls.map(([id, request]) => [id, request.text])).toEqual([
      ['ags-created', 'first\nsecond'], ['ags-created', 'first\nsecond'],
    ])
  })

  it('附件 hook 已接管失败卡片并返回 true 时不再次导入', async () => {
    const fixture = setup()
    const options = fixture.options({ addReference: vi.fn(async () => true) })
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(options.addReference).toHaveBeenCalledOnce())
    await waitFor(() => expect(view.result.current.current).toBeUndefined())
    act(() => view.result.current.retry())
    expect(options.addReference).toHaveBeenCalledOnce()
  })

  it('会话查询在途时取消排队编辑，不把旧引用导入普通草稿；主动重试后才接受新归属', async () => {
    const fixture = setup()
    const pending = deferred<AgentSession>()
    fixture.controller.reloadSession.mockReturnValueOnce(pending.promise)
    let owner = 'queued:first'
    const options = fixture.options({ getOwnerId: () => owner })
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(fixture.controller.reloadSession).toHaveBeenCalledOnce())
    owner = 'draft'
    await act(async () => { pending.resolve(session()); await pending.promise })
    await waitFor(() => expect(view.result.current.current?.errorCode).toBe('AGENT_TERMINAL_REFERENCE_EDIT_CHANGED'))
    expect(fixture.controller.replaceResourceBinding).not.toHaveBeenCalled()
    expect(options.addReference).not.toHaveBeenCalled()
    act(() => view.result.current.retry())
    await waitFor(() => expect(view.result.current.current).toBeUndefined())
    expect(options.addReference).toHaveBeenCalledExactlyOnceWith(targetId, options.intent, 'draft')
  })

  it('换绑确认期间切换编辑项，确认不能隐式重定向引用', async () => {
    const fixture = setup({ sessions: [session({ resource_binding: binding('ssh-old') })] })
    let owner = 'queued:first'
    const options = fixture.options({ getOwnerId: () => owner })
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(view.result.current.current?.stage).toBe('confirm'))
    owner = 'queued:next'
    act(() => view.result.current.confirm())
    await waitFor(() => expect(view.result.current.current?.errorCode).toBe('AGENT_TERMINAL_REFERENCE_EDIT_CHANGED'))
    expect(fixture.controller.replaceResourceBinding).not.toHaveBeenCalled()
    expect(options.addReference).not.toHaveBeenCalled()
  })

  it('绑定在途时编辑 owner 改变则保留可重试引用，不污染新的排队草稿', async () => {
    const fixture = setup()
    const bindingPending = deferred<AgentSession>()
    fixture.controller.replaceResourceBinding.mockReturnValueOnce(bindingPending.promise)
    let owner = 'queued:first'
    const options = fixture.options({ getOwnerId: () => owner })
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(fixture.controller.replaceResourceBinding).toHaveBeenCalledOnce())
    owner = 'queued:reopened'
    await act(async () => { bindingPending.resolve(session()); await bindingPending.promise })
    await waitFor(() => expect(view.result.current.current?.errorCode).toBe('AGENT_TERMINAL_REFERENCE_EDIT_CHANGED'))
    expect(options.addReference).not.toHaveBeenCalled()
    expect(options.onFocus).not.toHaveBeenCalled()
  })

  it('绑定等待时切到其他会话，引用仍进入明确目标但不切回和抢焦点', async () => {
    const fixture = setup({ sessions: [session(), session({ id: 'ags-other' })] })
    const bindingPending = deferred<AgentSession>()
    fixture.controller.replaceResourceBinding.mockReturnValueOnce(bindingPending.promise)
    const options = fixture.options()
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(fixture.controller.replaceResourceBinding).toHaveBeenCalledOnce())
    fixture.controller.selectSession('ags-other')
    await act(async () => { bindingPending.resolve(session()); await bindingPending.promise })
    await waitFor(() => expect(view.result.current.current).toBeUndefined())
    expect(options.addReference).toHaveBeenCalledWith(targetId, options.intent, 'draft')
    expect(fixture.state.selected_session_id).toBe('ags-other')
    expect(fixture.controller.selectSession).toHaveBeenCalledExactlyOnceWith('ags-other')
    expect(options.onFocus).not.toHaveBeenCalled()
  })

  it('新建请求在途时用户只切换一次，迟到创建仅合并实体也不能被误认为自动选择', async () => {
    const fixture = setup({ sessions: [session(), session({ id: 'ags-other' })] })
    const pending = deferred<AgentSession>()
    const options = fixture.options({ intent: intent({ target: { kind: 'new' } }), createSession: vi.fn(() => pending.promise) })
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(options.createSession).toHaveBeenCalledOnce())
    fixture.controller.selectSession('ags-other')
    const created = session({ id: 'ags-created' })
    fixture.patch({ sessions: [...fixture.state.sessions, created] })
    await act(async () => { pending.resolve(created); await pending.promise })
    await waitFor(() => expect(view.result.current.current).toBeUndefined())
    expect(options.addReference).toHaveBeenCalledWith('ags-created', options.intent, 'draft')
    expect(fixture.state.selected_session_id).toBe('ags-other')
    expect(fixture.state.selection_intent_revision).toBe(1)
    expect(fixture.controller.selectSession).toHaveBeenCalledExactlyOnceWith('ags-other')
    expect(options.onFocus).not.toHaveBeenCalled()
  })

  it('上传在途时选择其他会话，即使原导入开始时拥有选择也不迟到聚焦', async () => {
    const fixture = setup({ sessions: [session(), session({ id: 'ags-other' })] })
    const pending = deferred<boolean>()
    const options = fixture.options({ addReference: vi.fn(() => pending.promise) })
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(options.addReference).toHaveBeenCalledOnce())
    fixture.controller.selectSession('ags-other')
    await act(async () => { pending.resolve(true); await pending.promise })
    await waitFor(() => expect(view.result.current.current).toBeUndefined())
    expect(fixture.state.selected_session_id).toBe('ags-other')
    expect(options.onFocus).not.toHaveBeenCalled()
  })

  it('SSH 重连后 started_at 改变，旧选择不能当作新连接引用', async () => {
    const fixture = setup()
    const bindingPending = deferred<AgentSession>()
    fixture.controller.replaceResourceBinding.mockReturnValueOnce(bindingPending.promise)
    const options = fixture.options()
    const view = renderHook((value: Options) => useAgentTerminalReferenceImport(value), { initialProps: options })
    await waitFor(() => expect(fixture.controller.replaceResourceBinding).toHaveBeenCalledOnce())
    view.rerender({ ...options, resources: [{ ...source, started_at: '2026-09-08T07:00:00Z' }] })
    await act(async () => { bindingPending.resolve(session()); await bindingPending.promise })
    await waitFor(() => expect(view.result.current.current?.errorCode).toBe('AGENT_TERMINAL_REFERENCE_SOURCE_UNAVAILABLE'))
    expect(options.addReference).not.toHaveBeenCalled()
  })

  it('换绑回执迟于其他窗口的新关联时，不把引用静默添加到已被替换的目标关联', async () => {
    const fixture = setup()
    const pending = deferred<AgentSession>()
    fixture.controller.replaceResourceBinding.mockReturnValueOnce(pending.promise)
    const options = fixture.options()
    const view = renderHook(() => useAgentTerminalReferenceImport(options))
    await waitFor(() => expect(fixture.controller.replaceResourceBinding).toHaveBeenCalledOnce())
    fixture.patch({ sessions: [session({ revision: 3, resource_binding: binding('ssh-third') })] })
    // 控制器按 revision 保留先到达的较新 WebSocket 实体，不接受迟到的旧 HTTP 快照。
    await act(async () => { pending.resolve(session({ revision: 2 })); await pending.promise })
    await waitFor(() => expect(view.result.current.current?.stage).toBe('failed'))
    expect(view.result.current.current?.errorCode).toBe('AGENT_REVISION_CONFLICT')
    expect(options.addReference).not.toHaveBeenCalled()
    expect(fixture.state.sessions[0]?.resource_binding?.session_id).toBe('ssh-third')
    act(() => view.result.current.retry())
    await waitFor(() => expect(view.result.current.current?.confirmation?.resource_binding?.session_id).toBe('ssh-third'))
    expect(options.addReference).not.toHaveBeenCalled()
    act(() => view.result.current.confirm())
    await waitFor(() => expect(view.result.current.current).toBeUndefined())
    expect(options.addReference).toHaveBeenCalledOnce()
  })

  it('导入正在上传时接管新的引用，前一项完成后按顺序消费且不重复上传', async () => {
    const fixture = setup()
    const pending = deferred<boolean>()
    const addReference = vi.fn<Options['addReference']>().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(true)
    const options = fixture.options({ addReference })
    const view = renderHook((value: Options) => useAgentTerminalReferenceImport(value), { initialProps: options })
    await waitFor(() => expect(addReference).toHaveBeenCalledOnce())
    const second = intent({ key: 2, text: 'third\nfourth' })
    view.rerender({ ...options, intent: second })
    expect(addReference).toHaveBeenCalledOnce()
    await act(async () => { pending.resolve(true); await pending.promise })
    await waitFor(() => expect(addReference).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.result.current.current).toBeUndefined())
    expect(addReference.mock.calls.map(([, request]) => request.text)).toEqual(['first\nsecond', 'third\nfourth'])
  })
})

const targetId = 'ags-session'
const source: AgentSSHResourceState = {
  session_id: 'ssh_source', host_id: 'host_source', ssh_profile_id: 'profile_source', host_name: '生产主机',
  ssh_profile_name: 'SSH', status: 'ready', started_at: agentFixtureTime,
}

function binding(id = source.session_id): AgentResourceBinding {
  return { kind: 'ssh_session', session_id: id, host_id: source.host_id, ssh_profile_id: source.ssh_profile_id,
    host_name: source.host_name, platform: 'linux', bound_at: agentFixtureTime }
}

function session(overrides: Partial<AgentSession> = {}) {
  return agentSessionFixture({ resource_binding: binding(), ...overrides })
}

function intent(overrides: Partial<Intent> = {}): Intent {
  return { key: 1, source: 'terminal_selection', target: { kind: 'session', session_id: targetId }, text: 'first\nsecond',
    origin: { kind: 'terminal_selection', source_session_id: source.session_id, host_name: source.host_name, captured_at: agentFixtureTime, line_count: 2 },
    resource_reference: { kind: 'ssh_session', session_id: source.session_id }, source_resource: { ...source }, ...overrides }
}

function queuedTurn(): AgentQueuedTurn {
  return { id: 'agt_1', session_id: targetId, client_request_id: 'request_1', queue_sequence: 1, prompt: '原有排队消息',
    model_id: 'model_1', reasoning_level: 'medium', force_context_compression: false, state: 'queued', editing: false,
    revision: 1, created_at: agentFixtureTime, updated_at: agentFixtureTime, attachments: [] }
}

function setup(initial: Partial<AgentWorkspaceState> = {}) {
  let state: AgentWorkspaceState = { ...createAgentWorkspaceState(), snapshot_complete: true, phase: 'ready',
    sessions: [session()], selected_session_id: targetId, ...initial }
  const controller = {
    getSnapshot: () => state,
    reloadSession: vi.fn(async (id: string) => state.sessions.find((value) => value.id === id)),
    replaceResourceBinding: vi.fn(async (id: string, input: { session_id: string; expected_revision: number }): Promise<AgentSession> => {
      const current = state.sessions.find((value) => value.id === id)!
      const next = { ...current, resource_binding: binding(input.session_id), revision: current.revision + 1 }
      state = { ...state, sessions: state.sessions.map((value) => value.id === id ? next : value) }
      return next
    }),
    selectSession: vi.fn((id: string) => {
      state = { ...state, selected_session_id: id, selection_intent_revision: state.selection_intent_revision + 1 }
    }),
  }
  return {
    get state() { return state },
    controller,
    patch: (patch: Partial<AgentWorkspaceState>) => { state = { ...state, ...patch } },
    options: (overrides: Partial<Options> = {}): Options => ({
      intent: intent(), controller: controller as unknown as AgentWorkspaceController, active: true, ready: true,
      modelReady: true, resourcesReady: true, resources: [{ ...source }],
      createSession: vi.fn(async () => {
        const created = session({ id: 'ags-created' })
        state = { ...state, sessions: [...state.sessions, created] }
        controller.selectSession(created.id)
        return created
      }),
      getOwnerId: vi.fn(() => 'draft'), addReference: vi.fn(async () => true), onHandled: vi.fn(), onFocus: vi.fn(), ...overrides,
    }),
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((done) => { resolve = done })
  return { promise, resolve }
}

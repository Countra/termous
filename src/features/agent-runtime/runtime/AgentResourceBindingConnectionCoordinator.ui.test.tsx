import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentResourceConnectionView,
  AgentSession,
  AgentSSHProfileResourceBinding,
  AgentSSHResourceBinding,
} from '#entities/agent'
import { TermousApiError } from '#shared/api'
import { agentSessionFixture } from '../model/agentRuntimeTestFixtures.ts'
import {
  AgentResourceBindingConnectionCoordinator,
  isAgentResourceBindingConnectionBlocking,
} from './AgentResourceBindingConnectionCoordinator.ts'

const time = '2026-09-12T00:00:00Z'
const sourceBinding: AgentSSHResourceBinding = {
  kind: 'ssh_session', session_id: 'ssh-old', host_id: 'host-old', host_name: '旧主机',
  ssh_profile_id: 'profile-old', platform: 'linux', bound_at: time,
}
const resultBinding: AgentSSHResourceBinding = {
  ...sourceBinding, session_id: 'ssh-new', host_id: 'host-new', host_name: '新主机', ssh_profile_id: 'profile-new',
}
const replacementBinding: AgentSSHProfileResourceBinding = {
  kind: 'ssh_profile', ssh_profile_id: 'profile-replacement', ssh_profile_name: '替换配置',
  host_id: 'host-replacement', host_name: '替换主机', platform: 'linux', bound_at: '2026-09-12T00:01:00Z',
}
const session = agentSessionFixture({ id: 'agent-one', resource_bindings: [sourceBinding] })
const connected = { ...session, revision: session.revision + 1, resource_bindings: [resultBinding] }
const replaced = { ...session, revision: session.revision + 1, resource_bindings: [replacementBinding] }

function view(status: NonNullable<AgentResourceConnectionView['operation']>['status'] = 'connecting', revision = 1) {
  return {
    instance_id: 'core-one',
    operation: {
      id: 'connection-one', instance_id: 'core-one', session_id: session.id, kind: 'ssh_session' as const,
      client_request_id: 'request-one', revision, status,
      target: {
        host_id: 'host-new', host_name: '新主机', ssh_profile_id: 'profile-new', profile_name: '默认', platform: 'linux' as const,
      },
      source_binding: sourceBinding, retryable: true, created_at: time, updated_at: time,
      ...(status === 'succeeded' ? { result_session: connected } : {}),
    },
  } satisfies AgentResourceConnectionView
}

function empty(instanceId = 'core-one'): AgentResourceConnectionView {
  return { instance_id: instanceId, operation: null }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const close of cleanup.splice(0)) close()
  vi.useRealTimers()
})

function fixture() {
  const gateway = {
    resourceBindingConnection: vi.fn().mockResolvedValue(empty()),
    connectResourceBinding: vi.fn().mockResolvedValue(view()),
    cancelResourceBindingConnection: vi.fn().mockResolvedValue(view('cancelled', 2)),
  }
  const accept = vi.fn<(value: AgentSession) => void>()
  const completed = vi.fn<(value: AgentSession) => void>()
  const coordinator = new AgentResourceBindingConnectionCoordinator(
    gateway,
    accept,
    () => 'request-one',
    completed,
  )
  coordinator.observe(session, false)
  cleanup.push(() => coordinator.dispose())
  return { gateway, accept, completed, coordinator }
}

describe('AgentResourceBindingConnectionCoordinator', () => {
  it('先获取实例，再以会话 revision 和稳定请求 ID 受理 Profile 连接', async () => {
    const { gateway, coordinator } = fixture()
    expect(await coordinator.connect(session, 'profile-new')).toBe(true)
    expect(gateway.resourceBindingConnection).toHaveBeenCalledExactlyOnceWith(session.id, undefined, expect.any(AbortSignal))
    expect(gateway.connectResourceBinding).toHaveBeenCalledExactlyOnceWith(session.id, {
      kind: 'ssh_session', ssh_profile_id: 'profile-new', expected_revision: session.revision,
      expected_instance_id: 'core-one', client_request_id: 'request-one',
    })
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(true)
  })

  it('从仅 Profile 引用发起连接时按同一 SSH 槽位采用成功结果', async () => {
    const { gateway, coordinator, accept } = fixture()
    const profileSource: AgentSSHProfileResourceBinding = {
      kind: 'ssh_profile', ssh_profile_id: 'profile-old', ssh_profile_name: '旧配置', host_id: 'host-old',
      host_name: '旧主机', platform: 'linux', bound_at: time,
    }
    const profileSession = { ...session, resource_bindings: [profileSource] }
    const profileConnected = {
      ...profileSession,
      revision: profileSession.revision + 1,
      resource_bindings: [resultBinding],
    }
    const succeeded: AgentResourceConnectionView = {
      ...view('succeeded', 2),
      operation: {
        ...view('succeeded', 2).operation!,
        source_binding: profileSource,
        result_session: profileConnected,
      },
    }
    gateway.connectResourceBinding.mockResolvedValueOnce(succeeded)
    coordinator.observe(profileSession, false)

    expect(await coordinator.connect(profileSession, 'profile-new')).toBe(true)
    expect(accept).toHaveBeenCalledExactlyOnceWith(profileConnected)
  })

  it('首次连接状态查询完成前保持发送门禁，查询失败后继续保守对账', async () => {
    const { gateway, coordinator } = fixture()
    const query = deferred<AgentResourceConnectionView>()
    gateway.resourceBindingConnection.mockReturnValueOnce(query.promise)

    const refreshing = coordinator.refresh(session.id)
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(true)
    query.reject(new TypeError('fetch failed'))
    await refreshing

    expect(coordinator.getSnapshot()[session.id]).toMatchObject({
      checking: false,
      uncertain: true,
      error_code: 'AGENT_RESOURCE_CONNECTION_QUERY_FAILED',
    })
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(true)
  })

  it('状态回执声明其他会话时不会写入当前会话', async () => {
    const { gateway, coordinator, accept } = fixture()
    const spoofed = view()
    spoofed.operation!.session_id = 'agent-two'
    gateway.resourceBindingConnection.mockResolvedValueOnce(spoofed)

    await coordinator.refresh(session.id)

    expect(accept).not.toHaveBeenCalled()
    expect(coordinator.getSnapshot()[session.id]?.view).toBeUndefined()
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
  })

  it('成功回执携带其他会话结果时不会采用结果实体', async () => {
    const { gateway, coordinator, accept } = fixture()
    const spoofed = view('succeeded', 2)
    spoofed.operation!.result_session = { ...connected, id: 'agent-two' }
    gateway.resourceBindingConnection.mockResolvedValueOnce(spoofed)

    await coordinator.refresh(session.id)

    expect(accept).not.toHaveBeenCalled()
    expect(coordinator.getSnapshot()[session.id]?.view).toBeUndefined()
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
  })

  it('baseline 查询期间 SSH 槽位变化时不绕过替换确认发起连接', async () => {
    const { gateway, coordinator } = fixture()
    const baseline = deferred<AgentResourceConnectionView>()
    gateway.resourceBindingConnection.mockReturnValueOnce(baseline.promise)

    const connecting = coordinator.connect(session, 'profile-new')
    coordinator.observe({
      ...session,
      revision: session.revision + 1,
      resource_bindings: [{
        ...sourceBinding,
        session_id: 'ssh-third',
        host_id: 'host-third',
        host_name: '第三个主机',
        ssh_profile_id: 'profile-third',
      }],
    }, false)
    baseline.resolve(empty())

    expect(await connecting).toBe(false)
    expect(gateway.connectResourceBinding).not.toHaveBeenCalled()
  })

  it('POST 丢响应时精确找回同一请求，并只在确认受理后返回成功', async () => {
    const { gateway, coordinator } = fixture()
    gateway.connectResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    gateway.resourceBindingConnection.mockResolvedValueOnce(empty()).mockResolvedValueOnce(view())
    expect(await coordinator.connect(session, 'profile-new')).toBe(true)
    expect(gateway.resourceBindingConnection.mock.calls[1]?.[1]).toBe('request-one')
    expect(gateway.connectResourceBinding).toHaveBeenCalledTimes(1)
    expect(coordinator.getSnapshot()[session.id]?.uncertain).toBe(false)
  })

  it('POST 丢响应后直接对账到成功终态时仍只通知一次', async () => {
    const { gateway, coordinator, accept, completed } = fixture()
    gateway.connectResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    gateway.resourceBindingConnection.mockResolvedValueOnce(empty()).mockResolvedValueOnce(view('succeeded', 2))

    expect(await coordinator.connect(session, 'profile-new')).toBe(true)
    expect(accept).toHaveBeenCalledExactlyOnceWith(connected)
    expect(completed).toHaveBeenCalledExactlyOnceWith(connected)

    await coordinator.refresh(session.id)
    expect(completed).toHaveBeenCalledOnce()
  })

  it('旧终态操作不抑制新请求在精确对账成功后的完成通知', async () => {
    const { gateway, coordinator, completed } = fixture()
    const previous = view('failed', 2)
    previous.operation = {
      ...previous.operation!,
      id: 'connection-previous',
      client_request_id: 'request-previous',
    }
    gateway.connectResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    gateway.resourceBindingConnection
      .mockResolvedValueOnce(previous)
      .mockResolvedValueOnce(view('succeeded', 2))

    expect(await coordinator.connect(session, 'profile-new')).toBe(true)
    expect(completed).toHaveBeenCalledExactlyOnceWith(connected)
  })

  it('新请求确定失败后不保留 baseline 的旧目标供重试', async () => {
    const { gateway, coordinator } = fixture()
    const previous = view('failed', 2)
    previous.operation = {
      ...previous.operation!,
      id: 'connection-previous',
      client_request_id: 'request-previous',
      target: {
        ...previous.operation!.target,
        ssh_profile_id: 'profile-previous',
        profile_name: '旧配置',
      },
    }
    gateway.resourceBindingConnection.mockResolvedValueOnce(previous)
    gateway.connectResourceBinding.mockRejectedValueOnce(new TermousApiError(
      '会话版本已变化',
      'AGENT_REVISION_CONFLICT',
      409,
    ))

    expect(await coordinator.connect(session, 'profile-new')).toBe(false)
    expect(coordinator.getSnapshot()[session.id]).toMatchObject({
      view: undefined,
      uncertain: false,
      error_code: 'AGENT_REVISION_CONFLICT',
    })
    expect(await coordinator.retry(session)).toBe(false)
    expect(gateway.connectResourceBinding).toHaveBeenCalledExactlyOnceWith(
      session.id,
      expect.objectContaining({ ssh_profile_id: 'profile-new' }),
    )
  })

  it('精确查询暂未找到操作时，重试复用 pending 请求身份和 Profile', async () => {
    const { gateway, coordinator } = fixture()
    gateway.connectResourceBinding
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(view())
    gateway.resourceBindingConnection.mockResolvedValue(empty())

    expect(await coordinator.connect(session, 'profile-new')).toBe(false)
    expect(coordinator.getSnapshot()[session.id]?.uncertain).toBe(true)
    expect(await coordinator.retry(session)).toBe(true)

    expect(gateway.connectResourceBinding).toHaveBeenCalledTimes(2)
    expect(gateway.connectResourceBinding.mock.calls[1]?.[1]).toEqual(
      gateway.connectResourceBinding.mock.calls[0]?.[1],
    )
  })

  it('重试基线已确认原请求成功时不创建第二个连接操作', async () => {
    const { gateway, coordinator, accept, completed } = fixture()
    gateway.connectResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    gateway.resourceBindingConnection.mockResolvedValue(empty())

    expect(await coordinator.connect(session, 'profile-new')).toBe(false)
    expect(gateway.connectResourceBinding).toHaveBeenCalledOnce()

    gateway.resourceBindingConnection.mockResolvedValueOnce(view('succeeded', 2))
    expect(await coordinator.retry(session)).toBe(true)

    expect(gateway.connectResourceBinding).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledExactlyOnceWith(connected)
    expect(completed).toHaveBeenCalledExactlyOnceWith(connected)
  })

  it.each(['cancelling', 'failed', 'cancelled'] as const)(
    'POST 直接返回 %s 时不报告连接已受理',
    async (status) => {
      const { gateway, coordinator } = fixture()
      gateway.connectResourceBinding.mockResolvedValueOnce(view(status, 2))

      expect(await coordinator.connect(session, 'profile-new')).toBe(false)
      expect(coordinator.getSnapshot()[session.id]).toMatchObject({
        uncertain: false,
        view: { operation: { status } },
      })
    },
  )

  it('Core 实例切换后丢弃旧请求，并使用新实例快照重新受理', async () => {
    const gateway = {
      resourceBindingConnection: vi.fn()
        .mockResolvedValueOnce(empty())
        .mockResolvedValueOnce(empty('core-two')),
      connectResourceBinding: vi.fn()
        .mockResolvedValueOnce(view())
        .mockImplementationOnce((_sessionId, input) => Promise.resolve({
          ...view(),
          instance_id: 'core-two',
          operation: {
            ...view().operation!,
            instance_id: 'core-two',
            client_request_id: input.client_request_id,
          },
        })),
      cancelResourceBindingConnection: vi.fn(),
    }
    const requestID = vi.fn()
      .mockReturnValueOnce('request-one')
      .mockReturnValueOnce('request-two')
    const coordinator = new AgentResourceBindingConnectionCoordinator(gateway, vi.fn(), requestID)
    cleanup.push(() => coordinator.dispose())
    coordinator.observe(session, false)

    expect(await coordinator.connect(session, 'profile-new')).toBe(true)
    expect(await coordinator.connect(session, 'profile-new')).toBe(true)
    expect(gateway.connectResourceBinding).toHaveBeenNthCalledWith(2, session.id, {
      kind: 'ssh_session', ssh_profile_id: 'profile-new', expected_revision: session.revision,
      expected_instance_id: 'core-two', client_request_id: 'request-two',
    })
  })

  it('成功结果在当前源槽位匹配时写回，快照一致前持续阻止发送', async () => {
    const { gateway, coordinator, accept, completed } = fixture()
    gateway.connectResourceBinding.mockResolvedValueOnce(view('succeeded', 2))
    expect(await coordinator.connect(session, 'profile-new')).toBe(true)
    expect(accept).toHaveBeenCalledExactlyOnceWith(connected)
    expect(completed).toHaveBeenCalledExactlyOnceWith(connected)
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(true)
    coordinator.observe(connected, false)
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
  })

  it('异步期间 SSH 槽位已被替换时不采用迟到成功结果', async () => {
    const { gateway, coordinator, accept } = fixture()
    const delayed = deferred<AgentResourceConnectionView>()
    gateway.connectResourceBinding.mockReturnValueOnce(delayed.promise)
    const pending = coordinator.connect(session, 'profile-new')
    await Promise.resolve()
    await Promise.resolve()
    coordinator.observe({
      ...session,
      revision: 8,
      resource_bindings: [{ ...sourceBinding, session_id: 'manual-replacement' }],
    }, false)
    delayed.resolve(view('succeeded', 2))
    await pending
    expect(accept).not.toHaveBeenCalled()
  })

  it('迟到 POST 回执源槽位失配时不报告已受理', async () => {
    const { gateway, coordinator } = fixture()
    const delayed = deferred<AgentResourceConnectionView>()
    gateway.connectResourceBinding.mockReturnValueOnce(delayed.promise)
    const connecting = coordinator.connect(session, 'profile-new')
    await Promise.resolve()
    await Promise.resolve()
    coordinator.observe({
      ...session,
      revision: session.revision + 1,
      resource_bindings: [{ ...sourceBinding, session_id: 'manual-replacement' }],
    }, false)
    delayed.resolve(view())

    expect(await connecting).toBe(false)
    expect(coordinator.getSnapshot()[session.id]).toMatchObject({
      view: undefined,
      uncertain: false,
    })
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
  })

  it('迟到 GET 回执源槽位失配时不依据 request ID 报告已受理', async () => {
    const { gateway, coordinator, accept } = fixture()
    const delayed = deferred<AgentResourceConnectionView>()
    gateway.connectResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    gateway.resourceBindingConnection
      .mockResolvedValueOnce(empty())
      .mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce(view())

    const connecting = coordinator.connect(session, 'profile-new')
    await Promise.resolve()
    await Promise.resolve()
    coordinator.observe({
      ...session,
      revision: session.revision + 1,
      resource_bindings: [{ ...sourceBinding, session_id: 'manual-replacement' }],
    }, false)
    delayed.resolve(view())

    expect(await connecting).toBe(false)
    expect(accept).not.toHaveBeenCalled()
  })

  it('重试使用已观察到的较新会话 revision，不被旧调用参数覆盖', async () => {
    const { gateway, coordinator } = fixture()
    const latest = { ...session, revision: session.revision + 4 }
    coordinator.observe(latest, false)

    expect(await coordinator.connect(session, 'profile-new')).toBe(true)
    expect(gateway.connectResourceBinding).toHaveBeenCalledWith(session.id, expect.objectContaining({
      expected_revision: latest.revision,
    }))
  })

  it('取消失败后仍发起状态对账，避免保留过期的活动门禁', async () => {
    const { gateway, coordinator } = fixture()
    await coordinator.connect(session, 'profile-new')
    gateway.cancelResourceBindingConnection.mockRejectedValueOnce(new TermousApiError(
      '操作不存在', 'NOT_FOUND', 404,
    ))
    gateway.resourceBindingConnection.mockResolvedValueOnce(empty())

    expect(await coordinator.cancel(session.id)).toBe(false)
    expect(gateway.resourceBindingConnection).toHaveBeenCalledWith(session.id, undefined, expect.any(AbortSignal))
    expect(coordinator.getSnapshot()[session.id]?.view).toEqual(empty())
  })

  it('历史成功操作后人工换绑到第三个 SSH 时不再进入对账状态', async () => {
    const { gateway, coordinator, accept } = fixture()
    const manual = {
      ...session,
      revision: 8,
      resource_bindings: [{ ...sourceBinding, session_id: 'ssh-manual' }],
    }
    coordinator.observe(manual, false)
    gateway.resourceBindingConnection.mockResolvedValueOnce(view('succeeded', 2))

    await coordinator.refresh(session.id)

    expect(accept).not.toHaveBeenCalled()
    expect(coordinator.getSnapshot()[session.id]?.reconciling).toBe(false)
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
  })

  it.each(['connecting', 'waiting_host_trust', 'cancelling', 'failed', 'cancelled'] as const)(
    '普通换绑 Profile 后忽略查询到的历史 %s 操作',
    async (status) => {
      const { gateway, coordinator } = fixture()
      coordinator.observe(replaced, false)
      gateway.resourceBindingConnection.mockResolvedValueOnce(view(status, 2))

      await coordinator.refresh(session.id)

      expect(coordinator.getSnapshot()[session.id]).toMatchObject({
        view: undefined,
        uncertain: false,
        reconciling: false,
        error_code: undefined,
      })
      expect(await coordinator.retry(replaced)).toBe(false)
      expect(gateway.connectResourceBinding).not.toHaveBeenCalled()
    },
  )

  it('POST 响应不确定后普通换绑 Profile 时退休旧 pending 且不发起重试', async () => {
    const { gateway, coordinator } = fixture()
    gateway.connectResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    gateway.resourceBindingConnection.mockResolvedValue(empty())

    expect(await coordinator.connect(session, 'profile-new')).toBe(false)
    expect(coordinator.getSnapshot()[session.id]?.uncertain).toBe(true)
    expect(gateway.resourceBindingConnection).toHaveBeenCalledTimes(2)

    coordinator.observe(replaced, false)
    gateway.resourceBindingConnection.mockResolvedValueOnce(view('failed', 2))

    expect(await coordinator.retry(replaced)).toBe(false)
    expect(gateway.resourceBindingConnection).toHaveBeenCalledTimes(2)
    expect(gateway.connectResourceBinding).toHaveBeenCalledOnce()
    expect(coordinator.getSnapshot()[session.id]).toMatchObject({
      view: undefined,
      uncertain: false,
      reconciling: false,
      error_code: undefined,
    })
  })

  it('重试基线查询期间 SSH 槽位变化会立即退休 pending 请求', async () => {
    const { gateway, coordinator } = fixture()
    gateway.connectResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    gateway.resourceBindingConnection.mockResolvedValue(empty())

    expect(await coordinator.connect(session, 'profile-new')).toBe(false)
    const baseline = deferred<AgentResourceConnectionView>()
    gateway.resourceBindingConnection.mockReturnValueOnce(baseline.promise)
    const retrying = coordinator.retry(session)
    coordinator.observe(replaced, false)
    baseline.resolve(empty())

    expect(await retrying).toBe(false)
    expect(coordinator.getSnapshot()[session.id]).toMatchObject({
      view: undefined,
      uncertain: false,
      reconciling: false,
      error_code: 'AGENT_REVISION_CONFLICT',
    })
    expect(await coordinator.retry(replaced)).toBe(false)
    expect(gateway.connectResourceBinding).toHaveBeenCalledOnce()
  })

  it.each(['failed', 'cancelled'] as const)(
    '历史 %s 操作展示后普通换绑 Profile 时禁止按旧目标重试',
    async (status) => {
      const { gateway, coordinator } = fixture()
      gateway.resourceBindingConnection.mockResolvedValueOnce(view(status, 2))
      await coordinator.refresh(session.id)
      expect(coordinator.getSnapshot()[session.id]?.view?.operation?.status).toBe(status)

      coordinator.observe(replaced, false)

      expect(await coordinator.retry(replaced)).toBe(false)
      expect(coordinator.getSnapshot()[session.id]?.view).toBeUndefined()
      expect(gateway.connectResourceBinding).not.toHaveBeenCalled()
    },
  )

  it('成功后以更高 revision 换绑并回到相同源槽位时不复活旧结果', async () => {
    const { gateway, coordinator, accept } = fixture()
    gateway.connectResourceBinding.mockResolvedValueOnce(view('succeeded', 2))
    expect(await coordinator.connect(session, 'profile-new')).toBe(true)
    expect(accept).toHaveBeenCalledOnce()

    coordinator.observe({
      ...session,
      revision: connected.revision + 2,
      resource_bindings: [sourceBinding],
    }, false)
    gateway.resourceBindingConnection.mockResolvedValueOnce(view('succeeded', 3))
    await coordinator.refresh(session.id)

    expect(accept).toHaveBeenCalledOnce()
    expect(coordinator.getSnapshot()[session.id]?.reconciling).toBe(false)
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
  })

  it('新协调器首次观察高 revision 源槽位时不采用历史成功结果', async () => {
    const { gateway, coordinator, accept } = fixture()
    coordinator.observe({
      ...session,
      revision: connected.revision + 2,
      resource_bindings: [sourceBinding],
    }, false)
    gateway.resourceBindingConnection.mockResolvedValueOnce(view('succeeded', 2))

    await coordinator.refresh(session.id)

    expect(accept).not.toHaveBeenCalled()
    expect(coordinator.getSnapshot()[session.id]?.reconciling).toBe(false)
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
  })

  it('取消仅使用当前活动操作 ID，终态释放发送门禁', async () => {
    const { gateway, coordinator } = fixture()
    await coordinator.connect(session, 'profile-new')
    expect(await coordinator.cancel(session.id)).toBe(true)
    expect(gateway.cancelResourceBindingConnection).toHaveBeenCalledExactlyOnceWith(session.id, 'connection-one')
    expect(isAgentResourceBindingConnectionBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAgentResourceRecoveryBlocking, type AgentResourceRecoveryView, type AgentSession, type AgentSSHResourceBinding } from '#entities/agent'
import { agentSessionFixture } from '../model/agentRuntimeTestFixtures.ts'
import { AgentResourceRecoveryCoordinator } from './AgentResourceRecoveryCoordinator.ts'
import { TermousApiError } from '#shared/api'
import { AgentRuntimeProtocolError } from '../model/agentRuntimeProtocol.ts'

const binding: AgentSSHResourceBinding = {
  kind: 'ssh_session', session_id: 'ssh-old', host_id: 'host', host_name: '主机', ssh_profile_id: 'profile',
  platform: 'linux', bound_at: '2026-09-10T00:00:00Z',
}
const session = agentSessionFixture({ id: 'agent-one', resource_bindings: [binding] })
const recovered = { ...session, revision: session.revision + 1, resource_bindings: [{ ...binding, session_id: 'ssh-new' }] }
const ready = (): AgentResourceRecoveryView => ({ instance_id: 'core-one', kind: 'ssh_session', can_recover: true, operation: null })
function operation(status: NonNullable<AgentResourceRecoveryView['operation']>['status'] = 'connecting', revision = 1): AgentResourceRecoveryView {
  return { ...ready(), can_recover: false, blocked_reason: status === 'succeeded' ? 'ready' : 'recovering', operation: {
    id: 'recovery-one', instance_id: 'core-one', session_id: session.id, kind: 'ssh_session', client_request_id: 'request-one',
    revision, status, source_binding: binding, retryable: true, created_at: binding.bound_at, updated_at: binding.bound_at,
    ...(status === 'succeeded' ? { result_session: recovered } : {}),
  } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
const cleanup: Array<() => void> = []
afterEach(() => { for (const close of cleanup.splice(0)) close(); vi.useRealTimers() })
function fixture() {
  const gateway = {
    resourceBindingRecovery: vi.fn().mockResolvedValue(ready()),
    recoverResourceBinding: vi.fn().mockResolvedValue(operation()),
    cancelResourceBindingRecovery: vi.fn().mockResolvedValue(operation('cancelled', 3)),
  }
  const accept = vi.fn<(session: AgentSession) => void>()
  const completed = vi.fn<(session: AgentSession) => void>()
  const requestID = vi.fn().mockReturnValueOnce('request-one').mockReturnValue('request-two')
  const coordinator = new AgentResourceRecoveryCoordinator(gateway, accept, requestID, completed)
  coordinator.observe(session, false)
  cleanup.push(() => coordinator.dispose())
  return { gateway, accept, completed, requestID, coordinator }
}
async function settle() { for (let index = 0; index < 12; index++) await Promise.resolve() }

describe('AgentResourceRecoveryCoordinator', () => {
  it('进行中的恢复完成仅提示一次，重复查询及更高终态 revision 不重放提示', async () => {
    const { gateway, coordinator, completed } = fixture()
    await coordinator.recover(session)
    gateway.resourceBindingRecovery.mockResolvedValue(operation('succeeded', 3))
    await coordinator.refresh(session.id)
    await coordinator.refresh(session.id)
    gateway.resourceBindingRecovery.mockResolvedValue(operation('succeeded', 4))
    await coordinator.refresh(session.id)
    expect(completed).toHaveBeenCalledExactlyOnceWith(recovered)
  })

  it('首次读取历史成功记录只对账，不触发完成提示', async () => {
    const { gateway, coordinator, accept, completed } = fixture()
    gateway.resourceBindingRecovery.mockResolvedValue(operation('succeeded', 3))
    await coordinator.refresh(session.id)
    coordinator.observe(recovered, true)
    await settle()
    expect(accept).toHaveBeenCalledExactlyOnceWith(recovered)
    expect(completed).not.toHaveBeenCalled()
  })

  it.each([false, true])('直接完成或 POST 丢失后找回成功时仍提示一次，丢响应=%s', async (lost) => {
    const { gateway, coordinator, completed } = fixture()
    gateway.resourceBindingRecovery.mockResolvedValueOnce(ready()).mockResolvedValue(operation('succeeded', 3))
    if (lost) gateway.recoverResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    else gateway.recoverResourceBinding.mockResolvedValueOnce(operation('succeeded', 3))
    await coordinator.recover(session)
    await settle()
    await coordinator.refresh(session.id)
    expect(completed).toHaveBeenCalledExactlyOnceWith(recovered)
  })

  it('取消时服务端已失败，终态回执后重新查询能力并允许新请求', async () => {
    const { gateway, coordinator } = fixture()
    await coordinator.recover(session)
    const failed = { ...operation('failed', 3), blocked_reason: undefined }
    gateway.cancelResourceBindingRecovery.mockResolvedValue(failed)
    gateway.resourceBindingRecovery.mockResolvedValue({ ...failed, can_recover: true })
    await coordinator.cancel(session.id)
    await settle()
    expect(coordinator.getSnapshot()[session.id]?.view).toMatchObject({ can_recover: true, operation: { status: 'failed' } })
    await coordinator.recover(session)
    expect(gateway.recoverResourceBinding.mock.calls[1]?.[1].client_request_id).toBe('request-two')
  })

  it('同请求幂等 POST 返回失败终态后，刷新能力而不永久禁用重试', async () => {
    const { gateway, coordinator, requestID } = fixture()
    gateway.recoverResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    await coordinator.recover(session)
    await settle()
    const failed = { ...operation('failed', 3), blocked_reason: undefined }
    gateway.recoverResourceBinding.mockResolvedValueOnce(failed)
    gateway.resourceBindingRecovery.mockResolvedValueOnce(ready()).mockResolvedValue({ ...failed, can_recover: true })
    await coordinator.recover(session)
    await settle()
    expect(gateway.recoverResourceBinding.mock.calls[1]?.[1].client_request_id).toBe('request-one')
    expect(requestID).toHaveBeenCalledTimes(1)
    expect(coordinator.getSnapshot()[session.id]?.view?.can_recover).toBe(true)
    expect(isAgentResourceRecoveryBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
  })

  it('终态后的能力查询失败时，用户重试先查询新能力再创建操作', async () => {
    const { gateway, coordinator } = fixture()
    await coordinator.recover(session)
    const cancelled = { ...operation('cancelled', 3), blocked_reason: undefined }
    gateway.cancelResourceBindingRecovery.mockResolvedValue(cancelled)
    gateway.resourceBindingRecovery.mockRejectedValueOnce(new TypeError('query failed'))
    await coordinator.cancel(session.id)
    await settle()
    expect(coordinator.getSnapshot()[session.id]?.view?.can_recover).toBe(false)
    expect(coordinator.getSnapshot()[session.id]?.error_code).toBe('AGENT_RESOURCE_RECOVERY_QUERY_FAILED')
    gateway.resourceBindingRecovery.mockResolvedValue({ ...cancelled, can_recover: true })
    expect(await coordinator.recover(session)).toBe(true)
    expect(gateway.recoverResourceBinding).toHaveBeenCalledTimes(2)
    const queries = gateway.resourceBindingRecovery.mock.invocationCallOrder
    const requests = gateway.recoverResourceBinding.mock.invocationCallOrder
    expect(queries[queries.length - 1]).toBeLessThan(requests[requests.length - 1]!)
  })

  it.each(['尚无操作', '旧操作终态'])('POST 丢响应且仅有%s时解绑，查询失败仍保持确认直至清理终态', async (previous) => {
    vi.useFakeTimers()
    const { gateway, coordinator, accept } = fixture()
    const initial = ready()
    if (previous === '旧操作终态') initial.operation = {
      ...operation('failed', 3).operation!, id: 'previous-operation', client_request_id: 'previous-request',
    }
    gateway.resourceBindingRecovery.mockResolvedValue(initial)
    gateway.recoverResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    await coordinator.recover(session)
    await settle()
    expect(coordinator.getSnapshot()[session.id]?.uncertain).toBe(true)
    gateway.resourceBindingRecovery.mockRejectedValueOnce(new TypeError('query failed'))
    coordinator.observe({ ...session, revision: 3, resource_bindings: [] }, true)
    expect(isAgentResourceRecoveryBlocking(coordinator.getSnapshot()[session.id])).toBe(true)
    await settle()
    expect(coordinator.getSnapshot()[session.id]?.uncertain).toBe(true)
    expect(isAgentResourceRecoveryBlocking(coordinator.getSnapshot()[session.id])).toBe(true)
    gateway.resourceBindingRecovery.mockResolvedValue({ ...operation('cancelling', 2), blocked_reason: 'no_binding' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(coordinator.getSnapshot()[session.id]?.view?.operation?.status).toBe('cancelling')
    expect(coordinator.getSnapshot()[session.id]?.uncertain).toBe(false)
    expect(isAgentResourceRecoveryBlocking(coordinator.getSnapshot()[session.id])).toBe(true)
    gateway.resourceBindingRecovery.mockResolvedValue({ ...operation('cancelled', 3), blocked_reason: 'no_binding' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(isAgentResourceRecoveryBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
    const calls = gateway.resourceBindingRecovery.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(gateway.resourceBindingRecovery).toHaveBeenCalledTimes(calls)
    expect(gateway.recoverResourceBinding).toHaveBeenCalledTimes(1)
    expect(accept).not.toHaveBeenCalled()
  })

  it('恢复中解除 SSH 引用后继续对账到取消终态，保留文件引用并释放发送门禁', async () => {
    vi.useFakeTimers()
    const { gateway, coordinator, accept } = fixture()
    await coordinator.recover(session)
    gateway.resourceBindingRecovery.mockResolvedValue(operation())
    const fileSession: AgentSession = { ...session, revision: 3, resource_bindings: [{
      kind: 'file_profile', file_access_profile_id: 'file-profile', file_access_profile_name: '文件配置',
      host_id: binding.host_id, host_name: binding.host_name, ssh_profile_id: binding.ssh_profile_id, engine: 'sftp', bound_at: binding.bound_at,
    }] }
    coordinator.observe(fileSession, true)
    await settle()
    expect(isAgentResourceRecoveryBlocking(coordinator.getSnapshot()[session.id])).toBe(true)
    gateway.resourceBindingRecovery.mockResolvedValue({ ...operation('cancelled', 3), blocked_reason: 'no_binding' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(coordinator.getSnapshot()[session.id]?.view?.operation?.status).toBe('cancelled')
    expect(isAgentResourceRecoveryBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
    const calls = gateway.resourceBindingRecovery.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(gateway.resourceBindingRecovery).toHaveBeenCalledTimes(calls)
    expect(fileSession.resource_bindings?.[0]?.kind).toBe('file_profile')
    expect(accept).not.toHaveBeenCalled()
  })
  it('并行请求冲突后找回进行中的操作，成功提示不保留旧冲突错误', async () => {
    const { gateway, coordinator } = fixture()
    gateway.recoverResourceBinding.mockRejectedValueOnce(new TermousApiError('已在恢复', 'AGENT_RESOURCE_RECOVERY_CONFLICT', 409))
    gateway.resourceBindingRecovery.mockResolvedValueOnce(ready()).mockResolvedValueOnce(operation())
    await coordinator.recover(session)
    await settle()
    expect(coordinator.getSnapshot()[session.id]?.error_code).toBeUndefined()
    gateway.resourceBindingRecovery.mockResolvedValue(operation('succeeded', 3))
    await coordinator.refresh(session.id)
    expect(coordinator.getSnapshot()[session.id]?.error_code).toBeUndefined()
    expect(isAgentResourceRecoveryBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
  })
  it.each(['VALIDATION_ERROR', 'SSH_ACCESS_PROFILE_NOT_FOUND'])('明确 4xx 业务拒绝 %s 后允许使用新请求重试', async (code) => {
    const { gateway, coordinator, requestID } = fixture()
    gateway.recoverResourceBinding.mockRejectedValueOnce(new TermousApiError('配置不可用', code, 404))
    await coordinator.recover(session)
    await settle()
    expect(coordinator.getSnapshot()[session.id]?.uncertain).toBe(false)
    await coordinator.recover(session)
    expect(gateway.recoverResourceBinding.mock.calls[1]?.[1].client_request_id).toBe('request-two')
    expect(requestID).toHaveBeenCalledTimes(2)
  })

  it.each([new TermousApiError('响应失败', 'AGENT_STORAGE_ERROR', 500), new AgentRuntimeProtocolError('响应无效')])('5xx 或响应解码失败仍保留原请求身份', async (error) => {
    const { gateway, coordinator, requestID } = fixture()
    gateway.recoverResourceBinding.mockRejectedValueOnce(error)
    await coordinator.recover(session)
    await settle()
    expect(coordinator.getSnapshot()[session.id]?.uncertain).toBe(true)
    await coordinator.recover(session)
    expect(gateway.recoverResourceBinding.mock.calls[1]?.[1].client_request_id).toBe('request-one')
    expect(requestID).toHaveBeenCalledTimes(1)
  })

  it('恢复只发送引用种类、版本和请求 ID，并以操作状态封锁发送', async () => {
    const { gateway, coordinator } = fixture()
    expect(await coordinator.recover(session)).toBe(true)
    expect(gateway.recoverResourceBinding).toHaveBeenCalledExactlyOnceWith(session.id, {
      kind: 'ssh_session', expected_revision: session.revision, client_request_id: 'request-one',
    })
    expect(isAgentResourceRecoveryBlocking(coordinator.getSnapshot()[session.id])).toBe(true)
  })

  it('响应丢失后按会话找回已受理操作，不重复 POST', async () => {
    const { gateway, coordinator } = fixture()
    gateway.recoverResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    gateway.resourceBindingRecovery.mockResolvedValueOnce(ready()).mockResolvedValue(operation())
    expect(await coordinator.recover(session)).toBe(false)
    await settle()
    expect(coordinator.getSnapshot()[session.id]?.view?.operation?.id).toBe('recovery-one')
    expect(coordinator.getSnapshot()[session.id]?.uncertain).toBe(false)
    expect(await coordinator.recover(session)).toBe(true)
    expect(gateway.recoverResourceBinding).toHaveBeenCalledTimes(1)
  })

  it('暂未查询到操作时保留请求 ID，显式重试沿用同一请求', async () => {
    const { gateway, coordinator, requestID } = fixture()
    gateway.recoverResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    await coordinator.recover(session)
    await settle()
    expect(coordinator.getSnapshot()[session.id]?.uncertain).toBe(true)
    expect(await coordinator.recover(session)).toBe(true)
    expect(gateway.recoverResourceBinding.mock.calls[1]?.[1]).toEqual(gateway.recoverResourceBinding.mock.calls[0]?.[1])
    expect(requestID).toHaveBeenCalledTimes(1)
  })

  it('Core 更换实例后清理不确定操作，下一次点击使用新请求 ID', async () => {
    const { gateway, coordinator } = fixture()
    gateway.recoverResourceBinding.mockRejectedValueOnce(new TypeError('fetch failed'))
    await coordinator.recover(session)
    await settle()
    gateway.resourceBindingRecovery.mockResolvedValue({ ...ready(), instance_id: 'core-two' })
    await coordinator.refresh(session.id)
    expect(isAgentResourceRecoveryBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
    const next = operation()
    next.instance_id = 'core-two'
    next.operation = { ...next.operation!, instance_id: 'core-two', client_request_id: 'request-two' }
    gateway.recoverResourceBinding.mockResolvedValue(next)
    await coordinator.recover(session)
    expect(gateway.recoverResourceBinding.mock.calls[1]?.[1].client_request_id).toBe('request-two')
  })

  it('同操作较旧 revision 不能覆盖已完成状态，成功会话只接收一次', async () => {
    const { gateway, coordinator, accept } = fixture()
    gateway.resourceBindingRecovery.mockResolvedValueOnce(operation('succeeded', 3)).mockResolvedValueOnce(operation('connecting', 2)).mockResolvedValue(operation('succeeded', 3))
    await coordinator.refresh(session.id)
    await coordinator.refresh(session.id)
    await coordinator.refresh(session.id)
    expect(coordinator.getSnapshot()[session.id]?.view?.operation?.status).toBe('succeeded')
    expect(accept).toHaveBeenCalledExactlyOnceWith(recovered)
  })

  it('后来换绑或归档后，不采用旧恢复操作的成功会话', async () => {
    const { gateway, coordinator, accept } = fixture()
    const delayed = deferred<AgentResourceRecoveryView>()
    gateway.recoverResourceBinding.mockReturnValueOnce(delayed.promise)
    const pending = coordinator.recover(session)
    await settle()
    coordinator.observe({ ...session, revision: 8, resource_bindings: [{ ...binding, session_id: 'manual-replacement' }] }, false)
    delayed.resolve(operation('succeeded', 3))
    await pending
    expect(accept).not.toHaveBeenCalled()
  })

  it('后台完成更新原目标，切换会话不会将结果投影到另一个会话', async () => {
    const { gateway, coordinator, accept } = fixture()
    const delayed = deferred<AgentResourceRecoveryView>()
    gateway.recoverResourceBinding.mockReturnValueOnce(delayed.promise)
    const pending = coordinator.recover(session)
    await settle()
    coordinator.observe({ ...session, id: 'agent-two' }, false)
    delayed.resolve(operation('succeeded', 3))
    await pending
    expect(accept).toHaveBeenCalledExactlyOnceWith(recovered)
    expect(coordinator.getSnapshot()['agent-two']).toBeUndefined()
  })

  it('隐藏页面停止轮询，重新激活查询并追踪等待主机信任', async () => {
    vi.useFakeTimers()
    const { gateway, coordinator } = fixture()
    gateway.resourceBindingRecovery.mockResolvedValue(operation('waiting_host_trust', 2))
    coordinator.observe(session, true)
    await settle()
    await vi.advanceTimersByTimeAsync(1000)
    expect(gateway.resourceBindingRecovery).toHaveBeenCalledTimes(2)
    coordinator.observe(session, false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(gateway.resourceBindingRecovery).toHaveBeenCalledTimes(2)
    coordinator.observe(session, true)
    await settle()
    expect(gateway.resourceBindingRecovery).toHaveBeenCalledTimes(3)
    expect(coordinator.getSnapshot()[session.id]?.view?.operation?.status).toBe('waiting_host_trust')
  })

  it('查询忽略 AbortSignal 时，迟到结果仍不能覆盖新实例', async () => {
    const { gateway, coordinator } = fixture()
    const old = deferred<AgentResourceRecoveryView>()
    gateway.resourceBindingRecovery.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...ready(), instance_id: 'core-two' })
    const first = coordinator.refresh(session.id)
    await coordinator.refresh(session.id)
    old.resolve(operation())
    await first
    expect(coordinator.getSnapshot()[session.id]?.view?.instance_id).toBe('core-two')
  })

  it('重复点击只受理一次，取消使用同一操作 ID', async () => {
    const { gateway, coordinator } = fixture()
    const delayed = deferred<AgentResourceRecoveryView>()
    gateway.recoverResourceBinding.mockReturnValueOnce(delayed.promise)
    const pending = coordinator.recover(session)
    expect(await coordinator.recover(session)).toBe(false)
    await settle()
    delayed.resolve(operation())
    await pending
    expect(await coordinator.cancel(session.id)).toBe(true)
    expect(gateway.cancelResourceBindingRecovery).toHaveBeenCalledExactlyOnceWith(session.id, 'recovery-one')
    expect(isAgentResourceRecoveryBlocking(coordinator.getSnapshot()[session.id])).toBe(false)
  })
})

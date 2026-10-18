import { afterEach, expect, test, vi } from 'vitest'
import { AgentQuery_Kind as Q, AgentGroupCommand_Action as G } from '@termous/remote-protocol/agent'
import type { RemoteConnection, RemoteWindowBridge } from '#common/contracts'
import { RemoteClient, RemoteError, retryRemoteRead } from '#entities/remote-control'
import { RemoteAgentTransport } from './agentTransport'

afterEach(() => vi.useRealTimers())

function fixture() {
  const request = vi.fn<RemoteWindowBridge['request']>(async () => ({ ok: true, value: { agent: { type: 'workspace', instanceId: 'instance', json: btoa('{}') } } }))
  const client = new RemoteClient({ request } as unknown as RemoteWindowBridge, { id: 'connection' } as RemoteConnection)
  return { request, transport: new RemoteAgentTransport(client) }
}

test('短暂读取失败在同一订阅内补读，不立即上报页面错误', async () => {
  vi.useFakeTimers()
  const { request, transport } = fixture()
  request.mockResolvedValueOnce({ ok: false, code: 'remote_capacity_exceeded' })
  const result = transport.query('workspace', Q.WORKSPACE)
  await vi.advanceTimersByTimeAsync(400)
  await expect(result).resolves.toEqual({})
  expect(request).toHaveBeenCalledTimes(2)
})

test('持续读取失败只有两次补读，权限及协议错误不重试', async () => {
  vi.useFakeTimers()
  const { request, transport } = fixture()
  request.mockResolvedValue({ ok: false, code: 'remote_recovering' })
  const result = transport.query('workspace', Q.WORKSPACE).catch(error => error)
  await vi.advanceTimersByTimeAsync(2000)
  expect(await result).toMatchObject({ code: 'remote_recovering' })
  expect(request).toHaveBeenCalledTimes(3)
  for (const code of ['remote_agent_disabled', 'remote_invalid', 'remote_agent_restarted']) {
    request.mockClear().mockResolvedValue({ ok: false, code })
    await expect(transport.query('workspace', Q.WORKSPACE)).rejects.toMatchObject({ code })
    expect(request).toHaveBeenCalledTimes(1)
  }
})

test('离页取消补读，已经耗尽等待预算的读取不再延长', async () => {
  vi.useFakeTimers()
  const { request, transport } = fixture()
  request.mockResolvedValue({ ok: false, code: 'remote_request_timeout' })
  const abort = new AbortController()
  const result = transport.query('workspace', Q.WORKSPACE, {}, abort.signal).catch(error => error)
  await vi.advanceTimersByTimeAsync(10)
  abort.abort()
  expect(await result).toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(2000)
  expect(request).toHaveBeenCalledTimes(1)
  const slow = vi.fn(async () => { vi.setSystemTime(Date.now() + 6000); throw new RemoteError('remote_request_timeout') })
  await expect(retryRemoteRead(slow)).rejects.toMatchObject({ code: 'remote_request_timeout' })
  expect(slow).toHaveBeenCalledTimes(1)
})

test('写入冲突适配已有 AI 合同，不自动重放写操作', async () => {
  const { request, transport } = fixture()
  request.mockResolvedValue({ ok: false, code: 'agent_revision_conflict' })
  await expect(transport.write('group', { case: 'group', value: { action: G.CREATE, name: 'test' } })).rejects.toMatchObject({ code: 'AGENT_REVISION_CONFLICT', uncertain: false })
  expect(request).toHaveBeenCalledTimes(1)
})

test.each(['remote_capacity_exceeded', 'remote_agent_restarted', 'remote_operation_unavailable'])('写结果未知时，对账失败仍保留原操作的不确定性：%s', async code => {
  vi.useFakeTimers()
  const { request, transport } = fixture()
  request.mockResolvedValueOnce({ ok: false, code: 'remote_request_timeout', uncertain: true })
    .mockResolvedValue({ ok: false, code })
  const result = transport.write('group', { case: 'group', value: { action: G.CREATE, name: 'test' } }).catch(error => error)
  await vi.advanceTimersByTimeAsync(3000)
  expect(await result).toMatchObject({ code: 'remote_request_timeout', uncertain: true })
  expect(request.mock.calls.filter(([input]) => JSON.stringify(input).includes('"group"'))).toHaveLength(1)
})

test('对账返回确定的业务冲突时如实反馈，不保留未知状态', async () => {
  vi.useFakeTimers()
  const { request, transport } = fixture()
  request.mockResolvedValueOnce({ ok: false, code: 'remote_request_timeout', uncertain: true })
    .mockResolvedValue({ ok: false, code: 'agent_revision_conflict' })
  const result = transport.write('group', { case: 'group', value: { action: G.CREATE, name: 'test' } }).catch(error => error)
  await vi.advanceTimersByTimeAsync(1000)
  expect(await result).toMatchObject({ code: 'AGENT_REVISION_CONFLICT', uncertain: false })
  expect(request).toHaveBeenCalledTimes(2)
})

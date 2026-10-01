import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudAuthorization } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { changeLanguage } from '#shared/i18n'
import { AccountAuthorization } from './AccountAuthorization'

beforeAll(async () => { await changeLanguage('zh-CN') })
const initial: CloudAuthorization = {
  id: 'authorization_fixture', workspace_id: 'workspace', device_id: 'target', kind: 'approval', name: 'New device',
  status: 'verifying', revision: '3', expires_at: new Date(Date.now() + 300_000).toISOString(), created_at: new Date().toISOString(),
  source_summary: '127.0.0.0/24', platform: 'Windows', target_confirmed: false, keys_verified: false,
  fingerprint: '1234 5678 9ABC DEF0 1234 5678 9ABC DEF0', allowed_actions: ['confirm'],
}
function setup(value = initial, read?: CloudGateway['authorization']) {
  const state = new CloudState()
  state.accept({ generation: 'fixture', revision: 1, configured: true, authenticated: true, phase: 'ready', auto_sync: false, confirmed: false, pending: 0, conflicts: 0 })
  const api = {
    getStatus: state.snapshot, subscribeStatus: state.subscribe, subscribeChanges: state.subscribeChanges,
    authorization: vi.fn<CloudGateway['authorization']>(read ?? (async () => value)), authorizationAction: vi.fn(async () => value),
  }
  const run = async <T,>(action: () => Promise<T>) => { try { return await action() } catch { return undefined } }
  render(<AccountAuthorization api={api as unknown as CloudGateway} generation="fixture" value={value} mfaEnabled busy={false} run={run} onClose={vi.fn()} onChanged={vi.fn()} />)
  return { ...api, publish: () => state.acceptEvent({ type: 'account', status: state.snapshot()!, changes: ['authorizations'], operations: [value.id] }) }
}

test('两端核对必须明确勾选，提交绑定当前完整指纹', async () => {
  const api = setup()
  const confirm = screen.getByRole('button', { name: '确认指纹' })
  expect(confirm).toBeDisabled()
  expect(api.authorizationAction).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(confirm)
  await waitFor(() => expect(api.authorizationAction).toHaveBeenCalledWith('fixture', 'approval', initial.id, 'confirm', expect.objectContaining({ expected_revision: '3', fingerprint: initial.fingerprint })))
})

test('验证响应失败后清空密码和验证码，不自动重放一次性证明', async () => {
  const api = setup({ ...initial, target_confirmed: true, allowed_actions: ['verify'] })
  api.authorizationAction.mockRejectedValueOnce(new Error('response_incomplete'))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '验证本次操作' }))
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '验证本次操作' }))
  await waitFor(() => expect(api.authorizationAction).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByLabelText('密码')).toHaveValue(''))
  expect(screen.getByLabelText('验证器验证码')).toHaveValue('')
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(api.authorizationAction).toHaveBeenCalledTimes(1)
})

test('托管恢复结果必须先接受信任边界，才会自动领取', async () => {
  const api = setup({ ...initial, kind: 'recovery', status: 'approved', fingerprint: undefined, allowed_actions: ['claim'] })
  expect(api.authorizationAction).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '验证并领取授权' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(api.authorizationAction).toHaveBeenCalledWith('fixture', 'recovery', initial.id, 'claim', expect.objectContaining({ confirm_trust: true })))
  expect(api.authorizationAction).toHaveBeenCalledTimes(1)
})

test('授权过期时移除身份草稿且不提交证明', () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  try {
    const api = setup({ ...initial, expires_at: new Date(Date.now() + 1000).toISOString(), allowed_actions: ['verify'] })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '验证本次操作' }))
    expect(screen.getByLabelText('密码')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
    fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('验证器验证码')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '验证本次操作' })).toBeDisabled()
    expect(api.authorizationAction).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

test.each(['invalidated', 'rejected', 'cancelled'] as const)('申请变为 %s 后立即清理身份草稿，不提交旧证明', async (status) => {
  const api = setup({ ...initial, allowed_actions: ['verify'] })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '验证本次操作' }))
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  api.authorization.mockResolvedValue({ ...initial, revision: '4', status, allowed_actions: [] })
  await act(async () => { api.publish() })
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('验证器验证码')).not.toBeInTheDocument()
  expect(api.authorizationAction).not.toHaveBeenCalled()
})

test('等待授权不进行固定网络轮询，长连接失效提示立即更新详情', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  try {
    const api = setup()
    await act(async () => { await Promise.resolve() })
    expect(api.authorization).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(api.authorization).toHaveBeenCalledTimes(1)
    api.authorization.mockResolvedValue({ ...initial, revision: '4', name: '实时更新的审批设备' })
    await act(async () => { api.publish() })
    expect(screen.getByText('实时更新的审批设备')).toBeInTheDocument()
    expect(api.authorization).toHaveBeenCalledTimes(2)
    expect(api.authorizationAction).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})

test('详情读取期间连续提示不会丢弃当前状态，随后一次补读继续更新', async () => {
  let firstResolve!: (value: CloudAuthorization) => void, latestResolve!: (value: CloudAuthorization) => void
  const first = new Promise<CloudAuthorization>(resolve => { firstResolve = resolve })
  const latest = new Promise<CloudAuthorization>(resolve => { latestResolve = resolve })
  const read = vi.fn<CloudGateway['authorization']>().mockImplementationOnce(() => first).mockImplementationOnce(() => latest)
  const api = setup(initial, read)
  expect(api.authorization).toHaveBeenCalledTimes(1)
  await act(async () => { for (let i = 0; i < 20; i++) api.publish() })
  expect(api.authorization).toHaveBeenCalledTimes(1)
  await act(async () => { firstResolve({ ...initial, name: '第一份已确认详情' }) })
  expect(screen.getByText('第一份已确认详情')).toBeInTheDocument()
  expect(api.authorization).toHaveBeenCalledTimes(2)
  await act(async () => { latestResolve({ ...initial, revision: '4', name: '补读后的最新详情' }) })
  expect(screen.getByText('补读后的最新详情')).toBeInTheDocument()
  expect(api.authorization).toHaveBeenCalledTimes(2)
  expect(api.authorizationAction).not.toHaveBeenCalled()
})

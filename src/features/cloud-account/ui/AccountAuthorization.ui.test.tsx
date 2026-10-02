import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudAuthorization } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { changeLanguage } from '#shared/i18n'
import { AccountAuthorization } from './AccountAuthorization'

beforeAll(async () => { await changeLanguage('zh-CN') })
const initial: CloudAuthorization = {
  id: 'authorization_fixture', workspace_id: 'workspace', device_id: 'target', kind: 'approval', name: 'New device',
  status: 'pending', revision: '3', expires_at: new Date(Date.now() + 300_000).toISOString(), created_at: new Date().toISOString(),
  source_summary: '127.0.0.0/24', platform: 'Windows', target_confirmed: false, keys_verified: false,
  pairing_code: 'ABCD 2345 6789 EF01 ABCD 2345 6789 EF01',
  fingerprint: '1234 5678 9ABC DEF0 1234 5678 9ABC DEF0', allowed_actions: ['approve'],
}
function setup(value = initial, read?: CloudGateway['authorization'], mfaEnabled = true, errorCode?: string, deviceId = 'trusted-device') {
  const state = new CloudState()
  state.accept({ generation: 'fixture', revision: 1, device_id: deviceId, configured: true, authenticated: true, phase: errorCode ? 'blocked' : 'ready', error_code: errorCode, auto_sync: false, confirmed: false, pending: 0, conflicts: 0 })
  const api = {
    getStatus: state.snapshot, subscribeStatus: state.subscribe, subscribeChanges: state.subscribeChanges,
    authorization: vi.fn<CloudGateway['authorization']>(read ?? (async () => value)), authorizationAction: vi.fn(async () => value),
  }
  const run = async <T,>(action: () => Promise<T>) => { try { return await action() } catch { return undefined } }
  const view = render(<AccountAuthorization api={api as unknown as CloudGateway} generation="fixture" value={value} mfaEnabled={mfaEnabled} busy={false} run={run} onClose={vi.fn()} onChanged={vi.fn()} />)
  return { ...api, unmount: view.unmount, publish: () => state.acceptEvent({ type: 'account', status: state.snapshot()!, changes: ['authorizations'], operations: [value.id] }) }
}

test('审批只提交一次第二因子证明，不要求密码或双方额外确认', async () => {
  const api = setup()
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(api.authorizationAction).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '确认授权' }))
  await waitFor(() => expect(api.authorizationAction).toHaveBeenCalledExactlyOnceWith('fixture', 'approval', initial.id, 'approve', { expected_revision: '3', confirm_trust: false, method: 'totp', code: '123456' }))
})

test('未开启2FA时审批只验证密码', async () => {
  const api = setup(initial, undefined, false)
  expect(screen.queryByLabelText('验证器验证码')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByRole('button', { name: '确认授权' }))
  await waitFor(() => expect(api.authorizationAction).toHaveBeenCalledExactlyOnceWith('fixture', 'approval', initial.id, 'approve', { expected_revision: '3', confirm_trust: false, password: 'synthetic-password' }))
})

test('验证响应失败后清空密码和验证码，不自动重放一次性证明', async () => {
  const api = setup()
  api.authorizationAction.mockRejectedValueOnce(new Error('response_incomplete'))
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '确认授权' }))
  await waitFor(() => expect(api.authorizationAction).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByLabelText('验证器验证码')).toHaveValue(''))
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(api.authorizationAction).toHaveBeenCalledTimes(1)
})

test.each(['mfa_invalid_code', 'mfa_code_reused'])('审批失败就地展示 %s 的具体原因，不重复提交证明', async code => {
  const api = setup()
  api.authorizationAction.mockRejectedValueOnce(new Error(code))
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '确认授权' }))
  expect(await screen.findByText(`错误代码：${code}`)).toBeInTheDocument()
  expect(screen.getByText(code === 'mfa_code_reused' ? '此验证码已使用，请等待验证器生成下一枚验证码。' : '验证码或备用码不正确，请检查后重试。')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByLabelText('验证器验证码')).toHaveValue(''))
  expect(api.authorizationAction).toHaveBeenCalledOnce()
})

test('审批异常正文不会作为错误码或敏感内容回显', async () => {
  const api = setup()
  api.authorizationAction.mockRejectedValueOnce(new Error('untrusted synthetic proof 123456'))
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '确认授权' }))
  expect(await screen.findByText('错误代码：local_failed')).toBeInTheDocument()
  expect(screen.queryByText(/untrusted synthetic proof/)).not.toBeInTheDocument()
})

test('托管恢复结果必须先接受信任边界，才会自动领取', async () => {
  const api = setup({ ...initial, kind: 'recovery', status: 'approved', fingerprint: undefined, allowed_actions: ['claim'] })
  expect(api.authorizationAction).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '验证并领取授权' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(api.authorizationAction).toHaveBeenCalledWith('fixture', 'recovery', initial.id, 'claim', expect.objectContaining({ confirm_trust: true })))
  expect(api.authorizationAction).toHaveBeenCalledTimes(1)
})

test.each(['approved', 'acknowledged'] as const)('%s 后由Core自动完成，本机失败时可无证明重试同一授权结果', async status => {
  const api = setup({ ...initial, status, allowed_actions: ['claim'] }, undefined, true, 'local_failed', initial.device_id)
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('验证器验证码')).not.toBeInTheDocument()
  expect(api.authorizationAction).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '重试完成授权' }))
  await waitFor(() => expect(api.authorizationAction).toHaveBeenCalledExactlyOnceWith('fixture', 'approval', initial.id, 'claim', { expected_revision: '3', confirm_trust: false }))
})

test.each(['login_required', 'refresh_unconfirmed'])('账号状态为 %s 时不能重试领取已确认的授权', errorCode => {
  const api = setup({ ...initial, status: 'acknowledged', allowed_actions: ['claim'] }, undefined, true, errorCode, initial.device_id)
  expect(screen.queryByRole('button', { name: '重试完成授权' })).not.toBeInTheDocument()
  expect(api.authorizationAction).not.toHaveBeenCalled()
})

test('批准响应丢失后补读确认成功，清除旧操作错误且不再次发送验证码', async () => {
  let resolve!: (value: CloudAuthorization) => void
  const confirmed = new Promise<CloudAuthorization>(done => { resolve = done })
  const read = vi.fn<CloudGateway['authorization']>().mockResolvedValueOnce(initial).mockImplementationOnce(() => confirmed)
  const api = setup(initial, read)
  await waitFor(() => expect(api.authorization).toHaveBeenCalledTimes(1))
  api.authorizationAction.mockRejectedValueOnce(new Error('response_incomplete'))
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '确认授权' }))
  expect(await screen.findByText('错误代码：response_incomplete')).toBeInTheDocument()
  await waitFor(() => expect(api.authorization).toHaveBeenCalledTimes(2))
  await act(async () => { resolve({ ...initial, status: 'approved', revision: '4', allowed_actions: [] }) })
  expect(screen.getByText('已授权')).toBeInTheDocument()
  expect(screen.queryByText('错误代码：response_incomplete')).not.toBeInTheDocument()
  expect(api.authorizationAction).toHaveBeenCalledTimes(1)
})

test('领取失败后相同授权状态补读仍保留错误，本机密钥确认成功才清除', async () => {
  const value = { ...initial, status: 'acknowledged' as const, allowed_actions: ['claim'] }
  const api = setup(value, undefined, true, 'local_failed', initial.device_id)
  api.authorizationAction.mockRejectedValueOnce(new Error('local_failed'))
  fireEvent.click(screen.getByRole('button', { name: '重试完成授权' }))
  expect(await screen.findByText('错误代码：local_failed')).toBeInTheDocument()
  await waitFor(() => expect(api.authorization).toHaveBeenCalledTimes(2))
  expect(screen.getByText('错误代码：local_failed')).toBeInTheDocument()
  api.authorization.mockResolvedValue({ ...value, keys_verified: true })
  await act(async () => { api.publish() })
  expect(screen.getByText('设备已授权')).toBeInTheDocument()
  expect(screen.queryByText('错误代码：local_failed')).not.toBeInTheDocument()
  expect(api.authorizationAction).toHaveBeenCalledOnce()
})

test('授权过期时移除身份草稿且不提交证明', () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  try {
    const api = setup({ ...initial, expires_at: new Date(Date.now() + 1000).toISOString() })
    fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('验证器验证码')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认授权' })).not.toBeInTheDocument()
    expect(api.authorizationAction).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

test.each(['invalidated', 'rejected', 'cancelled'] as const)('申请变为 %s 后立即清理身份草稿，不提交旧证明', async (status) => {
  const api = setup()
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

test('请求与审批两端默认展示同一配对码，批准后保持一致且请求端无需再次确认', async () => {
  const approver = setup()
  const approveDialog = screen.getByRole('dialog', { name: '授权新设备' })
  const pairing = (dialog: HTMLElement) => within(dialog).getByRole('region', { name: '配对码' })
  const code = (dialog: HTMLElement) => [...pairing(dialog).querySelectorAll('code')].map(part => part.textContent).join(' ')
  expect(code(approveDialog)).toBe(initial.pairing_code)
  expect(pairing(approveDialog).closest('details')).toBeNull()
  const approved = { ...initial, status: 'approved' as const, revision: '4', allowed_actions: [] }
  approver.authorizationAction.mockResolvedValue(approved)
  approver.authorization.mockResolvedValue(approved)
  fireEvent.change(within(approveDialog).getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(within(approveDialog).getByRole('button', { name: '确认授权' }))
  await within(approveDialog).findByText('已授权')
  expect(code(approveDialog)).toBe(initial.pairing_code)
  expect(approver.authorizationAction).toHaveBeenCalledOnce()
  approver.unmount()
  const requester = setup({ ...initial, allowed_actions: ['cancel'] }, undefined, true, undefined, initial.device_id)
  const requestDialog = screen.getByRole('dialog', { name: '等待设备授权' })
  expect(code(requestDialog)).toBe(initial.pairing_code)
  expect(within(requestDialog).queryByRole('checkbox')).not.toBeInTheDocument()
  expect(within(requestDialog).queryByLabelText('验证器验证码')).not.toBeInTheDocument()
  requester.authorization.mockResolvedValue({ ...approved, allowed_actions: ['claim'] })
  await act(async () => { requester.publish() })
  expect(code(requestDialog)).toBe(initial.pairing_code)
  expect(within(requestDialog).getByText('正在完成本机授权…')).toBeInTheDocument()
  expect(requester.authorizationAction).not.toHaveBeenCalled()
})

test('缺少配对码时提供重读，不冒用批准后的历史指纹', () => {
  setup({ ...initial, pairing_code: undefined })
  const pairing = screen.getByRole('region', { name: '配对码' })
  expect(within(pairing).getByText('配对码暂不可用')).toBeInTheDocument()
  expect(pairing.querySelectorAll('code')).toHaveLength(0)
  expect(within(pairing).getByRole('button', { name: /重\s*试/ })).toBeEnabled()
})

test('审批端成功展示新设备完成提示，不冒充本机领取过程', () => {
  setup({ ...initial, status: 'approved', allowed_actions: [] })
  expect(screen.getByText('新设备将自动完成授权。')).toBeInTheDocument()
  expect(screen.queryByText('正在完成本机授权…')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '重试完成授权' })).not.toBeInTheDocument()
})

test('拒绝申请不会触发身份表单提交', async () => {
  const api = setup({ ...initial, allowed_actions: ['approve', 'reject'] })
  fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
  await waitFor(() => expect(api.authorizationAction).toHaveBeenCalledExactlyOnceWith('fixture', 'approval', initial.id, 'reject', { expected_revision: '3', confirm_trust: false }))
})

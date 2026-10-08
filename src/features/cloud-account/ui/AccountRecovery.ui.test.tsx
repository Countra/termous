import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudRecoveryStatus, CloudSecurityOverview, CloudStatus } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { changeLanguage } from '#shared/i18n'
import { TermousApiError } from '#shared/api'
import { AccountRecovery } from './AccountRecovery'

beforeAll(async () => { await changeLanguage('zh-CN') })
const run = async <T,>(action: () => Promise<T>) => { try { return await action() } catch { return undefined } }
const status: CloudStatus = { generation: 'fixture', revision: 1, configured: true, authenticated: true, phase: 'ready', device_status: 'active', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
function fixture() {
  const state = new CloudState(); state.accept(status)
  let policy: CloudRecoveryStatus = { policy: { workspace_id: 'workspace', status: 'enabled', revision: '1', updated_at: new Date().toISOString() }, available: true }
  const api = {
    getStatus: state.snapshot, subscribeStatus: state.subscribe, subscribeChanges: state.subscribeChanges,
    security: vi.fn(async (): Promise<CloudSecurityOverview> => ({ account: { contract: 'cloud-authorization-v1', managed_recovery: true, mfa_enabled: true, mfa_revision: '1' }, recovery: policy, keys_verified: true, membership_initialized: true })),
    deviceRequests: vi.fn(async () => []), recoveryOperations: vi.fn(async () => []),
    recoveryPolicy: vi.fn(async () => { policy = { ...policy, policy: { ...policy.policy, revision: '2', status: 'disabled' } }; return policy }),
    mfaStatus: vi.fn(async () => ({ enabled: true, revision: '1', backup_codes_remaining: 10, verified_until: new Date(Date.now() + 300_000).toISOString() })),
    reauthenticate: vi.fn(async () => ({ verified_until: new Date(Date.now() + 300_000).toISOString() })),
    rekey: vi.fn(async () => ({ status: 'staging', total: 0, completed: 0 })),
  }
  return { api, state }
}
async function open() {
  const button = await screen.findByRole('button', { name: '关闭并轮换数据密钥' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  const dialog = within(await screen.findByRole('dialog'))
  expect(dialog.queryByLabelText('密码')).not.toBeInTheDocument()
  fireEvent.change(dialog.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(dialog.getByRole('button', { name: '关闭并轮换数据密钥' }))
  return dialog
}

test('关闭并轮换只提交一次第二因子，前段成功后复用服务端期限自动接续', async () => {
  const { api } = fixture()
  render(<AccountRecovery api={api as unknown as CloudGateway} status={status} busy={false} run={run} />)
  await open()
  await waitFor(() => expect(api.rekey).toHaveBeenCalledExactlyOnceWith('fixture', 'start'))
  expect(api.recoveryPolicy).toHaveBeenCalledExactlyOnceWith('fixture', 'disable', '1', { method: 'totp', code: '123456' })
  expect(api.reauthenticate).not.toHaveBeenCalled()
})

test('前段确认后读取期限失败只保留轮换阶段，重试不重复关闭恢复', async () => {
  const { api } = fixture()
  api.mfaStatus.mockRejectedValueOnce(new Error('network_unavailable'))
  render(<AccountRecovery api={api as unknown as CloudGateway} status={status} busy={false} run={run} />)
  const dialog = await open()
  expect(await screen.findByText('错误代码：network_unavailable')).toBeInTheDocument()
  expect(api.rekey).not.toHaveBeenCalled()
  expect(api.recoveryPolicy).toHaveBeenCalledOnce()
  const button = dialog.getByRole('button', { name: '开始轮换' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  await waitFor(() => expect(api.rekey).toHaveBeenCalledExactlyOnceWith('fixture', 'start'))
  expect(api.reauthenticate).not.toHaveBeenCalled()
  expect(api.recoveryPolicy).toHaveBeenCalledOnce()
})

test('账号切换后的旧关闭响应不能继续读取期限或启动轮换', async () => {
  const { api, state } = fixture()
  let resolve!: (value: CloudRecoveryStatus) => void
  api.recoveryPolicy.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  render(<AccountRecovery api={api as unknown as CloudGateway} status={status} busy={false} run={run} />)
  await open()
  await waitFor(() => expect(resolve).toBeDefined())
  act(() => { state.accept({ ...status, generation: 'another-account', revision: 2 }) })
  await act(async () => { resolve({ policy: { workspace_id: 'workspace', revision: '2', status: 'disabled', updated_at: new Date().toISOString() }, available: false }) })
  expect(api.rekey).not.toHaveBeenCalled()
  expect(api.mfaStatus).not.toHaveBeenCalled()
})

test('服务端撤回近期期限时就地补验轮换，不重复停止发放', async () => {
  const { api } = fixture()
  api.rekey.mockRejectedValueOnce(new TermousApiError('reauthentication_required', 'CLOUD_OPERATION_FAILED', 409))
  render(<AccountRecovery api={api as unknown as CloudGateway} status={status} busy={false} run={run} />)
  const dialog = await open()
  expect(await screen.findByText('错误代码：reauthentication_required')).toBeInTheDocument()
  const field = await dialog.findByLabelText('验证器验证码')
  await waitFor(() => expect(field).toBeEnabled())
  fireEvent.change(field, { target: { value: '234567' } })
  fireEvent.click(dialog.getByRole('button', { name: '开始轮换' }))
  await waitFor(() => expect(api.rekey).toHaveBeenCalledTimes(2))
  expect(api.reauthenticate).toHaveBeenCalledExactlyOnceWith('fixture', { method: 'totp', code: '234567' })
  expect(api.recoveryPolicy).toHaveBeenCalledOnce()
})

test('关闭成功后因子版本变化，旧期限不启动轮换且保留续作阶段', async () => {
  const { api, state } = fixture()
  const original = await api.security()
  let resolve!: (value: { enabled: boolean; revision: string; backup_codes_remaining: number; verified_until: string }) => void
  api.mfaStatus.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  render(<AccountRecovery api={api as unknown as CloudGateway} status={status} busy={false} run={run} />)
  const dialog = await open()
  await waitFor(() => expect(resolve).toBeDefined())
  api.security.mockResolvedValue({ ...original, account: { ...original.account, mfa_revision: '2' }, recovery: { ...original.recovery, policy: { ...original.recovery.policy, status: 'disabled', revision: '2' } } })
  await act(async () => { state.acceptEvent({ type: 'account', status, changes: ['mfa'], operations: [] }) })
  expect(dialog.getByLabelText('验证器验证码')).toHaveValue('')
  await act(async () => { resolve({ enabled: true, revision: '1', backup_codes_remaining: 10, verified_until: new Date(Date.now() + 300_000).toISOString() }) })
  expect(await screen.findByText('错误代码：mfa_revision_conflict')).toBeInTheDocument()
  const resume = await screen.findByRole('button', { name: /开始轮换/ })
  await waitFor(() => expect(resume).not.toHaveClass('ant-btn-loading'))
  expect(resume).toBeEnabled()
  expect(api.rekey).not.toHaveBeenCalled()
  expect(api.recoveryPolicy).toHaveBeenCalledOnce()
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '234567' } })
  fireEvent.click(resume)
  await waitFor(() => expect(api.rekey).toHaveBeenCalledExactlyOnceWith('fixture', 'start'))
  expect(api.reauthenticate).toHaveBeenCalledExactlyOnceWith('fixture', { method: 'totp', code: '234567' })
  expect(api.recoveryPolicy).toHaveBeenCalledOnce()
})

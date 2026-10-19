import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Form } from 'antd'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudMFAProof, CloudMFAStatus, CloudSecurityOverview } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { changeLanguage } from '#shared/i18n'
import { buildCloudStepUpProof } from '../model/stepUpProof'
import { AccountStepUpFields } from './AccountStepUpFields'
import { AccountStepUpDialog } from './AccountStepUpDialog'
import { AccountVerification } from './AccountVerification'
import { AccountDevices } from './AccountDevices'

beforeAll(async () => { await changeLanguage('zh-CN') })
const run = async <T,>(action: () => Promise<T>) => { try { return await action() } catch { return undefined } }

test('证明构建只发送当前策略允许的因子，未知策略及托管恢复禁用MFA时阻断', () => {
  const values = { password: 'synthetic-password', method: 'backup_code' as const, code: 'synthetic-backup' }
  expect(buildCloudStepUpProof(true, values)).toEqual({ method: 'backup_code', code: 'synthetic-backup' })
  expect(buildCloudStepUpProof(false, values)).toEqual({ password: 'synthetic-password' })
  expect(buildCloudStepUpProof(true, { ...values, method: 'totp', code: '123456' }, true)).toEqual({ method: 'totp', code: '123456' })
  expect(() => buildCloudStepUpProof(undefined, values)).toThrow('CLOUD_MFA_UNAVAILABLE')
  expect(() => buildCloudStepUpProof(false, values, true)).toThrow('CLOUD_MFA_UNAVAILABLE')
  expect(() => buildCloudStepUpProof(true, values, true)).toThrow('mfa_invalid_code')
})

test('账号验证策略切换清除密码和第二因子草稿，未知状态不显示密码降级', async () => {
  let snapshot!: () => CloudMFAProof
  function Fields({ enabled }: { enabled: boolean | undefined }) {
    const [form] = Form.useForm<CloudMFAProof>()
    snapshot = () => form.getFieldsValue(true)
    return <Form form={form}><AccountStepUpFields enabled={enabled} /></Form>
  }
  const view = render(<Fields enabled={false} />)
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  view.rerender(<Fields enabled />)
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  expect(snapshot().password).toBeUndefined()
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  view.rerender(<Fields enabled={undefined} />)
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('验证器验证码')).not.toBeInTheDocument()
  expect(snapshot().code).toBeUndefined()
  view.rerender(<Fields enabled={false} />)
  expect(screen.getByLabelText('密码')).toHaveValue('')
})

function fixture(mfa: CloudMFAStatus) {
  const state = new CloudState()
  state.accept({ generation: 'fixture', revision: 1, configured: true, authenticated: true, phase: 'ready', auto_sync: false, confirmed: false, pending: 0, conflicts: 0 })
  const api = { getStatus: state.snapshot, subscribeStatus: state.subscribe, reauthenticate: vi.fn(async () => ({ server_time: new Date().toISOString(), verified_until: new Date(Date.now() + 300_000).toISOString() })) } as unknown as CloudGateway
  const action = vi.fn(async () => undefined), accept = vi.fn(), onClose = vi.fn(), reload = vi.fn(async () => mfa), onUncertain = vi.fn()
  const props = { api, generation: 'fixture', mfa, unavailable: false, busy: false, title: '测试敏感操作', description: '操作影响说明', run, action, accept, reload, onUncertain, onClose }
  return { state, api, action, accept, onClose, reload, onUncertain, props }
}

test('敏感操作就地单因子验证后执行一次，不需要先去安全页认证', async () => {
  const f = fixture({ server_time: new Date().toISOString(), enabled: true, revision: '1', backup_codes_remaining: 10 })
  render(<AccountStepUpDialog {...f.props} />)
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  await waitFor(() => expect(f.action).toHaveBeenCalledOnce())
  expect(f.api.reauthenticate).toHaveBeenCalledExactlyOnceWith('fixture', { method: 'totp', code: '123456' })
  expect(f.onClose).toHaveBeenCalledOnce()
})

test('服务端确认的近期期限可复用，过期后重新展示因子而不执行操作', async () => {
  const mfa = { server_time: new Date().toISOString(), enabled: true, revision: '1', backup_codes_remaining: 10, verified_until: new Date(Date.now() + 300_000).toISOString() }
  const f = fixture(mfa)
  const view = render(<AccountStepUpDialog {...f.props} />)
  expect(screen.queryByLabelText('验证器验证码')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  await waitFor(() => expect(f.action).toHaveBeenCalledOnce())
  expect(f.api.reauthenticate).not.toHaveBeenCalled()
  view.rerender(<AccountStepUpDialog {...f.props} mfa={{ ...mfa, verified_until: new Date(Date.now() - 1000).toISOString() }} />)
  expect(await screen.findByLabelText('验证器验证码')).toHaveValue('')
  expect(f.action).toHaveBeenCalledOnce()
})

test('验证响应丢失不执行业务操作或重放证明，账号切换后的迟到验证不继续', async () => {
  const f = fixture({ server_time: new Date().toISOString(), enabled: false, revision: '0', backup_codes_remaining: 0 })
  vi.mocked(f.api.reauthenticate).mockRejectedValueOnce(new Error('response_incomplete'))
  render(<AccountStepUpDialog {...f.props} />)
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  await screen.findByText('错误代码：response_incomplete')
  expect(screen.getByLabelText('密码')).toHaveValue('')
  expect(f.action).not.toHaveBeenCalled()
  expect(f.api.reauthenticate).toHaveBeenCalledOnce()
  expect(f.reload).toHaveBeenCalledOnce()
  expect(f.onUncertain).toHaveBeenCalledOnce()
  let resolve!: (value: { server_time: string; verified_until: string }) => void
  vi.mocked(f.api.reauthenticate).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  await waitFor(() => expect(resolve).toBeDefined())
  act(() => { f.state.accept({ ...f.state.snapshot()!, generation: 'new-account', revision: 2 }) })
  await act(async () => { resolve({ server_time: new Date().toISOString(), verified_until: new Date(Date.now() + 300_000).toISOString() }) })
  expect(f.action).not.toHaveBeenCalled()
  expect(f.accept).not.toHaveBeenCalled()
})

test.each([{ enabled: true, revision: '2' }, { enabled: false, revision: '2' }])('在途验证期间因子变为 $enabled / $revision，不补写旧期限或执行后续操作', async (policy) => {
  const f = fixture({ server_time: new Date().toISOString(), enabled: true, revision: '1', backup_codes_remaining: 10 })
  let resolve!: (value: { server_time: string; verified_until: string }) => void
  vi.mocked(f.api.reauthenticate).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = render(<AccountStepUpDialog {...f.props} />)
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  await waitFor(() => expect(resolve).toBeDefined())
  view.rerender(<AccountStepUpDialog {...f.props} mfa={{ ...f.props.mfa, ...policy }} />)
  await act(async () => { resolve({ server_time: new Date().toISOString(), verified_until: new Date(Date.now() + 300_000).toISOString() }) })
  expect(f.action).not.toHaveBeenCalled()
  expect(f.accept).not.toHaveBeenCalled()
  expect(f.onClose).not.toHaveBeenCalled()
  expect(screen.getByText('错误代码：mfa_revision_conflict')).toBeInTheDocument()
  expect(screen.getByLabelText(policy.enabled ? '验证器验证码' : '密码')).toHaveValue('')
})

test('安全状态读取失败时，即使保留近期期限，表单提交也不会执行业务', async () => {
  const f = fixture({ server_time: new Date().toISOString(), enabled: true, revision: '1', backup_codes_remaining: 10, verified_until: new Date(Date.now() + 300_000).toISOString() })
  const view = render(<AccountStepUpDialog {...f.props} unavailable />)
  fireEvent.submit(view.container.ownerDocument.querySelector('form')!)
  await act(async () => { await Promise.resolve() })
  expect(f.api.reauthenticate).not.toHaveBeenCalled()
  expect(f.action).not.toHaveBeenCalled()
})

test('独立近期认证的迟到响应不会覆盖其他端更换因子的状态', async () => {
  const f = fixture({ server_time: new Date().toISOString(), enabled: true, revision: '1', backup_codes_remaining: 10 })
  let resolve!: (value: { server_time: string; verified_until: string }) => void
  vi.mocked(f.api.reauthenticate).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = render(<AccountVerification {...f.props} />)
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '验证身份' }))
  await waitFor(() => expect(resolve).toBeDefined())
  view.rerender(<AccountVerification {...f.props} mfa={{ ...f.props.mfa, revision: '2' }} />)
  await act(async () => { resolve({ server_time: new Date().toISOString(), verified_until: new Date(Date.now() + 300_000).toISOString() }) })
  expect(f.accept).not.toHaveBeenCalled()
  expect(screen.getByLabelText('验证器验证码')).toHaveValue('')
  expect(screen.getByText('错误代码：mfa_revision_conflict')).toBeInTheDocument()
})

test('撤销设备直接打开统一确认弹窗并复用近期期限，无需再次输入验证器', async () => {
  const mfa = { server_time: new Date().toISOString(), enabled: true, revision: '1', backup_codes_remaining: 10, verified_until: new Date(Date.now() + 300_000).toISOString() }
  const f = fixture(mfa)
  const status = { ...f.state.snapshot()!, device_id: 'self-device', device_status: 'active' as const }
  act(() => { f.state.accept(status) })
  const revoke = vi.fn(async () => undefined)
  Object.assign(f.api, {
    mfaStatus: vi.fn(async () => mfa), devices: vi.fn(async () => [{ id: 'other-device', user_id: 'user', name: '其他设备', signing_key: '', recipient: '', status: 'active', created_at: new Date().toISOString() }]),
    deviceRequests: vi.fn(async () => []), recoveryOperations: vi.fn(async () => []), revokeDevice: revoke,
    security: vi.fn(async () => ({ account: { contract: 'cloud-authorization-v1', managed_recovery: false, mfa_enabled: true, mfa_revision: '1' }, keys_verified: true, membership_initialized: true, recovery: { policy: { workspace_id: 'workspace', status: 'disabled', revision: '0', updated_at: new Date().toISOString() }, available: false } })),
  })
  render(<AccountDevices api={f.api} status={status} busy={false} run={run} />)
  const button = await screen.findByRole('button', { name: /^撤\s*销$/ })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  await screen.findByRole('dialog')
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('验证器验证码')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  await waitFor(() => expect(revoke).toHaveBeenCalledExactlyOnceWith('fixture', 'other-device'))
  expect(f.api.reauthenticate).not.toHaveBeenCalled()
})

test('成员初始化等待验证时因子变化，停止旧请求续作并就地说明重新验证', async () => {
  const f = fixture({ server_time: new Date().toISOString(), enabled: true, revision: '1', backup_codes_remaining: 10 })
  const status = { ...f.state.snapshot()!, device_id: 'self-device', device_status: 'active' as const }
  act(() => { f.state.accept(status) })
  const overview: CloudSecurityOverview = { account: { contract: 'cloud-authorization-v1', managed_recovery: false, mfa_enabled: true, mfa_revision: '1' }, keys_verified: true, membership_initialized: false, recovery: { policy: { workspace_id: 'workspace', status: 'disabled', revision: '0', updated_at: new Date().toISOString() }, available: false } }
  const security = vi.fn(async () => overview), initializeMembership = vi.fn(async () => undefined)
  let resolve!: (value: { server_time: string; verified_until: string }) => void
  vi.mocked(f.api.reauthenticate).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  Object.assign(f.api, {
    subscribeChanges: f.state.subscribeChanges,
    mfaStatus: vi.fn(async () => f.props.mfa), devices: vi.fn(async () => [{ id: 'self-device', user_id: 'user', name: '本机', signing_key: '', recipient: '', status: 'active', created_at: new Date().toISOString() }]),
    deviceRequests: vi.fn(async () => []), recoveryOperations: vi.fn(async () => []), security, initializeMembership,
  })
  render(<AccountDevices api={f.api} status={status} busy={false} run={run} />)
  const button = await screen.findByRole('button', { name: '核对设备清单' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(dialog.getByRole('button', { name: '确认并开启' }))
  await waitFor(() => expect(resolve).toBeDefined())
  security.mockResolvedValue({ ...overview, account: { ...overview.account, mfa_revision: '2' } })
  await act(async () => { f.state.acceptEvent({ type: 'account', status, changes: ['mfa'], operations: [] }) })
  await act(async () => { resolve({ server_time: new Date().toISOString(), verified_until: new Date(Date.now() + 300_000).toISOString() }) })
  expect(initializeMembership).not.toHaveBeenCalled()
  expect(screen.getByText('错误代码：mfa_revision_conflict')).toBeInTheDocument()
  expect(dialog.getByLabelText('验证器验证码')).toHaveValue('')
})

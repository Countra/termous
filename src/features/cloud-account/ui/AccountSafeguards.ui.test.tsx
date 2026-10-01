import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudPersonalRecoverySetup, CloudSecurityOverview, CloudStatus, CloudWorkspaceRestart } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { changeLanguage } from '#shared/i18n'
import { TermousApiError } from '#shared/api'
import { AccountPersonalRecovery } from './AccountPersonalRecovery'
import { AccountWorkspaceRestart } from './AccountWorkspaceRestart'

beforeAll(async () => { await changeLanguage('zh-CN') })
const status: CloudStatus = { generation: 'fixture', revision: 1, configured: true, authenticated: true, phase: 'ready', device_status: 'active', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => { try { return await action() } catch { return undefined } }
const groups = ['ABCDE', 'FGHIJ', 'KLMNO', 'PQRST', 'UVWXY', 'Z2345', 'ABCDE', 'FGHIJ', 'KLMNO', 'PQRST', 'UVWXY', 'Z2345']
function fixture(enabled = false) {
  const state = new CloudState(); state.accept(status)
  const security: CloudSecurityOverview = { account: { contract: 'cloud-recovery-safeguards-v1', managed_recovery: true, mfa_enabled: false, mfa_revision: '0', workspace_id: 'workspace_test', recovery_required: true, recovery_ready: enabled, personal_recovery_enabled: enabled, archive_available: false }, keys_verified: true, membership_initialized: true, recovery: { available: false, reason: 'not_enabled', policy: { workspace_id: 'workspace_test', status: 'disabled', revision: '0', updated_at: new Date().toISOString() } } }
  const setup: CloudPersonalRecoverySetup = { id: 'personal_setup_test', kind: 'setup', status: 'verified', revision: '2', membership_head: 'synthetic_head', personal_revision: '0', key_epoch: '1', expires_at: new Date(Date.now() + 600_000).toISOString(), verified_until: new Date(Date.now() + 300_000).toISOString(), recovery_key: `TRK1-${groups.join('-')}`, confirm_groups: [0, 1] }
  const api = { getStatus: state.snapshot, subscribeStatus: state.subscribe, security: vi.fn(async () => security), setupPersonalRecovery: vi.fn(async () => setup), confirmPersonalRecovery: vi.fn(async () => ({ ...setup, status: 'completed' })), reauthenticate: vi.fn(async () => ({ verified_until: new Date(Date.now() + 300_000).toISOString() })), rekey: vi.fn(async () => ({ status: 'complete', completed: 0, total: 0 })) } as unknown as CloudGateway
  return { api, state, setup }
}
async function generate() {
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByRole('button', { name: '生成恢复密钥' }))
}

async function enterSavedGroups() {
  await waitFor(() => expect(screen.getByRole('button', { name: '设置恢复密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' })); await generate()
  fireEvent.click(await screen.findByRole('button', { name: '已保存，隐藏并核对' }))
  fireEvent.change(screen.getByLabelText('第 12 组'), { target: { value: groups[11] } })
  fireEvent.change(screen.getByLabelText('第 5 组'), { target: { value: groups[4] } })
}

test('正确分组提交失败时，在弹窗内显示具体错误并保留输入', async () => {
  const { api, setup } = fixture()
  setup.confirm_groups = [11, 4]
  vi.mocked(api.confirmPersonalRecovery).mockRejectedValueOnce(new TermousApiError('membership_conflict', 'CLOUD_OPERATION_FAILED', 409))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await enterSavedGroups()
  fireEvent.click(screen.getByRole('button', { name: '确认启用' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(await dialog.findByText('操作版本已变化，请查询最新结果后继续。')).toBeInTheDocument()
  expect(dialog.getByText('错误代码：membership_conflict')).toBeInTheDocument()
  expect(dialog.getByLabelText('第 12 组')).toHaveValue(groups[11])
  expect(dialog.getByLabelText('第 5 组')).toHaveValue(groups[4])
  expect(api.confirmPersonalRecovery).toHaveBeenCalledExactlyOnceWith('fixture', setup.id, [groups[11], groups[4]])
})

test('确认响应丢失后查询终态，补齐本机结果且不重新生成或提交身份证明', async () => {
  const { api, setup } = fixture()
  setup.confirm_groups = [11, 4]
  vi.mocked(api.confirmPersonalRecovery).mockRejectedValueOnce(new TermousApiError('network_unavailable', 'CLOUD_OPERATION_FAILED', 503))
  api.personalOperation = vi.fn<CloudGateway['personalOperation']>(async () => ({ ...setup, status: 'completed' }))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await enterSavedGroups()
  fireEvent.click(screen.getByRole('button', { name: '确认启用' }))
  await screen.findByText('错误代码：network_unavailable')
  fireEvent.click(screen.getByRole('button', { name: '查询操作状态' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '设置恢复密钥' })).toBeEnabled())
  expect(api.personalOperation).toHaveBeenCalledExactlyOnceWith('fixture', 'setup', setup.id)
  expect(api.confirmPersonalRecovery).toHaveBeenCalledTimes(2)
  expect(api.confirmPersonalRecovery).toHaveBeenLastCalledWith('fixture', setup.id, [])
  expect(api.setupPersonalRecovery).toHaveBeenCalledOnce()
  // AntD 关闭动画在 jsdom 中会保留旧 DOM，通过重新打开检查向导已清空且未重复提交。
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' }))
  expect(screen.getByLabelText('密码')).toHaveValue('')
  expect(screen.queryByLabelText('第 12 组')).not.toBeInTheDocument()
})

test('查询未完成申请只提示当前状态，不代替用户再次确认', async () => {
  const { api, setup } = fixture()
  setup.confirm_groups = [11, 4]
  api.personalOperation = vi.fn(async () => setup)
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await enterSavedGroups()
  fireEvent.click(screen.getByRole('button', { name: '查询操作状态' }))
  expect(await within(screen.getByRole('dialog')).findByText('恢复密钥尚未启用。请核对分组并确认；申请过期时可取消后重新验证身份。')).toBeInTheDocument()
  expect(api.confirmPersonalRecovery).not.toHaveBeenCalled()
  expect(screen.getByLabelText('第 12 组')).toHaveValue(groups[11])
})

test('等待确认期间拦截重复提交，关闭后迟到结果不能重新打开向导', async () => {
  const { api, setup } = fixture()
  setup.confirm_groups = [11, 4]
  let resolve!: (value: CloudPersonalRecoverySetup) => void
  vi.mocked(api.confirmPersonalRecovery).mockImplementation(() => new Promise(done => { resolve = done }))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await enterSavedGroups()
  const confirm = screen.getByRole('button', { name: '确认启用' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  await waitFor(() => expect(api.confirmPersonalRecovery).toHaveBeenCalledOnce())
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
  await act(async () => { resolve({ ...setup, status: 'completed' }) })
  await waitFor(() => expect(screen.getByRole('button', { name: '设置恢复密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' }))
  expect(screen.getByLabelText('密码')).toHaveValue('')
  expect(screen.queryByLabelText('第 12 组')).not.toBeInTheDocument()
})

test('切换账号后旧生成响应不能把恢复密钥放进新账号向导', async () => {
  const { api, state, setup } = fixture()
  let resolve!: (value: CloudPersonalRecoverySetup) => void
  vi.mocked(api.setupPersonalRecovery).mockImplementation(() => new Promise(done => { resolve = done }))
  const view = render(<AccountPersonalRecovery key={status.generation} api={api} status={status} busy={false} run={run} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '设置恢复密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' })); await generate()
  await waitFor(() => expect(api.setupPersonalRecovery).toHaveBeenCalledOnce())
  const next = { ...status, generation: 'another-account' }
  state.accept(next)
  view.rerender(<AccountPersonalRecovery key={next.generation} api={api} status={next} busy={false} run={run} />)
  await act(async () => { resolve(setup) })
  await waitFor(() => expect(screen.getByRole('button', { name: '设置恢复密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' }))
  expect(screen.getByLabelText('密码')).toHaveValue('')
  expect(screen.queryByRole('list', { name: '个人恢复密钥' })).not.toBeInTheDocument()
})

test('未知异常正文不进入弹窗的错误代码区域', async () => {
  const { api, setup } = fixture()
  setup.confirm_groups = [11, 4]
  vi.mocked(api.confirmPersonalRecovery).mockRejectedValueOnce(new Error('SyntheticSecretDoNotDisplay'))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await enterSavedGroups()
  fireEvent.click(screen.getByRole('button', { name: '确认启用' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(await dialog.findByText('错误代码：local_failed')).toBeInTheDocument()
  expect(dialog.queryByText(/SyntheticSecretDoNotDisplay/)).not.toBeInTheDocument()
})

test('关闭向导后到达的生成响应不能重新展示恢复秘密', async () => {
  const { api, setup } = fixture()
  let resolve!: (value: CloudPersonalRecoverySetup) => void
  vi.mocked(api.setupPersonalRecovery).mockImplementation(() => new Promise(done => { resolve = done }))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '设置恢复密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' })); await generate()
  await waitFor(() => expect(api.setupPersonalRecovery).toHaveBeenCalledOnce())
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
  await act(async () => { resolve(setup) })
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' }))
  expect(screen.getByLabelText('密码')).toHaveValue('')
  expect(screen.queryByRole('list', { name: '个人恢复密钥' })).not.toBeInTheDocument()
})

test('更换完成后轮换单独验证，失败保留待办且不重复提交恢复密钥', async () => {
  const { api } = fixture(true)
  vi.mocked(api.reauthenticate).mockRejectedValueOnce(new Error('network_unavailable'))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '更换并轮换数据密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '更换并轮换数据密钥' })); await generate()
  fireEvent.click(await screen.findByRole('button', { name: '已保存，隐藏并核对' }))
  expect(screen.queryByRole('list', { name: '个人恢复密钥' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('第 1 组'), { target: { value: groups[0] } })
  fireEvent.change(screen.getByLabelText('第 2 组'), { target: { value: groups[1] } })
  fireEvent.click(screen.getByRole('button', { name: '确认启用' }))
  await waitFor(() => expect(api.confirmPersonalRecovery).toHaveBeenCalledOnce())
  // AntD 在测试环境固定标题 ID，退出动画期间通过操作按钮定位当前对话框。
  const rotationButton = await screen.findByRole('button', { name: '开始轮换' })
  const rotation = within(rotationButton.closest('[role="dialog"]') as HTMLElement)
  fireEvent.change(rotation.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(rotation.getByRole('button', { name: '开始轮换' }))
  await waitFor(() => expect(api.reauthenticate).toHaveBeenCalledOnce())
  expect(api.rekey).not.toHaveBeenCalled()
  fireEvent.change(rotation.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(rotation.getByRole('button', { name: '开始轮换' }))
  await waitFor(() => expect(api.rekey).toHaveBeenCalledWith('fixture', 'start'))
  expect(api.confirmPersonalRecovery).toHaveBeenCalledOnce()
})

test('重置验证结果不明时清除证明，查询结果不会自动执行切换', async () => {
  const { api } = fixture()
  const pending: CloudWorkspaceRestart = { id: 'restart_test', status: 'pending', revision: 1, source_workspace_id: 'workspace_old', target_workspace_id: 'workspace_new', expires_at: new Date(Date.now() + 600_000).toISOString(), email_sent: true, source_device_count: 4 }
  const verified: CloudWorkspaceRestart = { ...pending, status: 'verified', revision: 2, verified_until: new Date(Date.now() + 300_000).toISOString() }
  api.createWorkspaceRestart = vi.fn(async () => pending)
  api.verifyRestart = vi.fn(async () => { throw new Error('network_unavailable') })
  api.workspaceRestart = vi.fn(async () => verified)
  api.completeRestart = vi.fn(async (): Promise<CloudWorkspaceRestart> => ({ ...verified, status: 'completed', local_pending: true }))
  render(<AccountWorkspaceRestart api={api} status={status} busy={false} mfaEnabled={false} run={run} />)
  fireEvent.click(screen.getByRole('button', { name: '重新开始云同步' }))
  fireEvent.click(screen.getByRole('button', { name: '创建重新开始申请' }))
  fireEvent.change(await screen.findByLabelText('邮件中的确认码'), { target: { value: 'synthetic-email-proof' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByRole('button', { name: '验证身份' }))
  await waitFor(() => expect(api.verifyRestart).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.getByLabelText('密码')).toHaveValue(''))
  expect(screen.getByLabelText('邮件中的确认码')).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: '查询操作状态' }))
  const confirm = await screen.findByRole('button', { name: '确认立即重新开始' })
  expect(confirm).toBeDisabled()
  expect(api.completeRestart).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(confirm)
  await waitFor(() => expect(api.completeRestart).toHaveBeenCalledWith('fixture', 'restart_test', 2))
  expect(await screen.findByText('云端已切换，本机绑定待完成')).toBeInTheDocument()
  expect(api.verifyRestart).toHaveBeenCalledOnce()
})

test('重置实时补读保留同版本确认，版本变化清除确认且不自动切换', async () => {
  const { api, state } = fixture()
  api.subscribeChanges = state.subscribeChanges
  const verified: CloudWorkspaceRestart = { id: 'restart_realtime', status: 'verified', revision: 2, source_workspace_id: 'workspace_old', target_workspace_id: 'workspace_new', expires_at: new Date(Date.now() + 600_000).toISOString(), verified_until: new Date(Date.now() + 300_000).toISOString(), email_sent: true }
  api.createWorkspaceRestart = vi.fn(async () => verified)
  api.workspaceRestart = vi.fn(async () => verified)
  api.completeRestart = vi.fn()
  render(<AccountWorkspaceRestart api={api} status={status} busy={false} mfaEnabled={false} run={run} />)
  fireEvent.click(screen.getByRole('button', { name: '重新开始云同步' }))
  fireEvent.click(screen.getByRole('button', { name: '创建重新开始申请' }))
  const confirm = await screen.findByRole('button', { name: '确认立即重新开始' })
  fireEvent.click(screen.getByRole('checkbox'))
  expect(confirm).toBeEnabled()
  await act(async () => { state.acceptEvent({ type: 'account', status, changes: ['workspaces'], operations: [verified.id] }) })
  await waitFor(() => expect(api.workspaceRestart).toHaveBeenCalledOnce())
  await waitFor(() => expect(confirm).toBeEnabled())
  expect(screen.getByRole('checkbox')).toBeChecked()
  vi.mocked(api.workspaceRestart).mockResolvedValueOnce({ ...verified, revision: 3 })
  await act(async () => { state.acceptEvent({ type: 'account', status, changes: ['workspaces'], operations: [verified.id] }) })
  await waitFor(() => expect(confirm).toBeDisabled())
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(api.completeRestart).not.toHaveBeenCalled()
})

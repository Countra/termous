import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
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
  const setup: CloudPersonalRecoverySetup = { server_time: new Date().toISOString(), id: 'personal_setup_test', kind: 'setup', status: 'verified', revision: '2', membership_head: 'synthetic_head', personal_revision: '0', key_epoch: '1', expires_at: new Date(Date.now() + 600_000).toISOString(), verified_until: new Date(Date.now() + 300_000).toISOString(), recovery_key: `TRK1-${groups.join('-')}`, recovery_file: JSON.stringify({ format: 'termous-personal-recovery-key', recovery_key: `TRK1-${groups.join('-')}` }) }
  const api = { getStatus: state.snapshot, subscribeStatus: state.subscribe, security: vi.fn(async () => security), setupPersonalRecovery: vi.fn(async () => setup), confirmPersonalRecovery: vi.fn(async () => ({ ...setup, status: 'completed' })), mfaStatus: vi.fn(async () => ({ server_time: new Date().toISOString(), enabled: false, revision: '0', backup_codes_remaining: 0 })), reauthenticate: vi.fn(async () => ({ server_time: new Date().toISOString(), verified_until: new Date(Date.now() + 300_000).toISOString() })), rekey: vi.fn(async () => ({ status: 'complete', completed: 0, total: 0 })) } as unknown as CloudGateway
  return { api, state, setup }
}
async function generate() {
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(screen.getByRole('button', { name: '生成恢复密钥' }))
}

async function enterSaveStep() {
  await waitFor(() => expect(screen.getByRole('button', { name: '设置恢复密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' })); await generate()
  await screen.findByRole('button', { name: '已保存，启用' })
}

test('下载保存 Core 文件原文，使用专用后缀且不增加分组考试', async () => {
  const { api, setup } = fixture()
  const create = vi.fn(() => 'blob:recovery-fixture'), revoke = vi.fn()
  const OriginalURL = URL
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = create; static revokeObjectURL = revoke })
  let filename = ''
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download })
  try {
    render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
    await enterSaveStep()
    fireEvent.click(screen.getByRole('button', { name: '下载密钥文件' }))
    expect(filename).toBe(`termous-recovery-${setup.id}.torkey`)
    const blob = (create.mock.calls as unknown as [Blob][])[0][0]
    const body = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob) })
    expect(body).toBe(setup.recovery_file)
    expect(api.confirmPersonalRecovery).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/第 \d+ 组/)).not.toBeInTheDocument()
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:recovery-fixture'), { timeout: 2000 })
  } finally { click.mockRestore(); vi.unstubAllGlobals() }
})

test('保存确认失败时，通过统一消息显示具体错误并保留密钥', async () => {
  const { api, setup } = fixture()
  vi.mocked(api.confirmPersonalRecovery).mockRejectedValueOnce(new TermousApiError('membership_conflict', 'CLOUD_OPERATION_FAILED', 409))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await enterSaveStep()
  fireEvent.click(screen.getByRole('button', { name: '已保存，启用' }))
  expect(await screen.findByText('可信设备清单已变化，请刷新申请后继续。')).toBeInTheDocument()
  expect(screen.getByText('错误代码：membership_conflict')).toBeInTheDocument()
  expect(api.confirmPersonalRecovery).toHaveBeenCalledExactlyOnceWith('fixture', setup.id, true)
})

test('确认响应丢失后查询终态，补齐本机结果且不重新生成或提交身份证明', async () => {
  const { api, setup } = fixture()
  vi.mocked(api.confirmPersonalRecovery).mockRejectedValueOnce(new TermousApiError('network_unavailable', 'CLOUD_OPERATION_FAILED', 503))
  api.personalOperation = vi.fn<CloudGateway['personalOperation']>(async () => ({ ...setup, status: 'completed' }))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await enterSaveStep()
  fireEvent.click(screen.getByRole('button', { name: '已保存，启用' }))
  await screen.findByText('错误代码：network_unavailable')
  fireEvent.click(screen.getByRole('button', { name: '查询操作状态' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '设置恢复密钥' })).toBeEnabled())
  expect(api.personalOperation).toHaveBeenCalledExactlyOnceWith('fixture', 'setup', setup.id)
  expect(api.confirmPersonalRecovery).toHaveBeenCalledTimes(2)
  expect(api.confirmPersonalRecovery).toHaveBeenLastCalledWith('fixture', setup.id, false)
  expect(api.setupPersonalRecovery).toHaveBeenCalledOnce()
  // AntD 关闭动画在 jsdom 中会保留旧 DOM，通过重新打开检查向导已清空且未重复提交。
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' }))
  expect(screen.getByLabelText('密码')).toHaveValue('')
  expect(screen.queryByText(setup.recovery_key)).not.toBeInTheDocument()
})

test('查询未完成申请只提示当前状态，不代替用户再次确认', async () => {
  const { api, setup } = fixture()
  api.personalOperation = vi.fn(async () => setup)
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await enterSaveStep()
  fireEvent.click(screen.getByRole('button', { name: '查询操作状态' }))
  expect(await screen.findByText('恢复密钥尚未启用。保存后点击“已保存，启用”；过期后可取消并重新验证身份。')).toBeInTheDocument()
  expect(api.confirmPersonalRecovery).not.toHaveBeenCalled()
})

test('等待确认期间拦截重复提交，关闭后迟到结果不能重新打开向导', async () => {
  const { api, setup } = fixture()
  let resolve!: (value: CloudPersonalRecoverySetup) => void
  vi.mocked(api.confirmPersonalRecovery).mockImplementation(() => new Promise(done => { resolve = done }))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await enterSaveStep()
  const confirm = screen.getByRole('button', { name: '已保存，启用' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  await waitFor(() => expect(api.confirmPersonalRecovery).toHaveBeenCalledOnce())
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
  await act(async () => { resolve({ ...setup, status: 'completed' }) })
  await waitFor(() => expect(screen.getByRole('button', { name: '设置恢复密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' }))
  expect(screen.getByLabelText('密码')).toHaveValue('')
  expect(screen.queryByText(setup.recovery_key)).not.toBeInTheDocument()
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
  const { api } = fixture()
  vi.mocked(api.confirmPersonalRecovery).mockRejectedValueOnce(new Error('SyntheticSecretDoNotDisplay'))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await enterSaveStep()
  fireEvent.click(screen.getByRole('button', { name: '已保存，启用' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(await screen.findByText('错误代码：local_failed')).toBeInTheDocument()
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

test('更换 Core 网关后，旧生成结果不能进入新向导或保留繁忙状态', async () => {
  const previous = fixture(), next = fixture()
  let resolve!: (value: CloudPersonalRecoverySetup) => void
  vi.mocked(previous.api.setupPersonalRecovery).mockImplementation(() => new Promise(done => { resolve = done }))
  const view = render(<AccountPersonalRecovery api={previous.api} status={status} busy={false} run={run} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '设置恢复密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' })); await generate()
  await waitFor(() => expect(resolve).toBeDefined())
  view.rerender(<AccountPersonalRecovery api={next.api} status={status} busy={false} run={run} />)
  await act(async () => { resolve(previous.setup) })
  await waitFor(() => expect(screen.getByRole('button', { name: '设置恢复密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '设置恢复密钥' }))
  expect(screen.getByLabelText('密码')).toHaveValue('')
  expect(screen.queryByRole('list', { name: '个人恢复密钥' })).not.toBeInTheDocument()
  expect(next.api.setupPersonalRecovery).not.toHaveBeenCalled()
})

test('更换完成后近期期限不可用才就地补验，失败保留待办且不重复提交恢复密钥', async () => {
  const { api } = fixture(true)
  vi.mocked(api.reauthenticate).mockRejectedValueOnce(new Error('network_unavailable'))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '更换并轮换数据密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '更换并轮换数据密钥' })); await generate()
  await screen.findByRole('button', { name: '已保存，启用' })
  expect(screen.queryByRole('list', { name: '个人恢复密钥' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '已保存，启用' }))
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

test('更换并轮换复用前段成功后的服务端验证期限，不要求再次输入证明', async () => {
  const { api } = fixture(true)
  vi.mocked(api.mfaStatus).mockResolvedValue({ server_time: new Date().toISOString(), enabled: false, revision: '0', backup_codes_remaining: 0, verified_until: new Date(Date.now() + 300_000).toISOString() })
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '更换并轮换数据密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '更换并轮换数据密钥' })); await generate()
  await screen.findByRole('button', { name: '已保存，启用' })
  fireEvent.click(screen.getByRole('button', { name: '已保存，启用' }))
  await waitFor(() => expect(api.rekey).toHaveBeenCalledExactlyOnceWith('fixture', 'start'))
  expect(api.reauthenticate).not.toHaveBeenCalled()
  expect(api.setupPersonalRecovery).toHaveBeenCalledOnce()
  expect(api.confirmPersonalRecovery).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: '开始轮换' })).not.toBeInTheDocument()
})

test('更换完成后的旧验证状态不能越过新的因子版本启动轮换', async () => {
  const { api, state } = fixture(true)
  const original = await api.security('fixture')
  api.subscribeChanges = state.subscribeChanges
  let resolve!: (value: { server_time: string; enabled: boolean; revision: string; backup_codes_remaining: number; verified_until: string }) => void
  vi.mocked(api.mfaStatus).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '更换并轮换数据密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '更换并轮换数据密钥' })); await generate()
  await screen.findByRole('button', { name: '已保存，启用' })
  fireEvent.click(screen.getByRole('button', { name: '已保存，启用' }))
  await waitFor(() => expect(resolve).toBeDefined())
  vi.mocked(api.security).mockResolvedValue({ ...original, account: { ...original.account, mfa_enabled: true, mfa_revision: '1' } })
  await act(async () => { state.acceptEvent({ type: 'account', status, changes: ['mfa'], operations: [] }) })
  await act(async () => { resolve({ server_time: new Date().toISOString(), enabled: false, revision: '0', backup_codes_remaining: 0, verified_until: new Date(Date.now() + 300_000).toISOString() }) })
  const rotationButton = await screen.findByRole('button', { name: '开始轮换' })
  const dialog = within(rotationButton.closest('[role="dialog"]') as HTMLElement)
  expect(screen.getByText('错误代码：mfa_revision_conflict')).toBeInTheDocument()
  expect(dialog.getByLabelText('验证器验证码')).toHaveValue('')
  expect(api.rekey).not.toHaveBeenCalled()
  expect(api.setupPersonalRecovery).toHaveBeenCalledOnce()
  expect(api.confirmPersonalRecovery).toHaveBeenCalledOnce()
})

test('初次读取失败后补验成功，轮换暂时失败仍保留有效期限而不重复证明', async () => {
  const { api } = fixture(true)
  vi.mocked(api.mfaStatus).mockRejectedValueOnce(new Error('network_unavailable'))
  vi.mocked(api.rekey).mockRejectedValueOnce(new Error('network_unavailable'))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '更换并轮换数据密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '更换并轮换数据密钥' })); await generate()
  await screen.findByRole('button', { name: '已保存，启用' })
  fireEvent.click(screen.getByRole('button', { name: '已保存，启用' }))
  const rotationButton = await screen.findByRole('button', { name: '开始轮换' })
  const dialog = within(rotationButton.closest('[role="dialog"]') as HTMLElement)
  fireEvent.change(dialog.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(rotationButton)
  await waitFor(() => expect(api.rekey).toHaveBeenCalledOnce())
  await waitFor(() => expect(rotationButton).toBeEnabled())
  expect(dialog.queryByLabelText('密码')).not.toBeInTheDocument()
  fireEvent.click(rotationButton)
  await waitFor(() => expect(api.rekey).toHaveBeenCalledTimes(2))
  expect(api.reauthenticate).toHaveBeenCalledOnce()
  expect(api.confirmPersonalRecovery).toHaveBeenCalledOnce()
})

test('服务器认为组合验证已过期时清除本机期限，只补验轮换而不重做密钥更换', async () => {
  const { api } = fixture(true)
  vi.mocked(api.mfaStatus).mockResolvedValue({ server_time: new Date().toISOString(), enabled: false, revision: '0', backup_codes_remaining: 0, verified_until: new Date(Date.now() + 300_000).toISOString() })
  vi.mocked(api.rekey).mockRejectedValueOnce(new TermousApiError('reauthentication_required', 'CLOUD_OPERATION_FAILED', 409))
  render(<AccountPersonalRecovery api={api} status={status} busy={false} run={run} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '更换并轮换数据密钥' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '更换并轮换数据密钥' })); await generate()
  await screen.findByRole('button', { name: '已保存，启用' })
  fireEvent.click(screen.getByRole('button', { name: '已保存，启用' }))
  const rotationButton = await screen.findByRole('button', { name: '开始轮换' })
  const rotation = within(rotationButton.closest('[role="dialog"]') as HTMLElement)
  fireEvent.change(await rotation.findByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.click(rotationButton)
  await waitFor(() => expect(api.rekey).toHaveBeenCalledTimes(2))
  expect(api.reauthenticate).toHaveBeenCalledExactlyOnceWith('fixture', { password: 'synthetic-password' })
  expect(api.setupPersonalRecovery).toHaveBeenCalledOnce()
  expect(api.confirmPersonalRecovery).toHaveBeenCalledOnce()
})

test('重置验证结果不明时清除证明，查询结果不会自动执行切换', async () => {
  const { api } = fixture()
  const pending: CloudWorkspaceRestart = { server_time: new Date().toISOString(), id: 'restart_test', status: 'pending', revision: 1, source_workspace_id: 'workspace_old', target_workspace_id: 'workspace_new', expires_at: new Date(Date.now() + 600_000).toISOString(), email_sent: true, source_device_count: 4 }
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
  const verified: CloudWorkspaceRestart = { server_time: new Date().toISOString(), id: 'restart_realtime', status: 'verified', revision: 2, source_workspace_id: 'workspace_old', target_workspace_id: 'workspace_new', expires_at: new Date(Date.now() + 600_000).toISOString(), verified_until: new Date(Date.now() + 300_000).toISOString(), email_sent: true }
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

test.each(['cancelled', 'expired', 'invalidated'] as const)('已结束的重置申请展示真实状态，允许重新发起但不自动执行：%s', async (endState) => {
  const { api } = fixture()
  const ended: CloudWorkspaceRestart = { server_time: new Date().toISOString(), id: 'restart_ended', status: endState, revision: 3, source_workspace_id: 'workspace_old', target_workspace_id: 'workspace_new', expires_at: new Date(Date.now() - 600_000).toISOString(), email_sent: true }
  api.workspaceRestart = vi.fn(async () => ended)
  api.createWorkspaceRestart = vi.fn(async (): Promise<CloudWorkspaceRestart> => ({ ...ended, id: 'restart_new', status: 'pending', revision: 1, expires_at: new Date(Date.now() + 600_000).toISOString(), email_sent: false }))
  api.completeRestart = vi.fn()
  render(<AccountWorkspaceRestart api={api} status={status} busy={false} mfaEnabled={false} run={run} />)
  fireEvent.click(screen.getByRole('button', { name: '重新开始云同步' }))
  fireEvent.click(screen.getByRole('button', { name: '继续上次操作' }))
  expect(await screen.findByText(endState === 'cancelled' ? '已取消' : endState === 'expired' ? '已过期' : '已失效')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '取消申请' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '确认立即重新开始' })).not.toBeInTheDocument()
  const create = await screen.findByRole('button', { name: /创建重新开始申请/ })
  await waitFor(() => expect(create).toBeEnabled())
  expect(api.createWorkspaceRestart).not.toHaveBeenCalled()
  fireEvent.click(create)
  expect(await screen.findByLabelText('邮件中的确认码')).toHaveValue('')
  expect(screen.getByRole('button', { name: '验证身份' })).toBeDisabled()
  expect(api.completeRestart).not.toHaveBeenCalled()
})

test.each([false, true])('只有本机绑定待完成的已切换申请提供补完操作：%s', async (localPending) => {
  const { api } = fixture()
  const completed: CloudWorkspaceRestart = { server_time: new Date().toISOString(), id: 'restart_completed', status: 'completed', revision: 3, source_workspace_id: 'workspace_old', target_workspace_id: 'workspace_new', expires_at: new Date(Date.now() - 600_000).toISOString(), email_sent: true, local_pending: localPending }
  api.workspaceRestart = vi.fn(async () => completed)
  api.completeRestart = vi.fn(async () => ({ ...completed, local_pending: false }))
  render(<AccountWorkspaceRestart api={api} status={status} busy={false} mfaEnabled={false} run={run} />)
  fireEvent.click(screen.getByRole('button', { name: '重新开始云同步' }))
  fireEvent.click(screen.getByRole('button', { name: '继续上次操作' }))
  if (localPending) {
    const finish = await screen.findByRole('button', { name: '继续完成本机绑定' })
    await waitFor(() => expect(finish).toBeEnabled())
    fireEvent.click(finish)
    await waitFor(() => expect(api.completeRestart).toHaveBeenCalledWith('fixture', completed.id, 3))
  }
  expect(await screen.findByText('新工作区已建立，请先设置恢复保障')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '继续完成本机绑定' })).not.toBeInTheDocument()
  expect(api.completeRestart).toHaveBeenCalledTimes(localPending ? 1 : 0)
})

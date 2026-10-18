import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, onTestFinished, test, vi } from 'vitest'
import type { CloudAuthorization, CloudDevice, CloudRekeyStatus, CloudSecurityOverview, CloudSession, CloudStatus } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { changeLanguage } from '#shared/i18n'
import { AccountDevices } from './AccountDevices'
import { AccountSecurity } from './AccountSecurity'

beforeAll(async () => { await changeLanguage('zh-CN') })
const status: CloudStatus = { revision: 1, generation: 'fixture', authenticated: true, configured: true, phase: 'ready', device_status: 'active', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
const run = async <T,>(action: () => Promise<T>) => action()
function gateway(overrides: Partial<CloudGateway> = {}) {
  const state = new CloudState()
  state.accept(status)
  return { getStatus: state.snapshot, subscribeStatus: state.subscribe, mfaStatus: vi.fn(async () => ({ enabled: false, revision: '0', backup_codes_remaining: 0 })), devices: vi.fn(async () => []), sessions: vi.fn(async () => []), rekeyStatus: vi.fn(async () => ({ status: '', completed: 0, total: 0 })), ...overrides } as CloudGateway
}

test('二步验证状态尚未返回时不发读取失败消息，真正失败才提示', async () => {
  let reject!: (cause: Error) => void
  const api = gateway({ mfaStatus: () => new Promise((_, failed) => { reject = failed }) })
  render(<AccountSecurity api={api} status={status} busy={false} run={run} />)
  await screen.findByText('当前没有进行中的密钥轮换。')
  expect(screen.queryByText('无法读取二步验证状态，请刷新重试。')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '验证身份' })).toBeDisabled()
  await act(async () => { reject(new Error('network_unavailable')) })
  expect(await screen.findByText('无法读取二步验证状态，请刷新重试。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '验证身份' })).toBeDisabled()
})

test('设备、会话和轮换分别显示加载状态，完成读取后才显示空态', async () => {
  let devices!: (value: CloudDevice[]) => void
  let sessions!: (value: CloudSession[]) => void
  let rekey!: (value: CloudRekeyStatus) => void
  const api = gateway({ devices: () => new Promise((done) => { devices = done }), sessions: () => new Promise((done) => { sessions = done }), rekeyStatus: () => new Promise((done) => { rekey = done }) })
  render(<><AccountDevices api={api} status={status} busy={false} run={run} /><AccountSecurity api={api} status={status} busy={false} run={run} /></>)
  expect(screen.getAllByRole('status', { name: '正在加载…' })).toHaveLength(3)
  expect(screen.queryByText('暂无已登记设备')).not.toBeInTheDocument()
  expect(screen.queryByText('暂无登录会话')).not.toBeInTheDocument()
  await act(async () => { devices([]); sessions([]); rekey({ status: '', completed: 0, total: 0 }) })
  expect(screen.queryByRole('status', { name: '正在加载…' })).not.toBeInTheDocument()
  expect(screen.getByText('暂无已登记设备')).toBeInTheDocument()
  expect(screen.getByText('暂无登录会话')).toBeInTheDocument()
  expect(screen.getByText('当前没有进行中的密钥轮换。')).toBeInTheDocument()
})

test('独立刷新读取失败不伪报空列表，重试只刷新目标数据且保留输入', async () => {
  const api = gateway()
  vi.mocked(api.sessions).mockRejectedValueOnce(new Error('network_unavailable'))
  vi.mocked(api.rekeyStatus).mockRejectedValueOnce(new Error('network_unavailable'))
  render(<AccountSecurity api={api} status={status} busy={false} run={run} />)
  expect(await screen.findByText('登录会话加载失败，请刷新重试。')).toBeInTheDocument()
  expect(await screen.findByText('密钥轮换状态加载失败，请刷新重试。')).toBeInTheDocument()
  expect(screen.queryByText('暂无登录会话')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-draft' } })
  fireEvent.click(screen.getByRole('button', { name: '刷新会话' }))
  await screen.findByText('暂无登录会话')
  expect(api.sessions).toHaveBeenCalledTimes(2)
  expect(api.rekeyStatus).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('密码')).toHaveValue('synthetic-draft')
  expect(screen.getByText('密钥轮换状态加载失败，请刷新重试。')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
  await waitFor(() => expect(screen.queryByText('密钥轮换状态加载失败，请刷新重试。')).not.toBeInTheDocument())
})

test('已撤销设备可查看列表，不提供批准新设备的操作', async () => {
  const api = gateway()
  render(<AccountDevices api={api} status={{ ...status, device_status: 'revoked' }} busy={false} run={run} />)
  const list = within(screen.getByRole('region', { name: '已登记设备' }))
  expect(await list.findByText('暂无已登记设备')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '批准新设备' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '核对设备' })).not.toBeInTheDocument()
})

test('设备表格保留撤销权限和验证步骤，读取失败时保留已有设备', async () => {
  // @rc-component/util 在 test 环境将所有标题 ID 固定为 test-id，隐藏的重命名弹窗会抢占撤销标题。
  // 此用例使用真实 React useId 路径，仍校验撤销弹窗的可访问名称和密码验证。
  vi.stubEnv('NODE_ENV', 'development')
  onTestFinished(() => { vi.unstubAllEnvs() })
  const current = { ...status, device_id: 'current' }
  const overview: CloudSecurityOverview = {
    account: { contract: 'cloud-recovery-safeguards-v1', managed_recovery: false, mfa_enabled: false, mfa_revision: '0', recovery_required: false, recovery_ready: true, personal_recovery_enabled: false, archive_available: false },
    keys_verified: true, membership_initialized: true,
    recovery: { available: false, reason: 'not_enabled', policy: { workspace_id: 'workspace', status: 'disabled', revision: '0', updated_at: '2026-10-07T00:00:00Z' } },
  }
  const devices: CloudDevice[] = ['current', 'active', 'pending', 'revoked'].map(id => ({
    id, user_id: 'fixture-user', name: `合成设备 ${id}`, status: id === 'pending' ? 'pending' : id === 'revoked' ? 'revoked' : 'active', created_at: id === 'revoked' ? '' : '2026-10-07T00:00:00Z', signing_key: '', recipient: '',
  }))
  const api = gateway({ getStatus: () => current, security: vi.fn(async () => overview), deviceRequests: vi.fn(async () => []), recoveryOperations: vi.fn(async () => []), devices: vi.fn(async () => devices), revokeDevice: vi.fn(async () => {}) })
  render(<AccountDevices api={api} status={current} busy={false} run={run} />)
  const list = within(screen.getByRole('region', { name: '已登记设备' }))
  const table = within(await list.findByRole('table'))
  const rows = table.getAllByRole('row')
  const row = (id: string) => within(rows.find(item => item.textContent?.includes(`合成设备 ${id}`))!)
  expect(table.getByRole('columnheader', { name: '授权状态' })).toBeInTheDocument()
  expect(row('current').queryByRole('button', { name: '撤销' })).not.toBeInTheDocument()
  const revoke = row('active').getByRole('button', { name: '撤销' })
  await waitFor(() => expect(revoke).toBeEnabled())
  expect(row('pending').getByRole('button', { name: '撤销' })).toBeDisabled()
  expect(row('revoked').getByRole('button', { name: '撤销' })).toBeDisabled()
  expect(row('revoked').getByText('—')).toBeInTheDocument()
  fireEvent.click(revoke)
  const dialog = await screen.findByRole('dialog', { name: '撤销' })
  expect(within(dialog).getByLabelText('密码')).toBeInTheDocument()
  expect(api.revokeDevice).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  vi.mocked(api.devices).mockRejectedValueOnce(new Error('network_unavailable'))
  fireEvent.click(list.getByRole('button', { name: '刷新' }))
  expect(await screen.findByText('设备列表加载失败，请刷新重试。')).toBeInTheDocument()
  expect(list.getByText('合成设备 active')).toBeInTheDocument()
  expect(list.queryByText('暂无已登记设备')).not.toBeInTheDocument()
})

test('授权申请读取失败时显示重试提示，不伪报暂无待处理申请', async () => {
  const api = gateway({ deviceRequests: vi.fn(async () => { throw new Error('network_unavailable') }) })
  render(<AccountDevices api={api} status={status} busy={false} run={run} />)
  expect(await screen.findByText('暂时无法读取授权状态')).toBeInTheDocument()
  expect(screen.queryByText('暂无待处理申请')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /重\s*试/ })).toBeInTheDocument()
})

test('撤销后重新登录的待授权设备可主动申请可信批准，无需先开启云端恢复', async () => {
  const pending: CloudStatus = { ...status, device_id: 'retained-device', device_status: 'pending' }
  const overview: CloudSecurityOverview = {
    account: { contract: 'cloud-recovery-safeguards-v1', managed_recovery: true, mfa_enabled: false, mfa_revision: '0', workspace_id: 'workspace', recovery_required: false, recovery_ready: false, personal_recovery_enabled: false, archive_available: false },
    keys_verified: false, membership_initialized: true,
    recovery: { available: false, reason: 'not_enabled', policy: { workspace_id: 'workspace', status: 'disabled', revision: '0', updated_at: new Date().toISOString() } },
  }
  const request: CloudAuthorization = {
    id: 'new-request', workspace_id: 'workspace', device_id: pending.device_id!, kind: 'approval', status: 'pending', revision: '1',
    name: 'Termous Desktop', platform: 'Windows', source_summary: '', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 600_000).toISOString(),
    target_confirmed: false, keys_verified: false, allowed_actions: ['cancel'],
  }
  const api = gateway({ getStatus: () => pending, security: vi.fn(async () => overview), deviceRequests: vi.fn(async () => []), recoveryOperations: vi.fn(async () => []), createDeviceRequest: vi.fn(async () => request) })
  render(<AccountDevices api={api} status={pending} busy={false} run={run} />)
  const approve = screen.getByRole('button', { name: '使用可信设备批准' })
  await waitFor(() => expect(approve).toBeEnabled())
  expect(api.createDeviceRequest).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '使用云端恢复' })).toBeDisabled()
  expect(screen.queryByText('授权状态暂时不可用，请重新读取')).not.toBeInTheDocument()
  fireEvent.click(approve)
  await waitFor(() => expect(api.createDeviceRequest).toHaveBeenCalledWith(pending.generation))
})

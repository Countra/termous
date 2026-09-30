import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudDevice, CloudRekeyStatus, CloudSession, CloudStatus } from '#common/contracts'
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

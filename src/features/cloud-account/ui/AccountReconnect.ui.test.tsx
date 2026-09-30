import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudDevice, CloudSession, CloudStatus } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { changeLanguage } from '#shared/i18n'
import { AccountDevices } from './AccountDevices'
import { AccountSecurity } from './AccountSecurity'

beforeAll(async () => { await changeLanguage('zh-CN') })
const ready: CloudStatus = { revision: 1, generation: 'fixture', configured: true, authenticated: true, user_id: 'fixture', phase: 'ready', device_status: 'active', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
const device = (name: string): CloudDevice => ({ id: name, name, user_id: 'fixture', signing_key: '', recipient: '', status: 'active', created_at: '2026-09-30T00:00:00Z' })
const session = (id: string): CloudSession => ({ id, device_id: id, created_at: '2026-09-30T00:00:00Z', expires_at: '2026-10-01T00:00:00Z', revoked: false })
const run = async <T,>(action: () => Promise<T>) => action()
function gateway(overrides: Partial<CloudGateway> = {}) {
  const state = new CloudState()
  state.accept(ready)
  const api = { getStatus: state.snapshot, subscribeStatus: state.subscribe, devices: vi.fn(async () => [device('设备已更新')]), sessions: vi.fn(async () => [session('会话已更新')]), rekeyStatus: vi.fn(async () => ({ status: 'staging', completed: 2, total: 5 })), auth: vi.fn(), rekey: vi.fn(), ...overrides } as CloudGateway
  const reconnect = () => {
    const revision = state.snapshot()!.revision
    state.accept({ ...ready, revision: revision + 1, phase: 'blocked', error_code: 'network_unavailable' })
    state.accept({ ...ready, revision: revision + 2 })
  }
  return { api, state, reconnect }
}

test('重连自动恢复设备、会话和轮换状态，保留配对与密码输入且不执行写操作', async () => {
  const { api, reconnect } = gateway()
  vi.mocked(api.devices).mockRejectedValueOnce(new Error('network_unavailable'))
  vi.mocked(api.sessions).mockRejectedValueOnce(new Error('network_unavailable'))
  vi.mocked(api.rekeyStatus).mockRejectedValueOnce(new Error('network_unavailable'))
  render(<><AccountDevices api={api} status={ready} busy={false} run={run} /><AccountSecurity api={api} status={ready} busy={false} run={run} /></>)
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(4))
  fireEvent.change(screen.getByLabelText('生成配对请求'), { target: { value: '尚未提交的配对内容' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'synthetic-draft' } })
  act(reconnect)
  expect(await screen.findByText('设备已更新', { selector: 'strong' })).toBeInTheDocument()
  expect(await screen.findByText('会话已更新', { selector: 'strong' })).toBeInTheDocument()
  expect(await screen.findByText(new RegExp('2 / 5'))).toBeInTheDocument()
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(screen.getByLabelText('生成配对请求')).toHaveValue('尚未提交的配对内容')
  expect(screen.getByLabelText('密码')).toHaveValue('synthetic-draft')
  expect(api.devices).toHaveBeenCalledTimes(2)
  expect(api.sessions).toHaveBeenCalledTimes(2)
  expect(api.rekeyStatus).toHaveBeenCalledTimes(2)
  expect(api.auth).not.toHaveBeenCalled()
  expect(api.rekey).not.toHaveBeenCalled()
})

test('恢复期间迟到的旧列表响应不能覆盖新设备和新会话', async () => {
  let finishDevices!: (items: CloudDevice[]) => void
  let finishSessions!: (items: CloudSession[]) => void
  const { api, reconnect } = gateway()
  vi.mocked(api.devices).mockImplementationOnce(() => new Promise((done) => { finishDevices = done }))
  vi.mocked(api.sessions).mockImplementationOnce(() => new Promise((done) => { finishSessions = done }))
  render(<><AccountDevices api={api} status={ready} busy={false} run={run} /><AccountSecurity api={api} status={ready} busy={false} run={run} /></>)
  act(reconnect)
  await screen.findByText('设备已更新', { selector: 'strong' })
  await screen.findByText('会话已更新', { selector: 'strong' })
  await act(async () => { finishDevices([device('旧设备')]); finishSessions([session('旧会话')]) })
  expect(screen.queryByText('旧设备', { selector: 'strong' })).not.toBeInTheDocument()
  expect(screen.queryByText('旧会话', { selector: 'strong' })).not.toBeInTheDocument()
})

test('会话刷新成功不能掩盖轮换读取失败，下一次恢复分别清除错误', async () => {
  const { api, reconnect } = gateway()
  vi.mocked(api.rekeyStatus).mockRejectedValueOnce(new Error('network_unavailable'))
  render(<AccountSecurity api={api} status={ready} busy={false} run={run} />)
  await screen.findByText('会话已更新', { selector: 'strong' })
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
  act(reconnect)
  await screen.findByText(new RegExp('2 / 5'))
  expect(screen.getAllByRole('alert')).toHaveLength(1)
})

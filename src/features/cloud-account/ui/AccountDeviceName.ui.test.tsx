import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { changeLanguage } from '#shared/i18n'
import type { CloudDevice, CloudStatus } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { AccountDeviceName } from './AccountDeviceName'

beforeAll(async () => { await changeLanguage('zh-CN') })
const device: CloudDevice = { id: 'mine', user_id: 'owner', name: 'Termous Desktop', name_revision: '0', signing_key: 'key', recipient: 'recipient', status: 'active', created_at: '2026-10-08T00:00:00Z' }
const status: CloudStatus = { generation: 'account', revision: 1, configured: true, authenticated: true, phase: 'ready', confirmed: false, auto_sync: false, pending: 0, conflicts: 0, device_id: 'mine', device_status: 'active' }
const run = async <T,>(action: () => Promise<T>) => { try { return await action() } catch { return undefined } }
function fixture() {
  const state = new CloudState()
  state.accept(status)
  const updateDeviceName = vi.fn<CloudGateway['updateDeviceName']>(async () => ({ ...device, name: '工作电脑', name_revision: '1' }))
  const devices = vi.fn(async () => [device])
  const api = { getStatus: state.snapshot, updateDeviceName, devices } as unknown as CloudGateway
  return { api, state, updateDeviceName, devices }
}

test('空名称不提交，保存裁剪首尾空白并保留名称版本', async () => {
  const { api, updateDeviceName } = fixture()
  const onChanged = vi.fn()
  render(<AccountDeviceName api={api} generation="account" device={device} busy={false} run={run} onChanged={onChanged} />)
  fireEvent.click(screen.getByRole('button', { name: '编辑名称' }))
  const input = await screen.findByLabelText('设备名称')
  await waitFor(() => expect(screen.getByRole('button', { name: '保存名称' })).toBeDisabled())
  fireEvent.change(input, { target: { value: '　 ' } })
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
  await screen.findByText('请输入 1–100 个字符，不能包含控制字符。')
  expect(updateDeviceName).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: ' 工作电脑 ' } })
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
  await waitFor(() => expect(updateDeviceName).toHaveBeenCalledWith('account', '工作电脑', '0'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onChanged).toHaveBeenCalledTimes(1)
})

test('后台刷新及冲突保留草稿，主动载入后才采用新版本', async () => {
  const { api, updateDeviceName, devices } = fixture()
  updateDeviceName.mockRejectedValueOnce(new Error('device_name_conflict'))
  const props = { api, generation: 'account', device, busy: false, run, onChanged: vi.fn() }
  const view = render(<AccountDeviceName {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '编辑名称' }))
  const input = await screen.findByLabelText('设备名称')
  fireEvent.change(input, { target: { value: '我的草稿' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '保存名称' })).toBeEnabled())
  view.rerender(<AccountDeviceName {...props} device={{ ...device, name: '另一个窗口', name_revision: '1' }} />)
  expect(input).toHaveValue('我的草稿')
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
  await screen.findByRole('button', { name: '载入最新名称' })
  expect(updateDeviceName).toHaveBeenCalledWith('account', '我的草稿', '0')
  expect(input).toHaveValue('我的草稿')
  devices.mockResolvedValue([{ ...device, name: '另一个窗口', name_revision: '1' }])
  fireEvent.click(screen.getByRole('button', { name: '载入最新名称' }))
  await waitFor(() => expect(input).toHaveValue('另一个窗口'))
  expect(screen.getByRole('button', { name: '保存名称' })).toBeDisabled()
  fireEvent.change(input, { target: { value: '更新后的草稿' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '保存名称' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
  await waitFor(() => expect(updateDeviceName).toHaveBeenLastCalledWith('account', '更新后的草稿', '1'))
})

test('切换账号丢弃迟到结果，重复提交只发送一次', async () => {
  const { api, state, updateDeviceName } = fixture()
  let resolve!: (value: CloudDevice) => void
  updateDeviceName.mockImplementation(() => new Promise(done => { resolve = done }))
  const props = { api, generation: 'account', device, busy: false, run, onChanged: vi.fn() }
  const view = render(<AccountDeviceName {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '编辑名称' }))
  const input = await screen.findByLabelText('设备名称')
  fireEvent.change(input, { target: { value: '工作电脑' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '保存名称' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
  await waitFor(() => expect(updateDeviceName).toHaveBeenCalledTimes(1))
  act(() => { state.accept({ ...status, generation: 'next', revision: 2 }) })
  view.rerender(<AccountDeviceName {...props} generation="next" />)
  await act(async () => { resolve(device) })
  expect(props.onChanged).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test.each(['revoked', 'reauthentication', 'missing-revision'] as const)('编辑期间失去编辑条件会关闭面板：%s', async reason => {
  const { api, state, updateDeviceName } = fixture()
  const props = { api, generation: 'account', device, busy: false, run, onChanged: vi.fn() }
  const view = render(<AccountDeviceName {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '编辑名称' }))
  fireEvent.change(await screen.findByLabelText('设备名称'), { target: { value: '未提交草稿' } })
  act(() => { state.accept({ ...status, revision: 2, authenticated: reason !== 'reauthentication', device_status: reason === 'revoked' ? 'revoked' : 'active' }) })
  view.rerender(<AccountDeviceName {...props} device={reason === 'missing-revision' ? { ...device, name_revision: undefined } : device} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: '编辑名称' })).toBeDisabled()
  expect(updateDeviceName).not.toHaveBeenCalled()
})

test('账号失效后迟到的名称补读不能重新打开面板', async () => {
  const { api, state, updateDeviceName, devices } = fixture()
  updateDeviceName.mockRejectedValueOnce(new Error('device_name_conflict'))
  const props = { api, generation: 'account', device, busy: false, run, onChanged: vi.fn() }
  const view = render(<AccountDeviceName {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '编辑名称' }))
  fireEvent.change(await screen.findByLabelText('设备名称'), { target: { value: '保留草稿' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '保存名称' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
  await screen.findByRole('button', { name: '载入最新名称' })
  let resolve!: (value: CloudDevice[]) => void
  devices.mockImplementation(() => new Promise(done => { resolve = done }))
  fireEvent.click(screen.getByRole('button', { name: '载入最新名称' }))
  await waitFor(() => expect(devices).toHaveBeenCalledTimes(1))
  act(() => { state.accept({ ...status, revision: 2, authenticated: false }) })
  view.rerender(<AccountDeviceName {...props} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await act(async () => { resolve([{ ...device, name: '新的名称', name_revision: '1' }]) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '编辑名称' })).toBeDisabled()
})

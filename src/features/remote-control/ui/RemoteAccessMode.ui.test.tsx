import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeAll, expect, test, vi } from 'vitest'
import type { RemoteLauncher } from '#common/contracts'
import { changeLanguage } from '#shared/i18n'
import { policyGateway } from '../../../test/remotePolicyEditor'
import { RemoteAccountAccess } from './RemoteAccountAccess'

const bridge = vi.hoisted(() => ({ current: undefined as RemoteLauncher | undefined }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ remoteControl: bridge.current }) }))
beforeAll(async () => { await changeLanguage('zh-CN') })
function view() { return <ConfigProvider theme={{ token: { motion: false } }} button={{ autoInsertSpace: false }}><RemoteAccountAccess generation="account" currentDevice="current" trusted>{() => null}</RemoteAccountAccess></ConfigProvider> }
async function open() { fireEvent.click(screen.getByRole('button', { name: '管理访问范围' })); await screen.findByRole('radio', { name: '完全控制' }) }

test('实际启用完全控制时确认一次，模式往返保持自定义范围且不关闭弹窗', async () => {
  const { api } = policyGateway({ hosts: [{ id: 'build', terminal_file_access: true }] })
  bridge.current = api; render(view()); await open()
  fireEvent.click(screen.getByRole('radio', { name: '完全控制' }))
  await screen.findByText('允许完全控制？')
  expect(api.changePolicy).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '允许' }))
  await waitFor(() => expect(api.changePolicy).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByRole('radio', { name: '自定义' })).toBeEnabled())
  fireEvent.click(screen.getByRole('radio', { name: '自定义' }))
  await waitFor(() => expect(api.changePolicy).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('checkbox', { name: '构建主机' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '生产主机' })).not.toBeChecked()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

test('总开关关闭时切换模式不提前授权，开启完全控制才确认', async () => {
  const { api } = policyGateway({ enabled: false })
  bridge.current = api; render(view()); await open()
  fireEvent.click(screen.getByRole('radio', { name: '完全控制' }))
  await waitFor(() => expect(api.changePolicy).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('允许完全控制？')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('switch', { name: '允许远程控制' }))
  await screen.findByText('允许完全控制？'); fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(api.changePolicy).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('switch', { name: '允许远程控制' })).not.toBeChecked()
})

test('设备桌面权限依赖原子提交，关闭观看一并撤销控制与安全桌面', async () => {
  const { api } = policyGateway({ host_desktop: { observe: true, control: true, secure_capture: true, secure_control: true } })
  bridge.current = api; render(view()); await open()
  fireEvent.click(screen.getByRole('tab', { name: /设备桌面/ }))
  fireEvent.click(screen.getByRole('switch', { name: '允许观看设备桌面' }))
  await waitFor(() => expect(api.changePolicy).toHaveBeenCalledWith('account', expect.any(String), 4, { kind: 'host_desktop', host_desktop: { observe: false, control: false, secure_capture: false, secure_control: false } }))
  expect(screen.getByRole('switch', { name: '允许控制鼠标和键盘' })).toBeDisabled()
  expect(within(screen.getByRole('dialog')).queryByText('立即生效')).not.toBeInTheDocument()
})

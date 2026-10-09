import { App as AntdApp, ConfigProvider } from 'antd'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { i18n } from '#shared/i18n'
import { RemoteDesktopServerVerificationDialog } from './RemoteDesktopServerVerificationDialog'

const mock = vi.hoisted(() => ({
  approveServer: vi.fn(), rejectServer: vi.fn(), copy: vi.fn(),
  viewerStates: {} as Record<string, { connection: string; verification: { type: string; fingerprint: string } | null }>,
}))
vi.mock('#features/remote-desktop', () => ({ useRemoteDesktopRuntime: () => mock }))
vi.mock('#shared/clipboard', () => ({ writeClipboardText: mock.copy }))

const fingerprint = '0123456789abcdef'.repeat(4)
const session: RemoteDesktopSession = {
  id: 'desktop', profile_id: 'profile', profile_name: 'Windows desktop', host_id: 'host', host_name: 'Windows',
  route: 'direct', route_config_version: 1, protocol: 'rdp', protocol_config_version: 1,
  rdp: { target_host: '192.0.2.22', port: 3389, server_name: '192.0.2.22', username: 'test-user', domain: '', width: 1920, height: 1080, audio: true, default_view_only: false, default_display_mode: 'fit' },
  vnc: { target_host: '192.0.2.22', port: 5900, shared: true, default_view_only: false, default_display_mode: 'fit' },
  status: 'waiting_host_trust', phase: 'waiting_host_trust', connection_generation: 1, viewer_attached: false,
  certificate: { challenge_id: 'certificate-one', server_name: '192.0.2.22', subject: 'CN=DESKTOP-TEST', fingerprint },
  created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z',
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  mock.approveServer.mockReset().mockResolvedValue(undefined)
  mock.rejectServer.mockReset().mockResolvedValue(undefined)
  mock.copy.mockReset().mockResolvedValue(undefined)
  mock.viewerStates = { desktop: { connection: 'verifying_server', verification: { type: 'RDP TLS', fingerprint } } }
})

const dialog = (value = session) => <ConfigProvider theme={{ token: { motion: false } }}><AntdApp><RemoteDesktopServerVerificationDialog session={value} /></AntdApp></ConfigProvider>

test('RDP 身份信息完整展示，复制保留原始指纹且默认仅信任本次会话', async () => {
  render(dialog())
  await waitFor(() => expect(screen.getByRole('dialog', { name: '验证 RDP 服务器身份' })).toBeVisible())
  expect(screen.getByText('192.0.2.22:3389')).toBeVisible()
  expect(screen.getByText('CN=DESKTOP-TEST')).toBeVisible()
  expect(screen.getByText(fingerprint)).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '复制指纹' }))
  await waitFor(() => expect(mock.copy).toHaveBeenCalledWith(fingerprint))
  fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
  await waitFor(() => expect(mock.approveServer).toHaveBeenCalledWith('desktop', false))
})

test('VNC 仍显示自身协议且不提供持久化证书选项', async () => {
  render(dialog({ ...session, protocol: 'vnc', certificate: undefined, status: 'streaming' }))
  await waitFor(() => expect(screen.getByRole('dialog', { name: '验证 VNC 服务器身份' })).toBeVisible())
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.getByText('本次确认仅在当前会话中有效。')).toBeVisible()
})

test('新挑战不会沿用上一证书的记住选项', () => {
  const view = render(dialog())
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('checkbox')).toBeChecked()
  view.rerender(dialog({ ...session, certificate: { ...session.certificate!, challenge_id: 'certificate-two' } }))
  expect(screen.getByRole('checkbox')).not.toBeChecked()
})

test('验证名称与连接地址不同时同时展示，避免将名称误显示为实际连接地址', () => {
  render(dialog({ ...session, certificate: { ...session.certificate!, server_name: 'desktop.example.test' } }))
  expect(screen.getByText('192.0.2.22:3389')).toBeInTheDocument()
  expect(screen.getByText('desktop.example.test')).toBeInTheDocument()
})

test('拒绝请求未完成时阻止重复提交与反向确认，失败后允许重试', async () => {
  let reject!: (reason: Error) => void
  mock.rejectServer.mockReturnValueOnce(new Promise<void>((_, fail) => { reject = fail }))
  render(dialog())
  const cancel = screen.getByRole('button', { name: '拒绝连接' })
  fireEvent.click(cancel)
  fireEvent.click(cancel)
  expect(mock.rejectServer).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '确认并继续' })).toBeDisabled()
  await act(async () => reject(new Error('synthetic close failure')))
  expect(await screen.findByText('synthetic close failure')).toBeVisible()
  expect(cancel).not.toBeDisabled()
})

test('终止状态即使残留证书也不显示确认弹窗', () => {
  const view = render(dialog({ ...session, status: 'stopping', phase: 'stopping' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  view.rerender(dialog({ ...session, status: 'failed', phase: 'failed' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

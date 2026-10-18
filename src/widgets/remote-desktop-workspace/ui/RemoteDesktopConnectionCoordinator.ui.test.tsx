import { App as AntdApp, ConfigProvider } from 'antd'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { RemoteDesktopViewerState } from '#features/remote-desktop'
import { i18n } from '#shared/i18n'
import { RemoteDesktopConnectionCoordinator } from './RemoteDesktopConnectionCoordinator'

const runtime = vi.hoisted(() => ({
  sessions: [] as RemoteDesktopSession[],
  viewerStates: {} as Record<string, RemoteDesktopViewerState>,
  activeSessionId: null as string | null,
  hiddenSessionIds: [] as string[],
  approveServer: vi.fn(), rejectServer: vi.fn(), submitCredentials: vi.fn(), closeSession: vi.fn(),
}))
vi.mock('#features/remote-desktop', () => ({ useRemoteDesktopRuntime: () => runtime }))

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  runtime.sessions = []
  runtime.viewerStates = {}
  runtime.activeSessionId = null
  runtime.hiddenSessionIds = []
  for (const method of [runtime.approveServer, runtime.rejectServer, runtime.submitCredentials, runtime.closeSession]) {
    method.mockReset().mockResolvedValue(undefined)
  }
})

function addSession(id: string, kind: 'verification' | 'credentials' = 'verification', protocol: 'rdp' | 'vnc' = 'rdp') {
  const session: RemoteDesktopSession = {
    id, profile_id: `profile-${id}`, profile_name: `测试连接 ${id}`, host_id: 'host', host_name: '测试主机',
    protocol, protocol_config_version: 1, route: 'direct', route_config_version: 1,
    rdp: { target_host: '192.0.2.22', port: 3389, server_name: 'test.example', username: '', domain: '', width: 1280, height: 720, audio: false, default_view_only: false, default_display_mode: 'fit' },
    vnc: { target_host: '192.0.2.23', port: 5900, shared: true, default_view_only: false, default_display_mode: 'fit' },
    status: kind === 'verification' ? 'waiting_host_trust' : 'connecting', phase: 'waiting_host_trust',
    certificate: { challenge_id: `challenge-${id}`, fingerprint: `fingerprint-${id}`, server_name: 'test.example', subject: `CN=${id}` },
    connection_generation: 1, viewer_attached: false,
    created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
  }
  runtime.sessions.push(session)
  runtime.viewerStates[id] = {
    connection: kind === 'verification' ? 'verifying_server' : 'credentials_required',
    verification: kind === 'verification' ? { type: protocol.toUpperCase(), fingerprint: `fingerprint-${id}` } : null,
    credentialFields: kind === 'credentials' ? [{ id: 'password', kind: 'secret', required: true }] : [],
    displayMode: 'fit', viewOnly: false, desktopName: '', remoteClipboard: '', capabilities: { power: false }, targetLabel: '', errorCode: '',
  }
  return session
}

function tree(blocked = false, onBlockingChange?: (blocking: boolean) => void) {
  return <ConfigProvider theme={{ token: { motion: false } }}><AntdApp>
    <RemoteDesktopConnectionCoordinator blocked={blocked} onBlockingChange={onBlockingChange} />
  </AntdApp></ConfigProvider>
}

test('没有桌面页面、没有活动观看入口也提示后台连接，确认默认仅本次', async () => {
  const session = addSession('background')
  runtime.hiddenSessionIds = [session.id]
  render(tree())
  await waitFor(() => expect(screen.getByRole('dialog', { name: '验证 RDP 服务器身份' })).toBeVisible())
  expect(screen.getByText('CN=background')).toBeVisible()
  expect(runtime.approveServer).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
  await waitFor(() => expect(runtime.approveServer).toHaveBeenCalledWith(session.id, false))
})

test('多个等待连接只显示一个，新请求和活动标签变化不抢占当前确认，完成后继续队列', async () => {
  const first = addSession('first')
  const view = render(tree())
  fireEvent.click(screen.getByRole('checkbox'))
  const second = addSession('second')
  runtime.sessions = [second, first]
  runtime.activeSessionId = second.id
  view.rerender(tree())
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  await waitFor(() => expect(screen.getByText('CN=first')).toBeVisible())
  expect(screen.getByRole('checkbox')).toBeChecked()
  runtime.viewerStates[first.id] = { ...runtime.viewerStates[first.id], connection: 'connecting', verification: null }
  view.rerender(tree())
  await waitFor(() => expect(screen.getByText('CN=second')).toBeVisible())
  expect(screen.getByRole('checkbox')).not.toBeChecked()
})

test.each(['challenge', 'generation'] as const)('%s 更新清除旧确认选择，会话结束移除提示并解除审批阻塞', (change) => {
  const session = addSession('one')
  const blocking = vi.fn()
  const view = render(tree(false, blocking))
  expect(blocking).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByRole('checkbox'))
  runtime.sessions = [{ ...session,
    connection_generation: change === 'generation' ? 2 : 1,
    certificate: { ...session.certificate!, challenge_id: change === 'challenge' ? 'next-challenge' : session.certificate!.challenge_id },
  }]
  view.rerender(tree(false, blocking))
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  runtime.sessions = []
  view.rerender(tree(false, blocking))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(blocking).toHaveBeenLastCalledWith(false)
})

test.each(['failed', 'stopping', 'reconnecting'] as const)('忽略 %s 会话的残留确认', (status) => {
  const first = addSession('first')
  const second = addSession('second', 'credentials')
  runtime.sessions = [first, second].map((session) => ({ ...session, status }))
  render(tree())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('SSH 身份确认暂时优先，返回后保留正在核对的证书选项', async () => {
  addSession('one')
  const blocking = vi.fn()
  const view = render(tree(false, blocking))
  fireEvent.click(screen.getByRole('checkbox'))
  view.rerender(tree(true, blocking))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(blocking).toHaveBeenLastCalledWith(true)
  view.rerender(tree(false, blocking))
  expect(screen.getByRole('checkbox')).toBeChecked()
  expect(runtime.approveServer).not.toHaveBeenCalled()
  view.unmount()
  expect(blocking).toHaveBeenLastCalledWith(false)
})

test.each(['rdp', 'vnc'] as const)('%s 后台凭据提示标明目标，防止重复提交及提交中断开', async (protocol) => {
  const session = addSession('auth', 'credentials', protocol)
  let complete!: () => void
  runtime.submitCredentials.mockReturnValue(new Promise<void>((resolve) => { complete = resolve }))
  render(tree())
  await waitFor(() => expect(screen.getByText(session.profile_name)).toBeVisible())
  expect(screen.getByText(protocol === 'rdp' ? '192.0.2.22:3389' : '192.0.2.23:5900', { exact: false })).toBeVisible()
  const input = document.querySelector<HTMLInputElement>('input[type="password"]')!
  fireEvent.change(input, { target: { value: 'synthetic-password' } })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 })
  expect(runtime.submitCredentials).toHaveBeenCalledExactlyOnceWith(session.id, { password: 'synthetic-password' })
  expect(screen.getByRole('button', { name: /断\s*开/ })).toBeDisabled()
  await act(async () => complete())
})

test('凭据同步异常可见，保留输入供重试；重连后不沿用旧凭据', async () => {
  const session = addSession('auth', 'credentials')
  runtime.submitCredentials.mockImplementationOnce(() => { throw new Error('synthetic credential failure') })
  const view = render(tree())
  const input = document.querySelector<HTMLInputElement>('input[type="password"]')!
  fireEvent.change(input, { target: { value: 'synthetic-password' } })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 })
  expect(await screen.findByText('synthetic credential failure')).toBeVisible()
  expect(input.value).toBe('synthetic-password')
  runtime.sessions = [{ ...session, connection_generation: 2 }]
  view.rerender(tree())
  expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('')
})

import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { ConnectionSettings as ConnectionSettingsValue } from '#common/contracts'
import { ConnectionSettings } from './ConnectionSettings'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const settings: ConnectionSettingsValue = {
  ssh_keepalive_enabled: false,
  forward_auto_reconnect_enabled: false,
  remote_desktop_auto_reconnect_enabled: true,
  rdp_unattended_timeout_minutes: 10,
}

test('连接可靠性开关只提交变动字段，避免覆盖其他待保存开关', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn(async () => undefined)
  const { rerender } = render(
    <ConnectionSettings value={settings} disabled={false} onChange={onChange} />,
  )

  await user.click(screen.getByRole('switch', { name: 'settings.sshKeepalive' }))
  expect(onChange).toHaveBeenLastCalledWith({
    ssh_keepalive_enabled: true,
  })

  const keepaliveEnabled = { ...settings, ssh_keepalive_enabled: true }
  rerender(
    <ConnectionSettings value={keepaliveEnabled} disabled={false} onChange={onChange} />,
  )
  await user.click(screen.getByRole('switch', { name: 'settings.forwardAutoReconnect' }))
  expect(onChange).toHaveBeenLastCalledWith({
    forward_auto_reconnect_enabled: true,
  })

  expect(screen.queryByRole('switch', { name: 'settings.remoteDesktopAutoReconnect' })).not.toBeInTheDocument()
})

test('全局操作繁忙时禁用连接可靠性开关', () => {
  render(<ConnectionSettings value={settings} disabled onChange={vi.fn()} />)

  expect(screen.getByRole('switch', { name: 'settings.sshKeepalive' })).toBeDisabled()
  expect(screen.getByRole('switch', { name: 'settings.forwardAutoReconnect' })).toBeDisabled()
})

test('当前开关提交期间禁止重复操作，其他字段仍可独立操作', async () => {
  const user = userEvent.setup()
  let finish!: () => void
  const onChange = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  render(<ConnectionSettings value={settings} disabled={false} onChange={onChange} />)
  const control = screen.getByRole('switch', { name: 'settings.sshKeepalive' })
  await user.click(control)
  expect(control).toBeDisabled()
  expect(control).toHaveClass('ant-switch-loading')
  expect(screen.getByRole('switch', { name: 'settings.forwardAutoReconnect' })).toBeEnabled()
  await user.click(control)
  expect(onChange).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  expect(control).toBeEnabled()
})

test('连接设置保存失败显示错误并保留已确认的开关值', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn().mockRejectedValueOnce(new Error('fixture')).mockResolvedValue(undefined)
  render(<ConnectionSettings value={settings} disabled={false} onChange={onChange} />)
  const control = screen.getByRole('switch', { name: 'settings.sshKeepalive' })
  await user.click(control)
  expect(await screen.findByRole('alert')).toHaveTextContent('settings.connectionSaveFailed')
  expect(control).not.toBeChecked()
  await user.click(control)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(onChange).toHaveBeenCalledTimes(2)
})

test('连接可靠性开关关联各自的行为说明', () => {
  render(<ConnectionSettings value={settings} disabled={false} onChange={vi.fn()} />)

  expect(screen.getByRole('switch', { name: 'settings.sshKeepalive' }))
    .toHaveAccessibleDescription('settings.sshKeepaliveHint')
  expect(screen.getByRole('switch', { name: 'settings.forwardAutoReconnect' }))
    .toHaveAccessibleDescription('settings.forwardAutoReconnectHint')
})

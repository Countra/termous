import { render, screen } from '@testing-library/react'
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
}

test('连接可靠性开关分别提交完整设置', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn(async () => undefined)
  const { rerender } = render(
    <ConnectionSettings value={settings} disabled={false} onChange={onChange} />,
  )

  await user.click(screen.getByRole('switch', { name: 'settings.sshKeepalive' }))
  expect(onChange).toHaveBeenLastCalledWith({
    ssh_keepalive_enabled: true,
    forward_auto_reconnect_enabled: false,
  })

  const keepaliveEnabled = { ...settings, ssh_keepalive_enabled: true }
  rerender(
    <ConnectionSettings value={keepaliveEnabled} disabled={false} onChange={onChange} />,
  )
  await user.click(screen.getByRole('switch', { name: 'settings.forwardAutoReconnect' }))
  expect(onChange).toHaveBeenLastCalledWith({
    ssh_keepalive_enabled: true,
    forward_auto_reconnect_enabled: true,
  })
})

test('全局操作繁忙时禁用连接可靠性开关', () => {
  render(<ConnectionSettings value={settings} disabled onChange={vi.fn()} />)

  expect(screen.getByRole('switch', { name: 'settings.sshKeepalive' })).toBeDisabled()
  expect(screen.getByRole('switch', { name: 'settings.forwardAutoReconnect' })).toBeDisabled()
})

test('连接可靠性开关关联各自的行为说明', () => {
  render(<ConnectionSettings value={settings} disabled={false} onChange={vi.fn()} />)

  expect(screen.getByRole('switch', { name: 'settings.sshKeepalive' }))
    .toHaveAccessibleDescription('settings.sshKeepaliveHint')
  expect(screen.getByRole('switch', { name: 'settings.forwardAutoReconnect' }))
    .toHaveAccessibleDescription('settings.forwardAutoReconnectHint')
})

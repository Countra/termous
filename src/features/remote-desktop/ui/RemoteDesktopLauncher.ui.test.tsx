import { App as AntdApp } from 'antd'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { RemoteDesktopProfile } from '#entities/remote-desktop'
import type { Host } from '#entities/host'
import { RemoteDesktopLauncher } from './RemoteDesktopLauncher'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

test('脏草稿下双击配置会在确认后执行连接意图', async () => {
  const user = userEvent.setup()
  const onConnect = vi.fn(async () => undefined)
  const onClose = vi.fn()
  render(
    <AntdApp>
      <RemoteDesktopLauncher
        open
        profiles={[profile('rdp_a', 'Profile A'), profile('rdp_b', 'Profile B')]}
        hosts={[host()]}
        actionBusy={false}
        onClose={onClose}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onConnect={onConnect}
      />
    </AntdApp>,
  )

  await user.click(await screen.findByRole('button', { name: 'app.edit' }))
  const nameInput = screen.getByDisplayValue('Profile A')
  await user.clear(nameInput)
  await user.type(nameInput, 'Unsaved Profile')

  await user.dblClick(screen.getByRole('option', { name: /Profile B/ }))
  await user.click(await screen.findByRole('button', { name: 'remoteDesktop.discardDraft' }))

  expect(onConnect).toHaveBeenCalledTimes(1)
  expect(onConnect).toHaveBeenCalledWith('rdp_b')
  expect(onClose).toHaveBeenCalledTimes(1)
})

function profile(id: string, name: string): RemoteDesktopProfile {
  return {
    id,
    name,
    description: '',
    protocol: 'vnc',
    transport: 'ssh_tunnel',
    ssh_host_id: 'hst_test',
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    created_at: '2026-08-23T12:00:00Z',
    updated_at: '2026-08-23T12:00:00Z',
  }
}

function host(): Host {
  return {
    id: 'hst_test',
    name: 'Test host',
    platform: 'linux',
    group_id: 'grp_test',
    address: '127.0.0.1',
    port: 22,
    username: 'tester',
    auth_method: 'password',
    credential_id: 'cred_test',
    tags: [],
    favorite: false,
    fingerprint_policy: 'ask',
  }
}

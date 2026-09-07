import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Host } from '#entities/host'
import type { Session } from '#entities/session'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('antd', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
}))

vi.mock('#entities/host', () => ({ HostAvatar: () => null }))
vi.mock('#shared/ui', () => ({
  StatusBadge: () => null,
  WorkspaceEmptyState: () => null,
  uiStyles: {},
}))

import { WorkbenchConnectionOverview } from './WorkbenchConnectionOverview.tsx'

describe('工作台连接详情', () => {
  it('使用会话的精确 SSH Profile 展示连接端点', () => {
    const host = legacyHost()
    const sshProfile = profile()
    render(
      <WorkbenchConnectionOverview
        data={{
          hosts: [host],
          groups: [],
          proxies: [],
          credentials: [],
          sshAccessProfiles: [sshProfile],
        }}
        session={session()}
        actionBusy={false}
        sessionClosing={false}
        sessionBadgeStatus="connected"
        sessionStatusLabel="connected"
        sessionStateLabel="ready"
        getHostIconUrl={() => ''}
        onOpenFiles={async () => undefined}
        onReconnect={async () => undefined}
        onClose={async () => true}
      />,
    )

    expect(screen.getByText('profile-user@profile.example.com:2202')).toBeInTheDocument()
    expect(screen.getByText('profile.example.com:2202')).toBeInTheDocument()
    expect(screen.queryByText('legacy-user@legacy.example.com:22')).not.toBeInTheDocument()
  })

  it('交给 Agent 时携带当前 ready 会话的精确引用', () => {
    const onLaunchAgent = vi.fn()
    render(
      <WorkbenchConnectionOverview
        data={{
          hosts: [legacyHost()],
          groups: [],
          proxies: [],
          credentials: [],
          sshAccessProfiles: [profile()],
        }}
        session={session()}
        actionBusy={false}
        sessionClosing={false}
        sessionBadgeStatus="connected"
        sessionStatusLabel="connected"
        sessionStateLabel="ready"
        getHostIconUrl={() => ''}
        onOpenFiles={async () => undefined}
        onReconnect={async () => undefined}
        onClose={async () => true}
        onLaunchAgent={onLaunchAgent}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'agent.launch.action' }))
    expect(onLaunchAgent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'workbench',
      host_id: 'host-a',
      ssh_profile_id: 'ssh-profile-a',
      connection_status: 'connected',
      resource_reference: { kind: 'ssh_session', session_id: 'session-a' },
    }))
  })

  it('SSH 会话尚未 ready 时不允许创建 Agent 绑定', () => {
    const onLaunchAgent = vi.fn()
    render(
      <WorkbenchConnectionOverview
        data={{
          hosts: [legacyHost()],
          groups: [],
          proxies: [],
          credentials: [],
          sshAccessProfiles: [profile()],
        }}
        session={session({ phase: 'starting_shell' })}
        actionBusy={false}
        sessionClosing={false}
        sessionBadgeStatus="connecting"
        sessionStatusLabel="connecting"
        sessionStateLabel="starting"
        getHostIconUrl={() => ''}
        onOpenFiles={async () => undefined}
        onReconnect={async () => undefined}
        onClose={async () => true}
        onLaunchAgent={onLaunchAgent}
      />,
    )

    expect(screen.getByRole('button', { name: 'agent.launch.action' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'agent.launch.action' }))
    expect(onLaunchAgent).not.toHaveBeenCalled()
  })
})

function legacyHost(): Host {
  return {
    id: 'host-a',
    name: 'Host A',
    platform: 'linux',
    group_id: '',
    address: 'legacy.example.com',
    port: 22,
    username: 'legacy-user',
    auth_method: 'password',
    credential_id: 'legacy-credential',
    tags: [],
    favorite: false,
    fingerprint_policy: 'confirm_on_change',
  }
}

function profile(): SSHAccessProfile {
  return {
    id: 'ssh-profile-a',
    host_id: 'host-a',
    name: 'Profile A',
    address: 'profile.example.com',
    port: 2202,
    username: 'profile-user',
    auth_method: 'password',
    credential_id: 'profile-credential',
    fingerprint_policy: 'confirm_on_change',
    is_default: false,
    sort_order: 1,
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-a',
    kind: 'ssh',
    origin: 'app',
    host_id: 'host-a',
    ssh_profile_id: 'ssh-profile-a',
    status: 'connected',
    phase: 'ready',
    started_at: '2026-08-25T00:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
    ...overrides,
  }
}

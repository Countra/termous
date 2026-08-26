import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Host } from '#entities/host'
import type { Session } from '#entities/session'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('antd', () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
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

function session(): Session {
  return {
    id: 'session-a',
    kind: 'ssh',
    origin: 'app',
    host_id: 'host-a',
    ssh_profile_id: 'ssh-profile-a',
    status: 'connected',
    started_at: '2026-08-25T00:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
  }
}

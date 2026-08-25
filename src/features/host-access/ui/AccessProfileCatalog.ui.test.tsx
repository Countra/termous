import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HostAccessCatalog } from '#entities/host-asset'
import { AccessProfileCatalog } from './AccessProfileCatalog.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function accessCatalog(): HostAccessCatalog {
  return {
    host: {
      id: 'host-a',
      name: 'Host A',
      platform: 'linux',
      group_id: '',
      tags: [],
      favorite: false,
      created_at: '2026-08-25T00:00:00Z',
      updated_at: '2026-08-25T00:00:00Z',
    },
    ssh: [{
      id: 'ssh-a',
      host_id: 'host-a',
      name: 'Primary SSH',
      address: 'server.example.com',
      port: 22,
      username: 'root',
      auth_method: 'password',
      credential_id: 'credential-a',
      fingerprint_policy: 'confirm_on_change',
      is_default: true,
      sort_order: 0,
      created_at: '2026-08-25T00:00:00Z',
      updated_at: '2026-08-25T00:00:00Z',
    }],
    files: [{
      id: 'file-a',
      host_id: 'host-a',
      name: 'Bound SFTP',
      engine: 'sftp',
      engine_config_version: 1,
      sftp: { ssh_profile_id: 'ssh-a' },
      is_default: true,
      sort_order: 0,
      created_at: '2026-08-25T00:00:00Z',
      updated_at: '2026-08-25T00:00:00Z',
    }],
    remote_desktops: [],
  }
}

describe('访问方式目录', () => {
  it('SFTP 只提供编辑与默认项操作，不提供删除或改绑入口', () => {
    const onEditFile = vi.fn()
    render(
      <AccessProfileCatalog
        catalog={accessCatalog()}
        busy={false}
        onCreateSSH={vi.fn()}
        onEditSSH={vi.fn()}
        onDeleteSSH={vi.fn()}
        onSetDefaultSSH={vi.fn()}
        onEditFile={onEditFile}
        onSetDefaultFile={vi.fn()}
        onCreateRemoteDesktop={vi.fn()}
        onEditRemoteDesktop={vi.fn()}
        onDeleteRemoteDesktop={vi.fn()}
        onSetDefaultRemoteDesktop={vi.fn()}
      />,
    )

    expect(screen.getByText('Bound SFTP')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'app.delete Bound SFTP' })).not.toBeInTheDocument()
    expect(screen.queryByText(/rebind|改绑/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'app.edit Bound SFTP' }))
    expect(onEditFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-a' }))
  })

  it('写操作进行中禁用新增入口', () => {
    render(
      <AccessProfileCatalog
        catalog={accessCatalog()}
        busy
        onCreateSSH={vi.fn()}
        onEditSSH={vi.fn()}
        onDeleteSSH={vi.fn()}
        onSetDefaultSSH={vi.fn()}
        onEditFile={vi.fn()}
        onSetDefaultFile={vi.fn()}
        onCreateRemoteDesktop={vi.fn()}
        onEditRemoteDesktop={vi.fn()}
        onDeleteRemoteDesktop={vi.fn()}
        onSetDefaultRemoteDesktop={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'hosts.access.ssh.add' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'hosts.access.desktop.add' })).toBeDisabled()
  })
})

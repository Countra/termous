import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HostAccessCatalog } from '#entities/host-asset'
import { AccessProfileCatalog } from './AccessProfileCatalog.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      key === 'hosts.access.reachability.latencyValue'
        ? `${options?.latency} ms`
        : key
    ),
  }),
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
  it('通过行内操作传递 Profile 的稳定身份', () => {
    const onLaunchAgent = vi.fn()
    render(
      <AccessProfileCatalog
        catalog={accessCatalog()}
        busy={false}
        sshReachability={{}}
        sshReachabilityRefreshing={false}
        onRefreshSSHReachability={vi.fn()}
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
        onLaunchAgent={onLaunchAgent}
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: 'agent.launch.action Primary SSH',
    }))
    expect(onLaunchAgent).toHaveBeenCalledWith('ssh', 'ssh-a', 'Primary SSH', 'SSH')
  })

  it('SFTP 只提供编辑与默认项操作，不提供删除或改绑入口', () => {
    const onEditFile = vi.fn()
    const view = render(
      <AccessProfileCatalog
        catalog={accessCatalog()}
        busy={false}
        sshReachability={{}}
        sshReachabilityRefreshing={false}
        onRefreshSSHReachability={vi.fn()}
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
    expect(view.container.querySelectorAll('.lucide-circle-check')).toHaveLength(2)
    expect(view.container.querySelector('.lucide-star')).not.toBeInTheDocument()
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
        sshReachability={{}}
        sshReachabilityRefreshing={false}
        onRefreshSSHReachability={vi.fn()}
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

    const sshAdd = screen.getByRole('button', { name: 'hosts.access.ssh.add' })
    const desktopAdd = screen.getByRole('button', { name: 'hosts.access.desktop.add' })
    const refreshAll = screen.getByRole('button', { name: 'hosts.access.reachability.refreshAll' })
    expect(sshAdd).toBeDisabled()
    expect(desktopAdd).toBeDisabled()
    expect(refreshAll).toBeDisabled()
    expect(sshAdd.className).toContain('section-add')
    expect(desktopAdd.className).toContain('section-add')
  })

  it('按 SSH Profile 展示独立在线状态并通过标题栏统一检测', () => {
    const source = accessCatalog()
    source.ssh.push({
      ...source.ssh[0],
      id: 'ssh-b',
      name: 'Secondary SSH',
      address: 'secondary.example.com',
      is_default: false,
      sort_order: 1,
    })
    const onRefresh = vi.fn()
    const view = render(
      <AccessProfileCatalog
        catalog={source}
        busy={false}
        sshReachability={{
          'ssh-a': {
            host_id: 'host-a',
            ssh_profile_id: 'ssh-a',
            address: 'server.example.com',
            status: 'online',
            latency_ms: 0,
            packet_loss: 0,
          },
          'ssh-b': {
            host_id: 'host-a',
            ssh_profile_id: 'ssh-b',
            address: 'secondary.example.com',
            status: 'offline',
            packet_loss: 1,
          },
        }}
        sshReachabilityRefreshing={false}
        onRefreshSSHReachability={onRefresh}
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

    const onlineLabel = screen.getByText('hosts.access.reachability.online')
    const onlineStatus = onlineLabel.closest('[data-status]') as HTMLElement
    const offlineLabel = screen.getByText('hosts.access.reachability.offline')
    expect(onlineLabel).toBeInTheDocument()
    expect(within(onlineStatus).getByText('0 ms')).toBeInTheDocument()
    expect(onlineStatus).toHaveAttribute('data-status', 'online')
    expect(offlineLabel).toBeInTheDocument()
    expect(view.container.querySelectorAll('[class*="row-controls"]')).toHaveLength(3)
    expect(onlineStatus.parentElement?.className).toContain('row-status')
    expect(offlineLabel.closest('[data-status]')?.parentElement?.className).toContain('row-status')
    expect(offlineLabel.closest('[data-status]')).not.toHaveTextContent('ms')
    fireEvent.mouseEnter(onlineStatus)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    const refreshButtons = screen.getAllByRole('button', {
      name: 'hosts.access.reachability.refreshAll',
    })
    expect(refreshButtons).toHaveLength(1)
    expect(view.container.querySelectorAll('.lucide-refresh-cw')).toHaveLength(1)
    expect(refreshButtons[0].closest('header')).not.toBeNull()
    expect(screen.getByRole('button', {
      name: 'hosts.access.setDefault Secondary SSH',
    })).toBeEnabled()
    const defaultDeleteReason = screen.getByRole('note', {
      name: 'hosts.access.switchDefaultBeforeDelete',
    })
    expect(defaultDeleteReason).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'app.delete Primary SSH' })).toBeDisabled()
    fireEvent.click(refreshButtons[0])
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('远端检测状态不锁死刷新入口，并在本地请求或失败时展示明确状态', () => {
    const source = accessCatalog()
    const onRefresh = vi.fn()
    const props = {
      catalog: source,
      busy: false,
      sshReachability: {
        'ssh-a': {
          host_id: 'host-a',
          ssh_profile_id: 'ssh-a',
          address: 'server.example.com',
          status: 'checking' as const,
          packet_loss: 0,
        },
      },
      sshReachabilityRefreshing: false,
      sshReachabilityError: 'refresh failed',
      onRefreshSSHReachability: onRefresh,
      onCreateSSH: vi.fn(),
      onEditSSH: vi.fn(),
      onDeleteSSH: vi.fn(),
      onSetDefaultSSH: vi.fn(),
      onEditFile: vi.fn(),
      onSetDefaultFile: vi.fn(),
      onCreateRemoteDesktop: vi.fn(),
      onEditRemoteDesktop: vi.fn(),
      onDeleteRemoteDesktop: vi.fn(),
      onSetDefaultRemoteDesktop: vi.fn(),
    }
    const view = render(<AccessProfileCatalog {...props} />)

    const retryButton = screen.getByRole('button', {
      name: 'hosts.access.reachability.refreshFailed',
    })
    expect(retryButton).toBeEnabled()
    expect(retryButton).toHaveAttribute('data-error', 'true')
    fireEvent.click(retryButton)
    expect(onRefresh).toHaveBeenCalledOnce()

    view.rerender(
      <AccessProfileCatalog
        {...props}
        sshReachabilityError={undefined}
        sshReachabilityRefreshing
      />,
    )
    expect(screen.getByRole('button', {
      name: 'hosts.access.reachability.refreshAll',
    })).toBeDisabled()
  })
})

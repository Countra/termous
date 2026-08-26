import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { Host } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type { RemoteDesktopAccessProfile } from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import type { HostLauncherData } from '#features/hosts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('antd', async (importOriginal) => {
  const original = await importOriginal<typeof import('antd')>()
  return {
    ...original,
    Modal: ({ open, children, title, keyboard, onCancel }: {
      open: boolean
      children: ReactNode
      title?: ReactNode
      keyboard?: boolean
      onCancel?: () => void
    }) => (
      open ? (
        <div
          role="dialog"
          aria-label={typeof title === 'string' ? title : undefined}
          data-keyboard={String(keyboard)}
        >
          <button type="button" aria-label="modal-close" onClick={onCancel} />
          {children}
        </div>
      ) : null
    ),
    Tooltip: ({ children }: { children: ReactNode }) => children,
  }
})

vi.mock('#entities/host', () => ({
  HostAvatar: ({ host }: { host?: Pick<Host, 'name'> }) => <span>{host?.name}</span>,
  AuthMethodBadge: () => <span>auth</span>,
}))

vi.mock('#shared/ui', () => ({
  confirmDialogStyles: {
    'modal-root': 'modal-root',
  },
  customSelectStyles: {
    select: 'select',
    'select-popup': 'select-popup',
  },
  uiStyles: {
    'search-input': 'search-input',
    'secondary-button': 'secondary-button',
  },
  ConnectionActionButton: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
}))

import { HostLauncherModal } from '../features/hosts/ui/HostLauncherModal'

function host(id: string, name: string): Host {
  return {
    id,
    name,
    platform: 'linux',
    group_id: '',
    address: `${id}.example.com`,
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'credential-password',
    tags: [],
    favorite: false,
    fingerprint_policy: 'confirm_on_change',
  }
}

function data(hosts: Host[]): HostLauncherData {
  return {
    hostAssets: hosts.map(toHostAsset),
    groups: [],
    proxies: [],
    credentials: [{
      id: 'credential-password',
      name: 'Password',
      type: 'password',
      vault_id: 'local',
      metadata: {},
      bound_host_count: hosts.length,
    }],
    hostReachability: {},
    sshAccessProfiles: hosts.map(sshProfile),
    fileAccessProfiles: hosts.map(fileProfile),
    remoteDesktopProfiles: hosts.map(remoteDesktopProfile),
  }
}

function toHostAsset(host: Host): HostAsset {
  return {
    id: host.id,
    name: host.name,
    platform: host.platform,
    icon_id: host.icon_id,
    group_id: host.group_id,
    tags: [...host.tags],
    favorite: host.favorite,
    note: host.note,
    last_accessed_at: host.last_connected_at,
    created_at: host.created_at ?? '2026-08-26T00:00:00Z',
    updated_at: host.updated_at ?? '2026-08-26T00:00:00Z',
  }
}

function sshProfile(host: Host): SSHAccessProfile {
  return {
    id: `${host.id}-ssh`,
    host_id: host.id,
    name: 'Primary SSH',
    address: host.address,
    port: host.port,
    username: host.username,
    auth_method: host.auth_method,
    credential_id: host.credential_id,
    fingerprint_policy: host.fingerprint_policy,
    is_default: true,
    sort_order: 0,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}

function fileProfile(host: Host): FileAccessProfile {
  return {
    id: `${host.id}-file`,
    host_id: host.id,
    name: 'Primary files',
    engine: 'sftp',
    engine_config_version: 1,
    sftp: { ssh_profile_id: `${host.id}-ssh` },
    is_default: true,
    sort_order: 0,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}

function remoteDesktopProfile(host: Host): RemoteDesktopAccessProfile {
  return {
    id: `${host.id}-desktop`,
    host_id: host.id,
    name: 'Primary desktop',
    description: '',
    route: 'ssh_tunnel',
    route_config_version: 1,
    ssh_profile_id: `${host.id}-ssh`,
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5901,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    is_default: true,
    sort_order: 0,
    target_auth: null,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

describe('HostLauncherModal 行为合同', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无 SSH 的主机资产仍可管理且不会伪造连接信息', async () => {
    const assetOnly = toHostAsset(host('asset-only', 'Asset only'))
    const onManageHostAccess = vi.fn()
    const onRefreshReachability = vi.fn().mockResolvedValue(undefined)
    render(
      <HostLauncherModal
        open
        instanceKey={1}
        data={{ ...data([]), hostAssets: [assetOnly] }}
        selectedHostId={assetOnly.id}
        actionBusy={false}
        onClose={vi.fn()}
        onSelectHost={vi.fn()}
        onConnectSSHProfile={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onManageHostAccess={onManageHostAccess}
        onOpenFileProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenRemoteDesktopProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={onRefreshReachability}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    expect(screen.getByRole('option', { name: /Asset only/ })).toBeInTheDocument()
    expect(screen.getAllByText('hosts.access.ssh.empty').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'app.connect' })).toBeDisabled()
    expect(screen.queryByText('auth')).not.toBeInTheDocument()
    expect(onRefreshReachability).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', {
      name: 'workbench.hostLauncher.profiles.manage',
    }))
    expect(onManageHostAccess).toHaveBeenCalledWith(assetOnly.id)
  })

  it('空主机状态使用专用引导且只保留一个新增入口', async () => {
    const onClose = vi.fn()
    const onCreateHost = vi.fn()
    render(
      <HostLauncherModal
        open
        instanceKey={1}
        data={data([])}
        selectedHostId=""
        actionBusy={false}
        onClose={onClose}
        onSelectHost={vi.fn()}
        onConnectSSHProfile={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={onCreateHost}
        onEditHost={vi.fn()}
        onManageHostAccess={vi.fn()}
        onOpenFileProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenRemoteDesktopProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={vi.fn().mockResolvedValue(undefined)}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    expect(screen.getByText('workbench.hostLauncher.emptyTitle')).toBeInTheDocument()
    expect(screen.queryByText('app.empty')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('workbench.hostLauncher.search')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'workbench.hostLauncher.refreshReachability' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.ant-empty')).toHaveLength(1)

    const addHost = screen.getByRole('button', { name: 'hosts.addHost' })
    fireEvent.click(addHost)
    expect(onCreateHost).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('已有主机时保留侧栏新增入口', () => {
    const current = host('host-a', 'Alpha')
    render(
      <HostLauncherModal
        open
        instanceKey={1}
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={vi.fn()}
        onSelectHost={vi.fn()}
        onConnectSSHProfile={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onManageHostAccess={vi.fn()}
        onOpenFileProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenRemoteDesktopProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={vi.fn().mockResolvedValue(undefined)}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    expect(screen.getAllByRole('button', { name: 'hosts.addHost' })).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'workbench.hostLauncher.kicker' })).toBeInTheDocument()
  })

  it('默认 Profile 缺失时管理入口独立打开访问方式', async () => {
    const current = host('host-a', 'Alpha')
    const onClose = vi.fn()
    const onEditHost = vi.fn()
    const onManageHostAccess = vi.fn()
    render(
      <HostLauncherModal
        open
        instanceKey={1}
        data={{ ...data([current]), sshAccessProfiles: [] }}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={onClose}
        onSelectHost={vi.fn()}
        onConnectSSHProfile={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={onEditHost}
        onManageHostAccess={onManageHostAccess}
        onOpenFileProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenRemoteDesktopProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={vi.fn().mockResolvedValue(undefined)}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: 'workbench.hostLauncher.profiles.manage',
    }))

    expect(onManageHostAccess).toHaveBeenCalledWith(current.id)
    expect(onEditHost).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('搜索框键盘事件不会误触连接，列表方向键只导航实际选项', async () => {
    const hosts = [host('host-a', 'Alpha'), host('host-b', 'Beta')]
    const onSelectHost = vi.fn()
    const onConnect = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(
      <HostLauncherModal
        open
        instanceKey={1}
        data={data(hosts)}
        selectedHostId={hosts[0]!.id}
        actionBusy={false}
        onClose={onClose}
        onSelectHost={onSelectHost}
        onConnectSSHProfile={onConnect}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onManageHostAccess={vi.fn()}
        onOpenFileProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenRemoteDesktopProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={vi.fn().mockResolvedValue(undefined)}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    const search = screen.getByPlaceholderText('workbench.hostLauncher.search')
    fireEvent.keyDown(search, { key: 'Enter' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(onConnect).not.toHaveBeenCalled()
    expect(onSelectHost).not.toHaveBeenCalled()

    const alpha = screen.getByRole('option', { name: /Alpha/ })
    const beta = screen.getByRole('option', { name: /Beta/ })
    fireEvent.keyDown(alpha, { key: 'ArrowDown' })
    expect(onSelectHost).toHaveBeenCalledWith('host-b')
    expect(beta).toHaveFocus()

    fireEvent.keyDown(beta, { key: 'Enter' })
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('host-b-ssh'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('折叠当前主机分组后首个可见主机仍可通过键盘进入', () => {
    const alpha = { ...host('host-a', 'Alpha'), group_id: 'group-a' }
    const beta = { ...host('host-b', 'Beta'), group_id: 'group-b' }
    const launcherData: HostLauncherData = {
      ...data([alpha, beta]),
      groups: [
        { id: 'group-a', name: 'Group A', sort_order: 0 },
        { id: 'group-b', name: 'Group B', sort_order: 1 },
      ],
    }
    render(
      <HostLauncherModal
        open
        instanceKey={1}
        data={launcherData}
        selectedHostId={alpha.id}
        actionBusy={false}
        onClose={vi.fn()}
        onSelectHost={vi.fn()}
        onConnectSSHProfile={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onManageHostAccess={vi.fn()}
        onOpenFileProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenRemoteDesktopProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={vi.fn().mockResolvedValue(undefined)}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Group A/ }))

    expect(screen.queryByRole('option', { name: /Alpha/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Beta/ })).toHaveAttribute('tabindex', '0')
  })

  it('筛选面板展开时 Escape 只关闭筛选而不关闭 Launcher', () => {
    const current = host('host-a', 'Alpha')
    const onClose = vi.fn()
    render(
      <HostLauncherModal
        open
        instanceKey={1}
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={onClose}
        onSelectHost={vi.fn()}
        onConnectSSHProfile={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onManageHostAccess={vi.fn()}
        onOpenFileProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenRemoteDesktopProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={vi.fn().mockResolvedValue(undefined)}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workbench.hostLauncher.filters.advanced' }))
    const filterDialog = screen.getByRole('dialog', { name: 'workbench.hostLauncher.filters.advanced' })
    expect(screen.getByRole('dialog', { name: 'workbench.hostLauncher.kicker' })).toHaveAttribute('data-keyboard', 'false')

    fireEvent.keyDown(filterDialog, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'workbench.hostLauncher.filters.advanced' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('筛选无结果时可清除条件并恢复主机列表', () => {
    const current = host('host-a', 'Alpha')
    render(
      <HostLauncherModal
        open
        instanceKey={1}
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={vi.fn()}
        onSelectHost={vi.fn()}
        onConnectSSHProfile={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onManageHostAccess={vi.fn()}
        onOpenFileProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenRemoteDesktopProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={vi.fn().mockResolvedValue(undefined)}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    const search = screen.getByPlaceholderText('workbench.hostLauncher.search')
    fireEvent.change(search, { target: { value: 'missing' } })
    expect(screen.getByRole('heading', { name: 'hosts.noFilterResults' })).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('hosts.filterResult')
    expect(document.querySelectorAll('.ant-empty')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'workbench.hostLauncher.filters.resetAll' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'workbench.hostLauncher.filters.resetAll' }))
    expect(search).toHaveValue('')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Alpha/ })).toBeInTheDocument()
    expect(document.querySelectorAll('.ant-empty')).toHaveLength(0)
  })

  it('回退到首个可用主机并且每次打开只自动刷新一次', async () => {
    const hosts = [host('host-a', 'Alpha'), host('host-b', 'Beta')]
    const onSelectHost = vi.fn()
    const onRefreshReachability = vi.fn().mockResolvedValue(undefined)
    const props = {
      open: true,
      instanceKey: 1,
      data: data(hosts),
      selectedHostId: 'missing-host',
      actionBusy: false,
      onClose: vi.fn(),
      onSelectHost,
      onConnectSSHProfile: vi.fn().mockResolvedValue(undefined),
      onCreateHost: vi.fn(),
      onEditHost: vi.fn(),
      onManageHostAccess: vi.fn(),
      onOpenFileProfile: vi.fn().mockResolvedValue(undefined),
      onOpenRemoteDesktopProfile: vi.fn().mockResolvedValue(undefined),
      onOpenForward: vi.fn(),
      onToggleFavorite: vi.fn().mockResolvedValue(undefined),
      onRefreshReachability,
      getHostIconUrl: vi.fn(() => ''),
    }
    const view = render(<HostLauncherModal {...props} />)

    await waitFor(() => expect(onSelectHost).toHaveBeenCalledWith('host-a'))
    await waitFor(() => expect(onRefreshReachability).toHaveBeenCalledWith(['host-a', 'host-b'], false))
    expect(onRefreshReachability).toHaveBeenCalledTimes(1)

    view.rerender(<HostLauncherModal {...props} selectedHostId="host-a" />)
    expect(onRefreshReachability).toHaveBeenCalledTimes(1)
    view.rerender(<HostLauncherModal {...props} open={false} selectedHostId="host-a" />)
    view.rerender(
      <HostLauncherModal
        {...props}
        open
        instanceKey={props.instanceKey + 1}
        selectedHostId="host-a"
      />,
    )
    await waitFor(() => expect(onRefreshReachability).toHaveBeenCalledTimes(2))
  })

  it('主动作同步防重并在异步完成后才关闭', async () => {
    const current = host('host-a', 'Alpha')
    const pending = deferred<void>()
    const onConnect = vi.fn(() => pending.promise)
    const onClose = vi.fn()
    render(
      <HostLauncherModal
        open
        instanceKey={1}
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={onClose}
        onSelectHost={vi.fn()}
        onConnectSSHProfile={onConnect}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onManageHostAccess={vi.fn()}
        onOpenFileProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenRemoteDesktopProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={vi.fn().mockResolvedValue(undefined)}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    const connect = await screen.findByRole('button', { name: 'app.connect' })
    fireEvent.click(connect)
    fireEvent.click(connect)
    expect(onConnect).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    pending.resolve()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('关闭重开后旧动作完成不会关闭新的 Launcher', async () => {
    const current = host('host-a', 'Alpha')
    const pending = deferred<void>()
    const onClose = vi.fn()
    const props = {
      open: true,
      instanceKey: 1,
      data: data([current]),
      selectedHostId: current.id,
      actionBusy: false,
      onClose,
      onSelectHost: vi.fn(),
      onConnectSSHProfile: vi.fn(() => pending.promise),
      onCreateHost: vi.fn(),
      onEditHost: vi.fn(),
      onManageHostAccess: vi.fn(),
      onOpenFileProfile: vi.fn().mockResolvedValue(undefined),
      onOpenRemoteDesktopProfile: vi.fn().mockResolvedValue(undefined),
      onOpenForward: vi.fn(),
      onToggleFavorite: vi.fn().mockResolvedValue(undefined),
      onRefreshReachability: vi.fn().mockResolvedValue(undefined),
      getHostIconUrl: vi.fn(() => ''),
    }
    const view = render(<HostLauncherModal {...props} />)

    fireEvent.click(await screen.findByRole('button', { name: 'app.connect' }))
    fireEvent.click(screen.getByRole('button', { name: 'modal-close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    view.rerender(
      <HostLauncherModal
        {...props}
        open
        instanceKey={props.instanceKey + 1}
        intent="files"
      />,
    )
    pending.resolve()

    await waitFor(() => expect(screen.getByRole('dialog', {
      name: 'files.openFileSession',
    })).toBeInTheDocument())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('动作拒绝后保持 Launcher 并释放忙碌状态', async () => {
    const current = host('host-a', 'Alpha')
    const pending = deferred<void>()
    const onClose = vi.fn()
    render(
      <HostLauncherModal
        open
        instanceKey={1}
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={onClose}
        onSelectHost={vi.fn()}
        onConnectSSHProfile={vi.fn(() => pending.promise)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onManageHostAccess={vi.fn()}
        onOpenFileProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenRemoteDesktopProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={vi.fn().mockResolvedValue(undefined)}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    const connect = await screen.findByRole('button', { name: 'app.connect' })
    fireEvent.click(connect)
    await act(async () => pending.reject(new Error('connection failed')))

    await waitFor(() => expect(connect).not.toBeDisabled())
    expect(screen.getByRole('dialog', {
      name: 'workbench.hostLauncher.kicker',
    })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('高级筛选只保留自身 Select 浮层的指针交互', async () => {
    const current = host('host-a', 'Alpha')
    render(
      <HostLauncherModal
        open
        instanceKey={1}
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={vi.fn()}
        onSelectHost={vi.fn()}
        onConnectSSHProfile={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onManageHostAccess={vi.fn()}
        onOpenFileProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenRemoteDesktopProfile={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={vi.fn().mockResolvedValue(undefined)}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    const filterName = 'workbench.hostLauncher.filters.advanced'
    fireEvent.click(screen.getByRole('button', { name: filterName }))
    expect(screen.getByRole('dialog', { name: filterName })).toBeInTheDocument()

    const unrelatedPopup = document.createElement('div')
    unrelatedPopup.className = 'ant-select-dropdown'
    document.body.append(unrelatedPopup)
    fireEvent.pointerDown(unrelatedPopup)
    expect(screen.queryByRole('dialog', { name: filterName })).not.toBeInTheDocument()
    unrelatedPopup.remove()

    fireEvent.click(screen.getByRole('button', { name: filterName }))
    const ownedPopup = document.createElement('div')
    ownedPopup.dataset.hostLauncherFilterPopup = ''
    document.body.append(ownedPopup)
    fireEvent.pointerDown(ownedPopup)
    expect(screen.getByRole('dialog', { name: filterName })).toBeInTheDocument()
    ownedPopup.remove()
  })
})

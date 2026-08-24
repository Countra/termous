import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '#entities/host'
import type { HostLauncherData } from '#features/hosts'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('antd', async (importOriginal) => {
  const original = await importOriginal<typeof import('antd')>()
  return {
    ...original,
    Modal: ({ open, children, title, keyboard }: {
      open: boolean
      children: ReactNode
      title?: ReactNode
      keyboard?: boolean
    }) => (
      open ? (
        <div
          role="dialog"
          aria-label={typeof title === 'string' ? title : undefined}
          data-keyboard={String(keyboard)}
        >
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
    hosts,
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
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('HostLauncherModal 行为合同', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('空主机状态使用专用引导且只保留一个新增入口', async () => {
    const onClose = vi.fn()
    const onCreateHost = vi.fn()
    render(
      <HostLauncherModal
        open
        data={data([])}
        selectedHostId=""
        actionBusy={false}
        onClose={onClose}
        onSelectHost={vi.fn()}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={onCreateHost}
        onEditHost={vi.fn()}
        onOpenFiles={vi.fn().mockResolvedValue(undefined)}
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
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={vi.fn()}
        onSelectHost={vi.fn()}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onOpenFiles={vi.fn().mockResolvedValue(undefined)}
        onOpenForward={vi.fn()}
        onToggleFavorite={vi.fn().mockResolvedValue(undefined)}
        onRefreshReachability={vi.fn().mockResolvedValue(undefined)}
        getHostIconUrl={vi.fn(() => '')}
      />,
    )

    expect(screen.getAllByRole('button', { name: 'hosts.addHost' })).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'workbench.hostLauncher.kicker' })).toBeInTheDocument()
  })

  it('搜索框键盘事件不会误触连接，列表方向键只导航实际选项', async () => {
    const hosts = [host('host-a', 'Alpha'), host('host-b', 'Beta')]
    const onSelectHost = vi.fn()
    const onConnect = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(
      <HostLauncherModal
        open
        data={data(hosts)}
        selectedHostId={hosts[0]!.id}
        actionBusy={false}
        onClose={onClose}
        onSelectHost={onSelectHost}
        onConnect={onConnect}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onOpenFiles={vi.fn().mockResolvedValue(undefined)}
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
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith('host-b'))
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
        data={launcherData}
        selectedHostId={alpha.id}
        actionBusy={false}
        onClose={vi.fn()}
        onSelectHost={vi.fn()}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onOpenFiles={vi.fn().mockResolvedValue(undefined)}
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
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={onClose}
        onSelectHost={vi.fn()}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onOpenFiles={vi.fn().mockResolvedValue(undefined)}
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
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={vi.fn()}
        onSelectHost={vi.fn()}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onOpenFiles={vi.fn().mockResolvedValue(undefined)}
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
      data: data(hosts),
      selectedHostId: 'missing-host',
      actionBusy: false,
      onClose: vi.fn(),
      onSelectHost,
      onConnect: vi.fn().mockResolvedValue(undefined),
      onCreateHost: vi.fn(),
      onEditHost: vi.fn(),
      onOpenFiles: vi.fn().mockResolvedValue(undefined),
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
    view.rerender(<HostLauncherModal {...props} open selectedHostId="host-a" />)
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
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={onClose}
        onSelectHost={vi.fn()}
        onConnect={onConnect}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onOpenFiles={vi.fn().mockResolvedValue(undefined)}
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

  it('高级筛选只保留自身 Select 浮层的指针交互', async () => {
    const current = host('host-a', 'Alpha')
    render(
      <HostLauncherModal
        open
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        onClose={vi.fn()}
        onSelectHost={vi.fn()}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onCreateHost={vi.fn()}
        onEditHost={vi.fn()}
        onOpenFiles={vi.fn().mockResolvedValue(undefined)}
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

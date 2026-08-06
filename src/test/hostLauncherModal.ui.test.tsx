import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppData, Host } from '../types/domain'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('antd', async (importOriginal) => {
  const original = await importOriginal<typeof import('antd')>()
  return {
    ...original,
    Modal: ({ open, children }: { open: boolean; children: ReactNode }) => (
      open ? <div role="dialog">{children}</div> : null
    ),
    Tooltip: ({ children }: { children: ReactNode }) => children,
  }
})

vi.mock('#entities/host', () => ({
  HostAvatar: ({ host }: { host?: Pick<Host, 'name'> }) => <span>{host?.name}</span>,
  AuthMethodBadge: () => <span>auth</span>,
}))

vi.mock('#shared/ui', () => ({
  ConnectionActionButton: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
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

function data(hosts: Host[]): AppData {
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
    sessions: [],
    fileSessions: [],
    forwardProfiles: [],
    forwards: [],
    snippetGroups: [],
    snippets: [],
    fileBookmarkGroups: [],
    fileBookmarks: [],
    localPathMappings: [],
    settings: {} as AppData['settings'],
    terminalFonts: [],
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
})

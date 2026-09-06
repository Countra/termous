import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host, HostIcon, HostIconReorderItem } from '#entities/host'
import type { HostAccessCatalog, HostAsset, HostProvisionInput } from '#entities/host-asset'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import type { HostManagementData } from '#features/hosts'
import type { HostAccessWorkspaceGateway, HostProvisionGateway } from '#features/host-access'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../features/hosts/ui/ProxyManagerModal', () => ({
  ProxyManagerModal: () => null,
}))

vi.mock('../features/hosts/ui/HostCatalog', () => ({
  HostCatalog: ({
    items,
    selectedHostId,
    onSelect,
    onCreate,
    onManageIcons,
  }: {
    items: Array<{ id: string }>
    selectedHostId: string | null
    onSelect: (hostId: string) => void
    onCreate: () => void
    onManageIcons: () => void
  }) => (
    <section data-testid="host-catalog" data-selected-id={selectedHostId ?? ''}>
      {items.map((host) => (
        <button key={host.id} type="button" onClick={() => onSelect(host.id)}>
          select-{host.id}
        </button>
      ))}
      <button type="button" onClick={onCreate}>create-host</button>
      <button type="button" onClick={onManageIcons}>manage-icons-catalog</button>
    </section>
  ),
}))

vi.mock('../features/hosts/ui/HostCreateEditor', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    HostCreateEditor: ({ onCreate, onDirtyChange, onProtectedIconIdChange, onBack, onManageIcons }: {
      onCreate: (input: HostProvisionInput, section: 'asset' | 'connections') => Promise<void>
      onDirtyChange: (dirty: boolean) => void
      onProtectedIconIdChange: (id: string) => void
      onBack: () => void
      onManageIcons: () => void
    }) => {
      const [name, setName] = React.useState('')
      const [error, setError] = React.useState('')
      const submit = () => {
        void onCreate({
          client_request_id: '3a76c45d-c609-44ea-922a-47a70c7e95aa',
          host: { name: name.trim(), platform: 'linux', group_id: '', icon_id: '', tags: [], note: '', favorite: false },
          ssh: [], remote_desktops: [],
        }, 'asset')
          .catch((cause: Error) => setError(cause.message))
      }
      return <section data-testid="host-editor">
        <output data-testid="editing-id">new</output>
        <output data-testid="draft-name">{name}</output>
        <output data-testid="draft-dirty">{String(Boolean(name))}</output>
        <output data-testid="create-error">{error}</output>
        <input aria-label="host-draft-name" value={name} onChange={(event) => {
          setName(event.target.value)
          onDirtyChange(Boolean(event.target.value))
        }} />
        <button type="button" onClick={submit}>save-host</button>
        <button type="button" onClick={() => { submit(); submit() }}>save-host-twice</button>
        <button type="button" onClick={() => onProtectedIconIdChange('icon-library')}>select-library-icon</button>
        <button type="button" onClick={onManageIcons}>manage-icons-editor</button>
        <button type="button" onClick={onBack}>back-to-catalog</button>
      </section>
    },
  }
})

vi.mock('../features/hosts/ui/HostAccessWorkspace', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    HostAccessWorkspace: ({ host, onDirtyChange, onProtectedIconIdChange, onBack, onDeleteHost, onManageIcons }: {
      host: HostAsset
      onDirtyChange: (dirty: boolean) => void
      onProtectedIconIdChange: (id: string) => void
      onBack: () => void
      onDeleteHost: () => Promise<boolean>
      onManageIcons: () => void
    }) => {
      const [name, setName] = React.useState(host.name)
      const [icon, setIcon] = React.useState(host.icon_id ?? '')
      const dirty = name !== host.name || icon !== (host.icon_id ?? '')
      return <section data-testid="host-editor">
        <output data-testid="editing-id">{host.id}</output>
        <output data-testid="draft-name">{name}</output>
        <output data-testid="draft-icon">{icon}</output>
        <output data-testid="draft-dirty">{String(dirty)}</output>
        <input aria-label="host-draft-name" value={name} onChange={(event) => {
          setName(event.target.value)
          onDirtyChange(event.target.value !== host.name || icon !== (host.icon_id ?? ''))
        }} />
        <button type="button" onClick={() => { setIcon('icon-library'); onProtectedIconIdChange('icon-library'); onDirtyChange(true) }}>select-library-icon</button>
        <button type="button" onClick={onManageIcons}>manage-icons-editor</button>
        <button type="button" onClick={onBack}>back-to-catalog</button>
        <button type="button" onClick={() => void onDeleteHost()}>delete-host</button>
        <button type="button" onClick={() => { setName(host.name); setIcon(host.icon_id ?? ''); onDirtyChange(false); onProtectedIconIdChange('') }}>discard-host</button>
      </section>
    },
  }
})

vi.mock('../features/hosts/ui/HostIconManagerModal', () => ({
  HostIconManagerModal: ({
    open,
    protectedIconIds,
    onClose,
  }: {
    open: boolean
    protectedIconIds?: readonly string[]
    onClose: () => void
  }) => open ? (
    <div role="dialog" aria-label="host-icon-manager">
      <output data-testid="protected-icon-ids">{protectedIconIds?.join(',') ?? ''}</output>
      <button type="button" onClick={onClose}>close-icon-manager</button>
    </div>
  ) : null,
}))

vi.mock('#shared/ui', () => ({
  ManagementWorkspace: ({
    activeView,
    catalog,
    editor,
  }: {
    activeView: string
    catalog: ReactNode
    editor: ReactNode
  }) => (
    <div data-testid="management-workspace" data-active-view={activeView}>
      {catalog}
      {editor}
    </div>
  ),
  GroupManagerModal: () => null,
  ConfirmDialog: ({
    open,
    onCancel,
    onConfirm,
  }: {
    open: boolean
    onCancel: () => void
    onConfirm: () => void
  }) => open ? (
    <div role="dialog" aria-label="confirm-dialog">
      <button type="button" onClick={onCancel}>cancel-intent</button>
      <button type="button" onClick={onConfirm}>confirm-intent</button>
    </div>
  ) : null,
}))

import { HostManagementWorkspace } from '../features/hosts/ui/HostManagementWorkspace'

function host(id: string, address: string): Host {
  return {
    id,
    name: `Host ${id}`,
    platform: 'linux',
    group_id: '',
    address,
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: 'credential-password',
    tags: [],
    favorite: false,
    fingerprint_policy: 'confirm_on_change',
  }
}

function hostIcon(id = 'icon-library'): HostIcon {
  return {
    id,
    display_name: 'Library Icon',
    file_name: 'library.png',
    mime_type: 'image/png',
    size_bytes: 3,
    sha256: id,
    sort_order: 0,
    created_at: '',
  }
}

function data(hosts: Host[], hostIcons: HostIcon[] = []): HostManagementData {
  return {
    hosts,
    hostAssets: hosts.map(toHostAsset),
    sshAccessProfiles: hosts.map(toSSHProfile),
    groups: [],
    proxies: [],
    hostIcons,
    sessions: [],
    fileSessions: [],
    forwards: [],
    remoteDesktopSessions: [],
    credentials: [{
      id: 'credential-password',
      name: 'Password',
      type: 'password',
      vault_id: 'local',
      metadata: {},
      bound_host_count: hosts.length,
    }],
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
    created_at: host.created_at ?? '2026-08-26T00:00:00Z',
    updated_at: host.updated_at ?? '2026-08-26T00:00:00Z',
  }
}

function toSSHProfile(host: Host): SSHAccessProfile {
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

function callbacks() {
  return {
    onSelectHost: vi.fn(),
    accessGateway: { provisionHost: vi.fn<(input: HostProvisionInput) => Promise<HostAccessCatalog>>() } as unknown as HostAccessWorkspaceGateway & HostProvisionGateway,
    onDelete: vi.fn<(id: string) => Promise<boolean | undefined>>(),
    onCreateGroup: vi.fn(),
    onRenameGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    onReorderGroups: vi.fn(),
    onCreateProxy: vi.fn(),
    onUpdateProxy: vi.fn(),
    onDeleteProxy: vi.fn(),
    onUploadHostIcon: vi.fn<(file: File) => Promise<HostIcon>>(),
    onRenameHostIcon: vi.fn<(id: string, displayName: string) => Promise<HostIcon>>(),
    onReorderHostIcons: vi.fn<(items: HostIconReorderItem[]) => Promise<HostIcon[]>>(),
    onDeleteHostIcon: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    getHostIconUrl: vi.fn((iconId: string) => `http://localhost/${iconId}`),
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('HostManagementWorkspace 行为合同', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('脏草稿拦截外部选择并在取消时恢复父级选中项', async () => {
    const user = userEvent.setup()
    const first = host('host-a', 'a.example.com')
    const second = host('host-b', 'b.example.com')
    const handlers = callbacks()
    const view = render(
      <HostManagementWorkspace
        data={data([first, second])}
        selectedHostId={first.id}
        actionBusy={false}
        {...handlers}
      />,
    )

    await user.clear(screen.getByLabelText('host-draft-name'))
    await user.type(screen.getByLabelText('host-draft-name'), 'draft.example.com')
    view.rerender(
      <HostManagementWorkspace
        data={data([first, second])}
        selectedHostId={second.id}
        actionBusy={false}
        {...handlers}
      />,
    )

    expect(await screen.findByRole('dialog', { name: 'confirm-dialog' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'cancel-intent' }))
    expect(handlers.onSelectHost).toHaveBeenLastCalledWith(first.id)
    expect(screen.getByTestId('editing-id')).toHaveTextContent(first.id)
    expect(screen.getByTestId('draft-name')).toHaveTextContent('draft.example.com')

    view.rerender(
      <HostManagementWorkspace
        data={data([first, second])}
        selectedHostId={first.id}
        actionBusy={false}
        {...handlers}
      />,
    )
    view.rerender(
      <HostManagementWorkspace
        data={data([first, second])}
        selectedHostId={second.id}
        actionBusy={false}
        {...handlers}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'confirm-intent' }))
    expect(screen.getByTestId('editing-id')).toHaveTextContent(second.id)
    expect(screen.getByTestId('draft-name')).toHaveTextContent(second.name)
  })

  it('创建保存期间忽略 silent reload 的选中回声并在成功后进入新主机', async () => {
    const user = userEvent.setup()
    const saved = toHostAsset(host('host-created', 'created.example.com'))
    const pending = deferred<HostAccessCatalog>()
    const handlers = callbacks()
    vi.mocked(handlers.accessGateway.provisionHost).mockImplementationOnce(async () => pending.promise)
    const view = render(
      <HostManagementWorkspace
        data={data([])}
        selectedHostId=""
        actionBusy={false}
        {...handlers}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'create-host' }))
    await user.type(screen.getByLabelText('host-draft-name'), 'draft.example.com')
    await user.click(screen.getByRole('button', { name: 'save-host' }))
    await waitFor(() => expect(handlers.accessGateway.provisionHost).toHaveBeenCalledWith(
      expect.objectContaining({ host: expect.objectContaining({ name: 'draft.example.com' }) }),
    ))

    view.rerender(
      <HostManagementWorkspace
        data={{ ...data([]), hostAssets: [saved] }}
        selectedHostId={saved.id}
        actionBusy
        {...handlers}
      />,
    )
    expect(screen.queryByRole('dialog', { name: 'confirm-dialog' })).not.toBeInTheDocument()

    await act(async () => { pending.resolve({ host: saved, ssh: [], files: [], remote_desktops: [] }) })
    await waitFor(() => expect(screen.getByTestId('editing-id')).toHaveTextContent(saved.id))
    expect(screen.getByTestId('draft-name')).toHaveTextContent(saved.name)
    expect(screen.getByTestId('draft-dirty')).toHaveTextContent('false')
    expect(screen.queryByRole('dialog', { name: 'confirm-dialog' })).not.toBeInTheDocument()
    expect(handlers.onSelectHost).toHaveBeenLastCalledWith(saved.id)
  })

  it('创建失败时保留新建草稿和未保存状态', async () => {
    const user = userEvent.setup()
    const handlers = callbacks()
    vi.mocked(handlers.accessGateway.provisionHost).mockRejectedValueOnce(new Error('create failed'))
    render(
      <HostManagementWorkspace
        data={data([])}
        selectedHostId=""
        actionBusy={false}
        {...handlers}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'create-host' }))
    await user.type(screen.getByLabelText('host-draft-name'), 'pending.example.com')
    await user.click(screen.getByRole('button', { name: 'save-host' }))

    await waitFor(() => expect(handlers.accessGateway.provisionHost).toHaveBeenCalledTimes(1))
    expect(await screen.findByTestId('create-error')).toHaveTextContent('create failed')
    expect(screen.getByTestId('editing-id')).toHaveTextContent('new')
    expect(screen.getByTestId('draft-name')).toHaveTextContent('pending.example.com')
    expect(screen.getByTestId('draft-dirty')).toHaveTextContent('true')
  })

  it('同一事件重复提交只写入一次主机资产', async () => {
    const user = userEvent.setup()
    const handlers = callbacks()
    const pending = deferred<HostAccessCatalog>()
    vi.mocked(handlers.accessGateway.provisionHost).mockReturnValue(pending.promise)
    render(<HostManagementWorkspace data={data([])} selectedHostId="" actionBusy={false} {...handlers} />)
    await user.click(screen.getByRole('button', { name: 'create-host' }))
    await user.type(screen.getByLabelText('host-draft-name'), 'Only desktop')
    await user.click(screen.getByRole('button', { name: 'save-host-twice' }))
    expect(handlers.accessGateway.provisionHost).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve({ host: toHostAsset(host('created', 'unused.example.com')), ssh: [], files: [], remote_desktops: [] }) })
    expect(screen.getByTestId('editing-id')).toHaveTextContent('created')
  })

  it('目录与编辑器入口打开同一个图标管理器，并保护脏草稿引用', async () => {
    const user = userEvent.setup()
    const current = host('host-a', 'a.example.com')
    const handlers = callbacks()
    render(
      <HostManagementWorkspace
        data={data([current], [hostIcon()])}
        selectedHostId={current.id}
        actionBusy={false}
        {...handlers}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'manage-icons-catalog' }))
    expect(screen.getByRole('dialog', { name: 'host-icon-manager' })).toBeInTheDocument()
    expect(screen.getByTestId('protected-icon-ids')).toBeEmptyDOMElement()
    await user.click(screen.getByRole('button', { name: 'close-icon-manager' }))

    await user.click(screen.getByRole('button', { name: 'select-library-icon' }))
    expect(screen.getByTestId('draft-icon')).toHaveTextContent('icon-library')
    expect(screen.getByTestId('draft-dirty')).toHaveTextContent('true')
    await user.click(screen.getByRole('button', { name: 'manage-icons-editor' }))
    expect(screen.getByTestId('protected-icon-ids')).toHaveTextContent('icon-library')
  })

  it('放弃、切换、删除和卸载主机都不会自动删除图标库资源', async () => {
    const user = userEvent.setup()
    const first = host('host-a', 'a.example.com')
    const second = host('host-b', 'b.example.com')
    const handlers = callbacks()
    handlers.onDelete.mockResolvedValue(true)
    const view = render(
      <HostManagementWorkspace
        data={data([first, second], [hostIcon()])}
        selectedHostId={first.id}
        actionBusy={false}
        {...handlers}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'select-library-icon' }))
    await user.click(screen.getByRole('button', { name: 'discard-host' }))
    expect(screen.getByTestId('draft-icon')).toBeEmptyDOMElement()

    await user.click(screen.getByRole('button', { name: 'select-library-icon' }))
    await user.click(screen.getByRole('button', { name: `select-${second.id}` }))
    await user.click(await screen.findByRole('button', { name: 'confirm-intent' }))
    view.rerender(
      <HostManagementWorkspace
        data={data([first, second], [hostIcon()])}
        selectedHostId={second.id}
        actionBusy={false}
        {...handlers}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('editing-id')).toHaveTextContent(second.id))

    await user.click(screen.getByRole('button', { name: 'select-library-icon' }))
    await user.click(screen.getByRole('button', { name: 'delete-host' }))
    await waitFor(() => expect(handlers.onDelete).toHaveBeenCalledWith(second.id))

    view.unmount()
    expect(handlers.onDeleteHostIcon).not.toHaveBeenCalled()
  })
})

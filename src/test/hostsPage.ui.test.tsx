import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host, HostIcon, HostIconReorderItem, HostInput } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import type { HostManagementData } from '#features/hosts'

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

vi.mock('../features/hosts/ui/HostEditor', () => ({
  HostEditor: ({
    editingHost,
    draft,
    dirty,
    onChange,
    onBack,
    onSave,
    onDelete,
    onDiscard,
    onManageIcons,
  }: {
    editingHost?: Host
    draft: HostInput
    dirty: boolean
    onChange: (patch: Partial<HostInput>) => void
    onBack: () => void
    onSave: () => void
    onDelete: () => void
    onDiscard: () => void
    onManageIcons: () => void
  }) => (
    <section data-testid="host-editor">
      <output data-testid="editing-id">{editingHost?.id ?? 'new'}</output>
      <output data-testid="draft-address">{draft.address}</output>
      <output data-testid="draft-icon">{draft.icon_id}</output>
      <output data-testid="draft-dirty">{String(dirty)}</output>
      <input
        aria-label="host-draft-address"
        value={draft.address}
        onChange={(event) => onChange({ address: event.target.value })}
      />
      <button type="button" onClick={() => onChange({ icon_id: 'icon-library' })}>select-library-icon</button>
      <button type="button" onClick={() => onChange({ icon_id: '' })}>clear-library-icon</button>
      <button type="button" onClick={onManageIcons}>manage-icons-editor</button>
      <button type="button" onClick={onBack}>back-to-catalog</button>
      <button type="button" onClick={onSave}>save-host</button>
      <button type="button" onClick={onDelete}>delete-host</button>
      <button type="button" onClick={onDiscard}>discard-host</button>
    </section>
  ),
}))

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
    onSave: vi.fn<(id: string | null, input: HostInput) => Promise<Host | undefined>>(),
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

    await user.clear(screen.getByLabelText('host-draft-address'))
    await user.type(screen.getByLabelText('host-draft-address'), 'draft.example.com')
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
    expect(screen.getByTestId('draft-address')).toHaveTextContent('draft.example.com')

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
    expect(screen.getByTestId('draft-address')).toHaveTextContent(second.address)
  })

  it('保存失败不推进基线，成功后使用服务端快照重建草稿', async () => {
    const user = userEvent.setup()
    const current = host('host-a', 'a.example.com')
    const saved = { ...current, address: 'server.example.com' }
    let resolveSaved!: (host: Host) => void
    const savedPromise = new Promise<Host>((resolve) => {
      resolveSaved = resolve
    })
    const handlers = callbacks()
    handlers.onSave
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => savedPromise)
    const view = render(
      <HostManagementWorkspace
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        {...handlers}
      />,
    )

    await user.clear(screen.getByLabelText('host-draft-address'))
    await user.type(screen.getByLabelText('host-draft-address'), ' client.example.com ')
    await user.click(screen.getByRole('button', { name: 'save-host' }))
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1))
    expect(handlers.onSave.mock.calls[0][1].address).toBe('client.example.com')
    expect(screen.getByTestId('draft-dirty')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'save-host' }))
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(2))
    view.rerender(
      <HostManagementWorkspace
        data={data([saved])}
        selectedHostId={current.id}
        actionBusy={false}
        {...handlers}
      />,
    )
    resolveSaved(saved)
    await waitFor(() => expect(screen.getByTestId('draft-address')).toHaveTextContent(saved.address))
    expect(screen.getByTestId('draft-dirty')).toHaveTextContent('false')
    expect(handlers.onSelectHost).toHaveBeenLastCalledWith(current.id)
  })

  it('创建保存期间忽略 silent reload 的选中回声并在成功后进入新主机', async () => {
    const user = userEvent.setup()
    const saved = host('host-created', 'created.example.com')
    const pending = deferred<Host>()
    const handlers = callbacks()
    handlers.onSave.mockImplementationOnce(async () => pending.promise)
    const view = render(
      <HostManagementWorkspace
        data={data([])}
        selectedHostId=""
        actionBusy={false}
        {...handlers}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'create-host' }))
    await user.type(screen.getByLabelText('host-draft-address'), 'draft.example.com')
    await user.click(screen.getByRole('button', { name: 'save-host' }))
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ address: 'draft.example.com' }),
    ))

    view.rerender(
      <HostManagementWorkspace
        data={data([saved])}
        selectedHostId={saved.id}
        actionBusy
        {...handlers}
      />,
    )
    expect(screen.queryByRole('dialog', { name: 'confirm-dialog' })).not.toBeInTheDocument()

    pending.resolve(saved)
    await waitFor(() => expect(screen.getByTestId('editing-id')).toHaveTextContent(saved.id))
    expect(screen.getByTestId('draft-address')).toHaveTextContent(saved.address)
    expect(screen.getByTestId('draft-dirty')).toHaveTextContent('false')
    expect(screen.queryByRole('dialog', { name: 'confirm-dialog' })).not.toBeInTheDocument()
    expect(handlers.onSelectHost).toHaveBeenLastCalledWith(saved.id)
  })

  it('创建失败时保留新建草稿和未保存状态', async () => {
    const user = userEvent.setup()
    const handlers = callbacks()
    handlers.onSave.mockResolvedValueOnce(undefined)
    render(
      <HostManagementWorkspace
        data={data([])}
        selectedHostId=""
        actionBusy={false}
        {...handlers}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'create-host' }))
    await user.type(screen.getByLabelText('host-draft-address'), 'pending.example.com')
    await user.click(screen.getByRole('button', { name: 'save-host' }))

    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('editing-id')).toHaveTextContent('new')
    expect(screen.getByTestId('draft-address')).toHaveTextContent('pending.example.com')
    expect(screen.getByTestId('draft-dirty')).toHaveTextContent('true')
  })

  it('clean silent reload 同步服务端快照并更新草稿基线', async () => {
    const current = host('host-a', 'before.example.com')
    const reloaded = { ...current, address: 'after.example.com' }
    const handlers = callbacks()
    const view = render(
      <HostManagementWorkspace
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        {...handlers}
      />,
    )

    view.rerender(
      <HostManagementWorkspace
        data={data([reloaded])}
        selectedHostId={current.id}
        actionBusy={false}
        {...handlers}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('draft-address')).toHaveTextContent(reloaded.address))
    expect(screen.getByTestId('draft-dirty')).toHaveTextContent('false')
  })

  it('dirty silent reload 保留本地草稿而不覆盖未保存输入', async () => {
    const user = userEvent.setup()
    const current = host('host-a', 'before.example.com')
    const reloaded = { ...current, address: 'server.example.com' }
    const handlers = callbacks()
    const view = render(
      <HostManagementWorkspace
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        {...handlers}
      />,
    )

    await user.clear(screen.getByLabelText('host-draft-address'))
    await user.type(screen.getByLabelText('host-draft-address'), 'local.example.com')
    view.rerender(
      <HostManagementWorkspace
        data={data([reloaded])}
        selectedHostId={current.id}
        actionBusy={false}
        {...handlers}
      />,
    )

    expect(screen.getByTestId('draft-address')).toHaveTextContent('local.example.com')
    expect(screen.getByTestId('draft-dirty')).toHaveTextContent('true')
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

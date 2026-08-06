import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppData, Host, HostIcon, HostInput } from '../types/domain'

const appMocks = vi.hoisted(() => ({
  warning: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({ message: { warning: appMocks.warning } }),
  },
}))

vi.mock('../features/hosts/ui/ProxyManagerModal', () => ({
  ProxyManagerModal: () => null,
}))

vi.mock('../features/hosts/ui/HostCatalog', () => ({
  HostCatalog: ({
    hosts,
    selectedHostId,
    onSelect,
    onCreate,
  }: {
    hosts: Host[]
    selectedHostId: string | null
    onSelect: (hostId: string) => void
    onCreate: () => void
  }) => (
    <section data-testid="host-catalog" data-selected-id={selectedHostId ?? ''}>
      {hosts.map((host) => (
        <button key={host.id} type="button" onClick={() => onSelect(host.id)}>
          select-{host.id}
        </button>
      ))}
      <button type="button" onClick={onCreate}>create-host</button>
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
    onDiscard,
    onUploadIcon,
  }: {
    editingHost?: Host
    draft: HostInput
    dirty: boolean
    onChange: (patch: Partial<HostInput>) => void
    onBack: () => void
    onSave: () => void
    onDiscard: () => void
    onUploadIcon: (file: File) => Promise<void>
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
      <input
        aria-label="host-icon-file"
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void onUploadIcon(file)
        }}
      />
      <button type="button" onClick={onBack}>back-to-catalog</button>
      <button type="button" onClick={onSave}>save-host</button>
      <button type="button" onClick={onDiscard}>discard-host</button>
    </section>
  ),
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

  it('放弃和卸载会清理未保存图标，保存成功后解除清理责任', async () => {
    const user = userEvent.setup()
    const current = host('host-a', 'a.example.com')
    const handlers = callbacks()
    handlers.onUploadHostIcon
      .mockResolvedValueOnce({ id: 'icon-discard', file_name: 'discard.png', mime_type: 'image/png', size_bytes: 3, sha256: 'a', created_at: '' })
      .mockResolvedValueOnce({ id: 'icon-unmount', file_name: 'unmount.png', mime_type: 'image/png', size_bytes: 3, sha256: 'b', created_at: '' })
      .mockResolvedValueOnce({ id: 'icon-saved', file_name: 'saved.png', mime_type: 'image/png', size_bytes: 3, sha256: 'c', created_at: '' })
    handlers.onSave.mockImplementation(async (_id, input) => ({ ...current, icon_id: input.icon_id }))
    const view = render(
      <HostManagementWorkspace
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        {...handlers}
      />,
    )

    const input = screen.getByLabelText('host-icon-file')
    await user.upload(input, new File(['one'], 'discard.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByTestId('draft-icon')).toHaveTextContent('icon-discard'))
    await user.click(screen.getByRole('button', { name: 'discard-host' }))
    await waitFor(() => expect(handlers.onDeleteHostIcon).toHaveBeenCalledWith('icon-discard'))

    await user.upload(input, new File(['two'], 'unmount.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByTestId('draft-icon')).toHaveTextContent('icon-unmount'))
    view.unmount()
    await waitFor(() => expect(handlers.onDeleteHostIcon).toHaveBeenCalledWith('icon-unmount'))

    const savedView = render(
      <HostManagementWorkspace
        data={data([current])}
        selectedHostId={current.id}
        actionBusy={false}
        {...handlers}
      />,
    )
    await user.upload(screen.getByLabelText('host-icon-file'), new File(['three'], 'saved.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByTestId('draft-icon')).toHaveTextContent('icon-saved'))
    await user.click(screen.getByRole('button', { name: 'save-host' }))
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalled())
    savedView.unmount()
    expect(handlers.onDeleteHostIcon).not.toHaveBeenCalledWith('icon-saved')
  })
})

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '#entities/host'
import type { HostAccessCatalog, HostAsset } from '#entities/host-asset'
import type { HostAccessWorkspaceGateway, HostProvisionGateway } from '#features/host-access'
import { HostManagementWorkspace } from './HostManagementWorkspace.tsx'

vi.mock('./HostAccessWorkspace', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    HostAccessWorkspace: ({
      host,
      openAccessIntentKey,
      initialView,
      initialConnectionSetupConsidered,
      gateway,
      onBack,
      onDirtyChange,
    }: {
      host: HostAsset
      openAccessIntentKey?: number
      initialView?: 'asset' | 'access'
      initialConnectionSetupConsidered?: boolean
      gateway: HostAccessWorkspaceGateway
      onBack: () => void
      onDirtyChange: (dirty: boolean) => void
    }) => {
      const [draft, setDraft] = React.useState(host.name)
      React.useEffect(() => {
        void gateway.loadCatalog(host.id)
        void gateway.listSSHProfiles()
      }, [gateway, host.id])
      return (
        <div>
          <output data-testid="access-draft">{draft}</output>
          <output data-testid="initial-view">{initialView ?? 'asset'}</output>
          <output data-testid="initial-setup-considered">{String(Boolean(initialConnectionSetupConsidered))}</output>
          <output data-testid="access-intent">{`${host.id}:${openAccessIntentKey ?? 0}`}</output>
          <button
            type="button"
            onClick={() => {
              setDraft('未保存访问草稿')
              onDirtyChange(true)
            }}
          >
            修改访问草稿
          </button>
          <button type="button" onClick={onBack}>返回主机列表</button>
        </div>
      )
    },
  }
})

const host: Host = {
  id: 'host-a',
  name: '测试主机',
  platform: 'linux',
  group_id: '',
  address: 'host-a.example.com',
  port: 22,
  username: 'root',
  auth_method: 'password',
  credential_id: 'credential-a',
  tags: [],
  favorite: false,
  fingerprint_policy: 'confirm_on_change',
}

const secondHost: Host = {
  ...host,
  id: 'host-b',
  name: '备用主机',
  address: 'host-b.example.com',
}

function assetFromHost(source: Host): HostAsset {
  return {
    id: source.id,
    name: source.name,
    platform: source.platform,
    icon_id: source.icon_id,
    group_id: source.group_id,
    tags: [...source.tags],
    favorite: source.favorite,
    note: source.note,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
  }
}

const accessGateway: HostAccessWorkspaceGateway & HostProvisionGateway = {
  provisionHost: vi.fn(),
  loadCatalog: vi.fn(),
  listSSHProfiles: vi.fn(),
  updateHostAsset: vi.fn(),
  createSSHProfile: vi.fn(),
  updateSSHProfile: vi.fn(),
  deleteSSHProfile: vi.fn(),
  setDefaultSSHProfile: vi.fn(),
  inspectSSHProfileReferences: vi.fn(),
  updateFileProfile: vi.fn(),
  setDefaultFileProfile: vi.fn(),
  createRemoteDesktopProfile: vi.fn(),
  updateRemoteDesktopProfile: vi.fn(),
  deleteRemoteDesktopProfile: vi.fn(),
  saveRemoteDesktopTargetAuth: vi.fn(),
  deleteRemoteDesktopTargetAuth: vi.fn(),
  setDefaultRemoteDesktopProfile: vi.fn(),
  loadSSHProfileReachability: vi.fn(),
  refreshSSHProfileReachability: vi.fn(),
  sshProfileReachabilityEventsUrl: vi.fn(),
}

function createProps() {
  return {
    data: {
      hosts: [], hostAssets: [], sshAccessProfiles: [], groups: [], proxies: [],
      credentials: [], hostIcons: [], sessions: [], fileSessions: [], forwards: [],
      remoteDesktopSessions: [],
    },
    selectedHostId: '', actionBusy: false,
    entryIntent: { key: 1, mode: 'create' as const },
    accessGateway: { ...accessGateway, provisionHost: vi.fn() },
    onSelectHost: vi.fn(), onDelete: vi.fn(), onCreateGroup: vi.fn(),
    onRenameGroup: vi.fn(), onDeleteGroup: vi.fn(), onReorderGroups: vi.fn(),
    onCreateProxy: vi.fn(), onUpdateProxy: vi.fn(), onDeleteProxy: vi.fn(),
    onUploadHostIcon: vi.fn(), onRenameHostIcon: vi.fn(), onReorderHostIcons: vi.fn(),
    onDeleteHostIcon: vi.fn(), getHostIconUrl: () => '',
  }
}

function confirmHostOnlySave() {
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'hosts.creation.saveHostOnly' }))
}

describe('主机管理工作区', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['catalog', 'create'] as const)('已有主机时以 %s 进入意图首帧不加载现有主机目录', async (mode) => {
    const props = createProps()
    const selected = assetFromHost(host)
    const onEntryIntentHandled = vi.fn()

    render(
      <HostManagementWorkspace
        {...props}
        data={{ ...props.data, hostAssets: [selected] }}
        selectedHostId={selected.id}
        entryIntent={{ key: 7, mode }}
        onEntryIntentHandled={onEntryIntentHandled}
      />,
    )

    expect(document.querySelector('.hosts-management-workspace')).toHaveAttribute(
      'data-active-view',
      mode === 'create' ? 'editor' : 'catalog',
    )
    expect(props.accessGateway.loadCatalog).not.toHaveBeenCalled()
    expect(props.accessGateway.listSSHProfiles).not.toHaveBeenCalled()
    await waitFor(() => expect(onEntryIntentHandled).toHaveBeenCalledExactlyOnceWith(7))
  })

  it('普通导航仍按选中主机加载访问目录', async () => {
    const props = createProps()
    const selected = assetFromHost(host)

    render(
      <HostManagementWorkspace
        {...props}
        data={{ ...props.data, hostAssets: [selected] }}
        selectedHostId={selected.id}
        entryIntent={null}
      />,
    )

    await waitFor(() => expect(props.accessGateway.loadCatalog).toHaveBeenCalledExactlyOnceWith(selected.id))
    expect(props.accessGateway.listSSHProfiles).toHaveBeenCalledTimes(1)
  })

  it('目录进入意图后可用编辑意图重新打开同一个已选主机', async () => {
    const props = createProps()
    const selected = assetFromHost(host)
    const onEntryIntentHandled = vi.fn()
    const view = render(
      <HostManagementWorkspace
        {...props}
        data={{ ...props.data, hostAssets: [selected] }}
        selectedHostId={selected.id}
        entryIntent={{ key: 1, mode: 'catalog' }}
        onEntryIntentHandled={onEntryIntentHandled}
      />,
    )
    await waitFor(() => expect(onEntryIntentHandled).toHaveBeenCalledWith(1))
    expect(document.querySelector('.hosts-management-workspace')).toHaveAttribute(
      'data-active-view',
      'catalog',
    )

    view.rerender(
      <HostManagementWorkspace
        {...props}
        data={{ ...props.data, hostAssets: [selected] }}
        selectedHostId={selected.id}
        entryIntent={{ key: 2, mode: 'edit', hostId: selected.id }}
        onEntryIntentHandled={onEntryIntentHandled}
      />,
    )

    await waitFor(() => expect(onEntryIntentHandled).toHaveBeenCalledWith(2))
    await waitFor(() => expect(props.accessGateway.loadCatalog).toHaveBeenCalledWith(selected.id))
    expect(document.querySelector('.hosts-management-workspace')).toHaveAttribute(
      'data-active-view',
      'editor',
    )
  })

  it('已挂载工作区的进入意图继续经过脏草稿确认', () => {
    const props = createProps()
    const selected = assetFromHost(host)
    const view = render(
      <HostManagementWorkspace
        {...props}
        data={{ ...props.data, hostAssets: [selected] }}
        selectedHostId={selected.id}
        entryIntent={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '修改访问草稿' }))

    view.rerender(
      <HostManagementWorkspace
        {...props}
        data={{ ...props.data, hostAssets: [selected] }}
        selectedHostId={selected.id}
        entryIntent={{ key: 8, mode: 'catalog' }}
      />,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('access-draft')).toHaveTextContent('未保存访问草稿')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'app.cancel' }))
    expect(screen.getByTestId('access-draft')).toHaveTextContent('未保存访问草稿')
    expect(document.querySelector('.hosts-management-workspace')).toHaveAttribute(
      'data-active-view',
      'editor',
    )
  })

  it('没有凭据和 SSH 配置也可创建，迟到的列表快照不使编辑器退回新建', async () => {
    const props = createProps()
    const saved = assetFromHost(host)
    props.accessGateway.provisionHost.mockResolvedValue({ host: saved, ssh: [], files: [], remote_desktops: [] })
    const view = render(<HostManagementWorkspace {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: '  测试主机  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    expect(props.accessGateway.provisionHost).not.toHaveBeenCalled()
    confirmHostOnlySave()
    expect(await screen.findByTestId('access-draft')).toHaveTextContent(saved.name)
    expect(props.accessGateway.provisionHost).toHaveBeenCalledExactlyOnceWith({
      client_request_id: expect.any(String),
      host: {
        name: '测试主机', platform: 'linux', group_id: '', icon_id: '',
        tags: [], favorite: false, note: '',
      },
      ssh: [], remote_desktops: [],
    })
    expect(screen.getByTestId('initial-view')).toHaveTextContent('asset')
    expect(screen.getByTestId('initial-setup-considered')).toHaveTextContent('true')
    expect(props.onSelectHost).toHaveBeenCalledWith(saved.id)

    view.rerender(<HostManagementWorkspace {...props} selectedHostId={saved.id} />)
    expect(screen.getByTestId('access-draft')).toHaveTextContent(saved.name)
    view.rerender(<HostManagementWorkspace {...props} selectedHostId={saved.id} data={{ ...props.data, hostAssets: [saved] }} />)
    expect(screen.getByTestId('access-draft')).toHaveTextContent(saved.name)
    expect(props.accessGateway.provisionHost).toHaveBeenCalledTimes(1)
  })

  it.each(['asset', 'connections'] as const)('已有多主机时快照迟到仍保持新主机及 %s 页签', async (section) => {
    const defaults = createProps()
    const originalAssets = [assetFromHost(host), assetFromHost(secondHost)]
    const saved = { ...assetFromHost(host), id: 'host-c', name: '新建主机 C' }
    const props = {
      ...defaults,
      entryIntent: null,
      selectedHostId: secondHost.id,
      data: { ...defaults.data, hostAssets: originalAssets },
    }
    props.accessGateway.provisionHost.mockResolvedValue({ host: saved, ssh: [], files: [], remote_desktops: [] })
    const view = render(<HostManagementWorkspace {...props} />)
    expect(screen.getByTestId('access-draft')).toHaveTextContent(secondHost.name)
    fireEvent.click(screen.getByRole('button', { name: 'hosts.addHost' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: saved.name } })
    if (section === 'connections') {
      fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' }))
    }
    expect(props.accessGateway.provisionHost).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    confirmHostOnlySave()
    expect(await screen.findByTestId('access-draft')).toHaveTextContent(saved.name)
    expect(props.onSelectHost).toHaveBeenCalledWith(saved.id)

    view.rerender(<HostManagementWorkspace {...props} selectedHostId={saved.id} />)
    expect(screen.getByTestId('access-draft')).toHaveTextContent(saved.name)
    expect(screen.getByTestId('initial-view')).toHaveTextContent(section === 'asset' ? 'asset' : 'access')
    expect(screen.getByTestId('initial-setup-considered')).toHaveTextContent('true')
    expect(screen.getByTestId('access-intent')).toHaveTextContent(`${saved.id}:0`)

    view.rerender(<HostManagementWorkspace {...props} selectedHostId={saved.id} data={{ ...props.data, hostAssets: [...originalAssets, saved] }} />)
    expect(screen.getByTestId('access-draft')).toHaveTextContent(saved.name)
    expect(screen.getByTestId('initial-view')).toHaveTextContent(section === 'asset' ? 'asset' : 'access')
    expect(screen.getByTestId('initial-setup-considered')).toHaveTextContent('true')
    expect(props.accessGateway.provisionHost).toHaveBeenCalledTimes(1)
  })

  it('整体保存失败保留主机草稿和页签，重试成功保持连接页', async () => {
    const props = createProps()
    props.accessGateway.provisionHost.mockRejectedValueOnce(new Error('service unavailable'))
      .mockResolvedValueOnce({ host: assetFromHost(host), ssh: [], files: [], remote_desktops: [] })
    render(<HostManagementWorkspace {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: host.name } })
    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' }))
    expect(props.accessGateway.provisionHost).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    confirmHostOnlySave()
    expect(await screen.findByText('service unavailable')).toBeVisible()
    expect(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.hostInfo' }))
    expect(screen.getByRole('textbox', { name: 'hosts.name' })).toHaveValue(host.name)
    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' }))
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    expect(await screen.findByTestId('access-draft')).toHaveTextContent(host.name)
    expect(props.accessGateway.provisionHost).toHaveBeenCalledTimes(2)
    expect(props.accessGateway.provisionHost.mock.calls[1][0]).toEqual(props.accessGateway.provisionHost.mock.calls[0][0])
  })

  it('仅切换连接页不视作已选择，保存空连接仍需明确确认', async () => {
    const props = createProps()
    const saved = assetFromHost(host)
    props.accessGateway.provisionHost.mockResolvedValue({ host: saved, ssh: [], files: [], remote_desktops: [] })
    render(<HostManagementWorkspace {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: saved.name } })
    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' }))
    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.hostInfo' }))
    expect(props.accessGateway.provisionHost).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    expect(props.accessGateway.provisionHost).not.toHaveBeenCalled()
    confirmHostOnlySave()
    expect(await screen.findByTestId('access-draft')).toHaveTextContent(saved.name)
    expect(screen.getByTestId('initial-view')).toHaveTextContent('asset')
    expect(screen.getByTestId('initial-setup-considered')).toHaveTextContent('true')
  })

  it('创建请求期间不能通过目录切走，成功后仅创建一次', async () => {
    const props = createProps()
    let resolve!: (catalog: HostAccessCatalog) => void
    props.accessGateway.provisionHost.mockImplementation(() => new Promise<HostAccessCatalog>((done) => { resolve = done }))
    const saved = assetFromHost(secondHost)
    render(<HostManagementWorkspace {...props} data={{ ...props.data, hostAssets: [assetFromHost(host)] }} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: saved.name } })
    const submit = screen.getByRole('button', { name: 'app.save' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(props.accessGateway.provisionHost).not.toHaveBeenCalled()
    confirmHostOnlySave()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(host.name) }))
    expect(props.accessGateway.provisionHost).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('access-draft')).not.toBeInTheDocument()
    await act(async () => { resolve({ host: saved, ssh: [], files: [], remote_desktops: [] }) })
    await waitFor(() => expect(screen.getByTestId('access-draft')).toHaveTextContent(saved.name))
  })

  it.each(['success', 'failure'] as const)('创建 %s 时同步通知保存锁并在结束后释放', async (outcome) => {
    const props = createProps()
    const onSavingChange = vi.fn()
    let resolve!: (catalog: HostAccessCatalog) => void
    let reject!: (cause: Error) => void
    props.accessGateway.provisionHost.mockImplementation(() => {
      expect(onSavingChange).toHaveBeenLastCalledWith(true)
      return new Promise<HostAccessCatalog>((done, fail) => { resolve = done; reject = fail })
    })
    render(<HostManagementWorkspace {...props} onSavingChange={onSavingChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: host.name } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    confirmHostOnlySave()
    expect(onSavingChange.mock.calls).toEqual([[true]])
    await act(async () => {
      if (outcome === 'success') resolve({ host: assetFromHost(host), ssh: [], files: [], remote_desktops: [] })
      else reject(new Error('保存失败'))
    })
    expect(onSavingChange.mock.calls).toEqual([[true], [false]])
    if (outcome === 'failure') {
      expect(screen.getByRole('textbox', { name: 'hosts.name' })).toHaveValue(host.name)
      expect(screen.getByText('保存失败')).toBeVisible()
    }
  })

  it('卸载时释放保存锁，迟到成功不覆盖新页面选择或再次解除新挂载锁', async () => {
    const props = createProps()
    const onSavingChange = vi.fn()
    let resolve!: (catalog: HostAccessCatalog) => void
    props.accessGateway.provisionHost.mockImplementation(() => new Promise<HostAccessCatalog>((done) => { resolve = done }))
    const view = render(<HostManagementWorkspace {...props} onSavingChange={onSavingChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: host.name } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    confirmHostOnlySave()
    expect(onSavingChange).toHaveBeenLastCalledWith(true)
    view.unmount()
    expect(onSavingChange.mock.calls).toEqual([[true], [false]])
    await act(async () => resolve({ host: assetFromHost(host), ssh: [], files: [], remote_desktops: [] }))
    expect(props.onSelectHost).not.toHaveBeenCalled()
    expect(onSavingChange.mock.calls).toEqual([[true], [false]])
  })

  it('已选主机被外部删除且无草稿时，切换到仍存在的主机', () => {
    const props = { ...createProps(), entryIntent: null, selectedHostId: secondHost.id }
    const assetA = assetFromHost(host)
    const assetB = assetFromHost(secondHost)
    const view = render(<HostManagementWorkspace {...props} data={{ ...props.data, hostAssets: [assetA, assetB] }} />)
    expect(screen.getByTestId('access-draft')).toHaveTextContent(secondHost.name)
    view.rerender(<HostManagementWorkspace {...props} data={{ ...props.data, hostAssets: [assetA] }} />)
    expect(screen.getByTestId('access-draft')).toHaveTextContent(host.name)
    expect(screen.queryByRole('textbox', { name: 'hosts.name' })).not.toBeInTheDocument()
    expect(props.onSelectHost).toHaveBeenCalledExactlyOnceWith(host.id)
  })

  it('主机被外部删除时保留脏编辑器，确认离开才释放草稿且不把删除项放回目录', () => {
    const props = { ...createProps(), entryIntent: null, selectedHostId: secondHost.id }
    const assetA = assetFromHost(host)
    const assetB = assetFromHost(secondHost)
    const view = render(<HostManagementWorkspace {...props} data={{ ...props.data, hostAssets: [assetA, assetB] }} />)
    fireEvent.click(screen.getByRole('button', { name: '修改访问草稿' }))
    view.rerender(<HostManagementWorkspace {...props} data={{ ...props.data, hostAssets: [assetA] }} />)
    expect(screen.getByTestId('access-draft')).toHaveTextContent('未保存访问草稿')
    expect(screen.getByTestId('access-intent')).toHaveTextContent('host-b:0')
    expect(screen.queryByRole('button', { name: new RegExp(secondHost.name) })).not.toBeInTheDocument()
    expect(props.onSelectHost).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(host.name) }))
    fireEvent.click(screen.getByRole('button', { name: 'app.cancel' }))
    expect(screen.getByTestId('access-draft')).toHaveTextContent('未保存访问草稿')
    fireEvent.click(screen.getByRole('button', { name: new RegExp(host.name) }))
    fireEvent.click(screen.getByRole('button', { name: 'hosts.discardAndContinue' }))
    expect(screen.getByTestId('access-draft')).toHaveTextContent(host.name)
  })

  it('最后一台主机外部删除后返回目录，保留原编辑器而不自动开始新建', () => {
    const props = { ...createProps(), entryIntent: null, selectedHostId: host.id }
    const view = render(<HostManagementWorkspace {...props} data={{ ...props.data, hostAssets: [assetFromHost(host)] }} />)
    view.rerender(<HostManagementWorkspace {...props} />)
    expect(screen.getByTestId('access-draft')).toHaveTextContent(host.name)
    expect(screen.queryByRole('textbox', { name: 'hosts.name' })).not.toBeInTheDocument()
    expect(document.querySelector('.hosts-management-workspace')).toHaveAttribute('data-active-view', 'catalog')
    expect(props.onSelectHost).toHaveBeenCalledExactlyOnceWith('')
  })

  it('旧主机投影为空时仍可选择和管理纯资产', () => {
    const asset = assetFromHost(host)
    render(
      <HostManagementWorkspace
        data={{
          hosts: [],
          hostAssets: [asset],
          sshAccessProfiles: [],
          groups: [],
          proxies: [],
          credentials: [],
          hostIcons: [],
          sessions: [],
          fileSessions: [],
          forwards: [],
          remoteDesktopSessions: [],
        }}
        selectedHostId={asset.id}
        actionBusy={false}
        accessGateway={accessGateway}
        onSelectHost={vi.fn()}
        onDelete={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onReorderGroups={vi.fn()}
        onCreateProxy={vi.fn()}
        onUpdateProxy={vi.fn()}
        onDeleteProxy={vi.fn()}
        onUploadHostIcon={vi.fn()}
        onRenameHostIcon={vi.fn()}
        onReorderHostIcons={vi.fn()}
        onDeleteHostIcon={vi.fn()}
        getHostIconUrl={() => ''}
      />,
    )

    expect(screen.getByTestId('access-draft')).toHaveTextContent(asset.name)
    expect(screen.getByRole('button', { name: new RegExp(asset.name) })).toBeInTheDocument()
  })

  it('确认放弃访问草稿后重置隐藏编辑器状态', () => {
    render(
      <HostManagementWorkspace
        data={{
          hosts: [host],
          hostAssets: [assetFromHost(host)],
          sshAccessProfiles: [],
          groups: [],
          proxies: [],
          credentials: [],
          hostIcons: [],
          sessions: [],
          fileSessions: [],
          forwards: [],
          remoteDesktopSessions: [],
        }}
        selectedHostId={host.id}
        actionBusy={false}
        accessGateway={accessGateway}
        onSelectHost={vi.fn()}
        onDelete={vi.fn()}
        onCreateGroup={vi.fn()}
        onRenameGroup={vi.fn()}
        onDeleteGroup={vi.fn()}
        onReorderGroups={vi.fn()}
        onCreateProxy={vi.fn()}
        onUpdateProxy={vi.fn()}
        onDeleteProxy={vi.fn()}
        onUploadHostIcon={vi.fn()}
        onRenameHostIcon={vi.fn()}
        onReorderHostIcons={vi.fn()}
        onDeleteHostIcon={vi.fn()}
        getHostIconUrl={() => ''}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '修改访问草稿' }))
    expect(screen.getByTestId('access-draft')).toHaveTextContent('未保存访问草稿')

    fireEvent.click(screen.getByRole('button', { name: '返回主机列表' }))
    fireEvent.click(screen.getByRole('button', { name: 'hosts.discardAndContinue' }))

    expect(screen.getByTestId('access-draft')).toHaveTextContent('测试主机')
    fireEvent.click(screen.getByRole('button', { name: /测试主机/ }))
    expect(screen.getByTestId('access-draft')).toHaveTextContent('测试主机')
  })

  it('跨主机访问意图只在目标主机确认加载后消费', () => {
    const onSelectHost = vi.fn()
    const onAccessIntentHandled = vi.fn()
    const props = {
      data: {
        hosts: [host, secondHost],
        hostAssets: [assetFromHost(host), assetFromHost(secondHost)],
        sshAccessProfiles: [],
        groups: [],
        proxies: [],
        credentials: [],
        hostIcons: [],
        sessions: [],
        fileSessions: [],
        forwards: [],
        remoteDesktopSessions: [],
      },
      actionBusy: false,
      accessGateway,
      onSelectHost,
      onAccessIntentHandled,
      onDelete: vi.fn(),
      onCreateGroup: vi.fn(),
      onRenameGroup: vi.fn(),
      onDeleteGroup: vi.fn(),
      onReorderGroups: vi.fn(),
      onCreateProxy: vi.fn(),
      onUpdateProxy: vi.fn(),
      onDeleteProxy: vi.fn(),
      onUploadHostIcon: vi.fn(),
      onRenameHostIcon: vi.fn(),
      onReorderHostIcons: vi.fn(),
      onDeleteHostIcon: vi.fn(),
      getHostIconUrl: () => '',
    }
    const view = render(
      <HostManagementWorkspace
        {...props}
        selectedHostId={host.id}
        accessIntent={{ key: 1, hostId: host.id }}
      />,
    )

    expect(screen.getByTestId('access-intent')).toHaveTextContent('host-a:1')
    fireEvent.click(screen.getByRole('button', { name: '修改访问草稿' }))

    view.rerender(
      <HostManagementWorkspace
        {...props}
        selectedHostId={secondHost.id}
        accessIntent={{ key: 2, hostId: secondHost.id }}
      />,
    )

    expect(screen.getByTestId('access-intent')).toHaveTextContent('host-a:0')
    fireEvent.click(screen.getByRole('button', { name: 'app.cancel' }))
    expect(onAccessIntentHandled).toHaveBeenCalledWith(2)
    expect(screen.getByTestId('access-intent')).toHaveTextContent('host-a:0')

    view.rerender(
      <HostManagementWorkspace
        {...props}
        selectedHostId={host.id}
        accessIntent={null}
      />,
    )
    view.rerender(
      <HostManagementWorkspace
        {...props}
        selectedHostId={secondHost.id}
        accessIntent={{ key: 3, hostId: secondHost.id }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'hosts.discardAndContinue' }))
    expect(screen.getByTestId('access-intent')).toHaveTextContent('host-b:3')
    expect(screen.getByTestId('access-draft')).toHaveTextContent('备用主机')
  })

  it('重新进入新增流程时重置页签和上一轮校验状态', () => {
    const props = {
      data: {
        hosts: [],
        hostAssets: [],
        sshAccessProfiles: [],
        groups: [],
        proxies: [],
        credentials: [],
        hostIcons: [],
        sessions: [],
        fileSessions: [],
        forwards: [],
        remoteDesktopSessions: [],
      },
      selectedHostId: '',
      actionBusy: false,
      accessGateway,
      onSelectHost: vi.fn(),
      onDelete: vi.fn(),
      onCreateGroup: vi.fn(),
      onRenameGroup: vi.fn(),
      onDeleteGroup: vi.fn(),
      onReorderGroups: vi.fn(),
      onCreateProxy: vi.fn(),
      onUpdateProxy: vi.fn(),
      onDeleteProxy: vi.fn(),
      onUploadHostIcon: vi.fn(),
      onRenameHostIcon: vi.fn(),
      onReorderHostIcons: vi.fn(),
      onDeleteHostIcon: vi.fn(),
      getHostIconUrl: () => '',
    }
    const view = render(
      <HostManagementWorkspace {...props} entryIntent={{ key: 1, mode: 'create' }} />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.note' }), { target: { value: '尚未命名的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    expect(screen.getByText('hosts.access.errors.required')).toBeVisible()

    view.rerender(
      <HostManagementWorkspace {...props} entryIntent={{ key: 2, mode: 'create' }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'hosts.discardAndContinue' }))

    expect(screen.getByRole('tab', { name: 'hosts.access.hostInfo' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: 'hosts.note' })).toHaveValue('')
    expect(screen.queryByText('hosts.access.errors.required')).not.toBeInTheDocument()
  })
})

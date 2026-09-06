import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HostAccessCatalog, HostAsset } from '#entities/host-asset'
import type { HostAccessManagementGateway } from '#features/host-access'
import { TermousApiError } from '#shared/api'
import { useHostAccessWorkspaceController, type HostDetailView } from './useHostAccessWorkspaceController.ts'

function legacyHost(id: string, name = id): HostAsset {
  return {
    id,
    name,
    platform: 'linux',
    group_id: '',
    tags: [],
    favorite: false,
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
  }
}

function catalog(id: string, overrides: Partial<HostAccessCatalog> = {}): HostAccessCatalog {
  const ssh = {
    id: `ssh-${id}`,
    host_id: id,
    name: 'Primary SSH',
    address: `${id}.example.com`,
    port: 22,
    username: 'root',
    auth_method: 'password' as const,
    credential_id: 'cred-password',
    fingerprint_policy: 'confirm_on_change',
    is_default: true,
    sort_order: 0,
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
  }
  return {
    host: {
      id,
      name: id,
      platform: 'linux',
      group_id: '',
      tags: [],
      favorite: false,
      created_at: '2026-08-25T00:00:00Z',
      updated_at: '2026-08-25T00:00:00Z',
    },
    ssh: [ssh],
    files: [{
      id: `file-${id}`,
      host_id: id,
      name: 'SFTP',
      engine: 'sftp',
      engine_config_version: 1,
      sftp: { ssh_profile_id: ssh.id },
      is_default: true,
      sort_order: 0,
      created_at: '2026-08-25T00:00:00Z',
      updated_at: '2026-08-25T00:00:00Z',
    }],
    remote_desktops: [],
    ...overrides,
  }
}

function remoteDesktopProfile(hostId: string) {
  return {
    id: `rdp-${hostId}`,
    host_id: hostId,
    name: 'Desktop',
    description: '',
    route: 'ssh_tunnel' as const,
    route_config_version: 1 as const,
    ssh_profile_id: `ssh-${hostId}`,
    protocol: 'vnc' as const,
    protocol_config_version: 1 as const,
    vnc: {
      target_host: '127.0.0.1' as const,
      port: 5901,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit' as const,
    },
    is_default: true,
    sort_order: 0,
    target_auth: null,
    created_at: '2026-08-25T00:00:00Z',
    updated_at: '2026-08-25T00:00:00Z',
  }
}

function gateway(initial: HostAccessCatalog): HostAccessManagementGateway {
  return {
    loadCatalog: vi.fn().mockResolvedValue(initial),
    listSSHProfiles: vi.fn().mockResolvedValue(initial.ssh),
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
  }
}

function ControllerHarness({
  host,
  api,
  openAccessIntentKey = 0,
  initialView,
  initialConnectionSetupConsidered,
}: {
  host: HostAsset
  api: HostAccessManagementGateway
  openAccessIntentKey?: number
  initialView?: HostDetailView
  initialConnectionSetupConsidered?: boolean
}) {
  const controller = useHostAccessWorkspaceController({
    hostId: host.id,
    fallbackHost: host,
    gateway: api,
    t: (key) => key,
    openAccessIntentKey,
    initialView,
    initialConnectionSetupConsidered,
  })
  return (
    <div>
      <output data-testid="catalog-host">{controller.catalog?.host.id ?? 'loading'}</output>
      <output data-testid="asset-name">{controller.assetDraft.name}</output>
      <output data-testid="asset-validation-visible">{String(controller.assetValidationVisible)}</output>
      <output data-testid="profile-validation-visible">{String(controller.profileValidationVisible)}</output>
      <output data-testid="view">{controller.view}</output>
      <output data-testid="editor">{controller.editor?.kind ?? ''}</output>
      <output data-testid="dirty">{String(controller.assetDirty || controller.profileDirty)}</output>
      <output data-testid="connection-setup-prompt">{String(controller.connectionSetupPromptOpen)}</output>
      <output data-testid="refreshing">{String(controller.refreshing)}</output>
      <output data-testid="pending">{String(Boolean(controller.pendingNavigation))}</output>
      <output data-testid="error">{controller.mutationError}</output>
      <output data-testid="catalog-error">{controller.error?.message ?? ''}</output>
      <output data-testid="file-count">{controller.catalog?.files.length ?? 0}</output>
      <output data-testid="default-ssh">{controller.catalog?.ssh.find((profile) => profile.is_default)?.id ?? ''}</output>
      <output data-testid="vnc-name">{controller.vncDraft.name}</output>
      <output data-testid="vnc-ssh-profile">{controller.vncDraft.ssh_profile_id}</output>
      <output data-testid="vnc-target-auth-mutation">{controller.vncTargetAuthDraft.mutation}</output>
      <button type="button" onClick={() => controller.setAssetDraft({ ...controller.assetDraft, name: 'Local draft' })}>edit-asset</button>
      <button type="button" onClick={() => controller.setAssetDraft({ ...controller.assetDraft, name: 'Renamed again' })}>edit-asset-again</button>
      <button type="button" onClick={() => controller.setAssetDraft({ ...controller.assetDraft, name: '' })}>invalidate-asset</button>
      <button type="button" onClick={() => void controller.saveAsset()}>save-asset</button>
      <button
        type="button"
        onClick={() => {
          void controller.saveAsset()
          void controller.saveAsset()
        }}
      >
        save-asset-twice
      </button>
      <button type="button" onClick={() => controller.requestView('access')}>open-access</button>
      <button type="button" onClick={() => controller.requestView('asset')}>open-asset</button>
      <button type="button" onClick={controller.requestCloseEditor}>close-editor</button>
      <button type="button" onClick={() => void controller.reload()}>reload</button>
      <button type="button" onClick={controller.dismissConnectionSetup}>dismiss-setup</button>
      <button type="button" onClick={controller.goToConnectionSetup}>go-to-setup</button>
      <button type="button" onClick={controller.confirmPendingNavigation}>confirm-navigation</button>
      <button type="button" onClick={() => controller.requestEditor({ kind: 'ssh', mode: 'create' })}>create-ssh</button>
      <button type="button" onClick={() => controller.setSSHDraft({ ...controller.sshDraft, port: null })}>invalidate-ssh</button>
      <button
        type="button"
        onClick={() => controller.setSSHDraft({
          ...controller.sshDraft,
          name: 'Secondary SSH',
          address: 'secondary.example.com',
          username: 'ops',
          credential_id: 'cred-password',
        })}
      >
        fill-ssh
      </button>
      <button type="button" onClick={() => void controller.saveProfile()}>save-profile</button>
      <button type="button" onClick={() => void controller.setDefaultProfile('ssh', 'ssh-secondary')}>default-secondary</button>
      <button type="button" onClick={() => controller.requestEditor({ kind: 'remote_desktop', mode: 'create' })}>create-vnc</button>
      <button
        type="button"
        onClick={() => controller.requestEditor({
          kind: 'remote_desktop',
          mode: 'edit',
          profileId: `rdp-${host.id}`,
        })}
      >
        edit-vnc
      </button>
      <button
        type="button"
        onClick={() => {
          controller.setVNCDraft({ ...controller.vncDraft, name: 'Updated desktop' })
          controller.setVNCTargetAuthDraft({ mutation: 'replace', password: 'secret' })
        }}
      >
        fill-vnc-auth
      </button>
    </div>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

describe('主机访问方式 Controller', () => {
  it('忽略切换主机后才返回的旧 Catalog', async () => {
    const first = deferred<HostAccessCatalog>()
    const second = deferred<HostAccessCatalog>()
    const api = gateway(catalog('host-a'))
    vi.mocked(api.loadCatalog).mockImplementation((hostId) => (
      hostId === 'host-a' ? first.promise : second.promise
    ))
    const view = render(<ControllerHarness host={legacyHost('host-a')} api={api} />)
    view.rerender(<ControllerHarness host={legacyHost('host-b')} api={api} />)

    await act(async () => { second.resolve(catalog('host-b')) })
    expect(await screen.findByTestId('catalog-host')).toHaveTextContent('host-b')
    await act(async () => { first.resolve(catalog('host-a')) })
    expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-b')
  })

  it('CAS 冲突保留资产草稿并刷新 revision 后允许重试', async () => {
    const source = catalog('host-a')
    const concurrent = {
      ...source,
      host: {
        ...source.host,
        name: 'Concurrent change',
        updated_at: '2026-08-25T00:00:01Z',
      },
    }
    const saved = {
      ...concurrent.host,
      name: 'Local draft',
      updated_at: '2026-08-25T00:00:02Z',
    }
    const api = gateway(source)
    vi.mocked(api.loadCatalog)
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(concurrent)
      .mockResolvedValueOnce({ ...concurrent, host: saved })
    vi.mocked(api.updateHostAsset)
      .mockRejectedValueOnce(new TermousApiError('conflict', 'HOST_ASSET_CONFLICT', 409))
      .mockResolvedValueOnce(saved)
    render(<ControllerHarness host={legacyHost('host-a')} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))

    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))

    await waitFor(() => expect(api.updateHostAsset).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.loadCatalog).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('asset-name')).toHaveTextContent('Local draft'))
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('hosts.access.conflict'))

    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))

    await waitFor(() => expect(api.updateHostAsset).toHaveBeenCalledTimes(2))
    expect(api.updateHostAsset).toHaveBeenLastCalledWith(
      'host-a',
      concurrent.host.updated_at,
      expect.objectContaining({ name: 'Local draft' }),
    )
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(''))
  })

  it('草稿发生变化后立即开放对应表单的校验反馈', async () => {
    const api = gateway(catalog('host-a'))
    render(<ControllerHarness host={legacyHost('host-a')} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))

    expect(screen.getByTestId('asset-validation-visible')).toHaveTextContent('false')
    fireEvent.click(screen.getByRole('button', { name: 'invalidate-asset' }))
    expect(screen.getByTestId('asset-validation-visible')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'open-access' }))
    fireEvent.click(screen.getByRole('button', { name: 'create-ssh' }))
    expect(screen.getByTestId('profile-validation-visible')).toHaveTextContent('false')
    fireEvent.click(screen.getByRole('button', { name: 'invalidate-ssh' }))
    expect(screen.getByTestId('profile-validation-visible')).toHaveTextContent('true')
  })

  it('同一渲染帧内重复提交只发起一次写请求', async () => {
    const source = catalog('host-a')
    const pending = deferred<typeof source.host>()
    const api = gateway(source)
    vi.mocked(api.updateHostAsset).mockReturnValue(pending.promise)
    render(<ControllerHarness host={legacyHost('host-a')} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))

    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset-twice' }))

    expect(api.updateHostAsset).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve({ ...source.host, name: 'Local draft' })
    })
  })

  it('写入成功但权威对账失败时保留 Catalog 并暴露刷新错误', async () => {
    const source = catalog('host-a')
    const api = gateway(source)
    vi.mocked(api.updateHostAsset).mockResolvedValue({
      ...source.host,
      name: 'Local draft',
      updated_at: '2026-08-25T00:00:01Z',
    })
    vi.mocked(api.loadCatalog)
      .mockResolvedValueOnce(source)
      .mockRejectedValueOnce(new Error('refresh failed'))
    render(<ControllerHarness host={legacyHost('host-a')} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))

    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))

    await waitFor(() => expect(screen.getByTestId('catalog-error')).toHaveTextContent('refresh failed'))
    expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a')
    expect(screen.getByTestId('asset-name')).toHaveTextContent('Local draft')
  })

  it('主机信息与连接页面切换保留资产草稿且不隐式保存', async () => {
    const api = gateway(catalog('host-a'))
    render(<ControllerHarness host={legacyHost('host-a')} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))

    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    await waitFor(() => expect(screen.getByTestId('asset-name')).toHaveTextContent('Local draft'))
    fireEvent.click(screen.getByRole('button', { name: 'open-access' }))
    expect(screen.getByTestId('view')).toHaveTextContent('access')
    expect(screen.getByTestId('pending')).toHaveTextContent('false')
    fireEvent.click(screen.getByRole('button', { name: 'open-asset' }))
    expect(screen.getByTestId('asset-name')).toHaveTextContent('Local draft')
    expect(screen.getByTestId('dirty')).toHaveTextContent('true')
    expect(api.updateHostAsset).not.toHaveBeenCalled()
  })

  it('外部访问视图意图保留主机草稿且同一 key 只消费一次', async () => {
    const api = gateway(catalog('host-a'))
    const view = render(
      <ControllerHarness host={legacyHost('host-a')} api={api} />,
    )
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))

    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    await waitFor(() => expect(screen.getByTestId('asset-name')).toHaveTextContent('Local draft'))
    view.rerender(
      <ControllerHarness
        host={legacyHost('host-a')}
        api={api}
        openAccessIntentKey={1}
      />,
    )

    expect(screen.getByTestId('view')).toHaveTextContent('access')
    expect(screen.getByTestId('asset-name')).toHaveTextContent('Local draft')
    fireEvent.click(screen.getByRole('button', { name: 'open-asset' }))

    view.rerender(
      <ControllerHarness
        host={legacyHost('host-a')}
        api={api}
        openAccessIntentKey={1}
      />,
    )
    expect(screen.getByTestId('view')).toHaveTextContent('asset')
    expect(screen.getByTestId('pending')).toHaveTextContent('false')
  })

  it('关闭脏连接草稿仍需确认，确认后保留未保存的主机信息', async () => {
    const api = gateway(catalog('host-a'))
    render(<ControllerHarness host={legacyHost('host-a')} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))
    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'create-ssh' }))
    fireEvent.click(screen.getByRole('button', { name: 'fill-ssh' }))
    fireEvent.click(screen.getByRole('button', { name: 'close-editor' }))
    expect(screen.getByTestId('pending')).toHaveTextContent('true')
    fireEvent.click(screen.getByRole('button', { name: 'confirm-navigation' }))
    expect(screen.getByTestId('editor')).toBeEmptyDOMElement()
    expect(screen.getByTestId('asset-name')).toHaveTextContent('Local draft')
    expect(screen.getByTestId('dirty')).toHaveTextContent('true')
  })

  it('创建 SSH 后重载权威 Catalog 并展示伴生 SFTP', async () => {
    const initial = catalog('host-a', { files: [] })
    const provisioned = catalog('host-a')
    const api = gateway(initial)
    vi.mocked(api.loadCatalog)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(provisioned)
    vi.mocked(api.createSSHProfile).mockResolvedValue({
      ssh: provisioned.ssh[0],
      file: provisioned.files[0],
    })
    render(<ControllerHarness host={legacyHost('host-a')} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))

    fireEvent.click(screen.getByRole('button', { name: 'open-access' }))
    fireEvent.click(screen.getByRole('button', { name: 'create-ssh' }))
    fireEvent.click(screen.getByRole('button', { name: 'fill-ssh' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-profile' }))

    await waitFor(() => expect(api.createSSHProfile).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('1'))
  })

  it('切换默认项后使用完整 Catalog 对账所有默认状态', async () => {
    const first = catalog('host-a')
    const secondary = {
      ...first.ssh[0],
      id: 'ssh-secondary',
      name: 'Secondary',
      is_default: false,
      sort_order: 1,
    }
    const initial = { ...first, ssh: [first.ssh[0], secondary] }
    const reloaded = {
      ...initial,
      ssh: [
        { ...first.ssh[0], is_default: false, updated_at: '2026-08-25T00:00:01Z' },
        { ...secondary, is_default: true, updated_at: '2026-08-25T00:00:01Z' },
      ],
    }
    const api = gateway(initial)
    vi.mocked(api.loadCatalog).mockResolvedValueOnce(initial).mockResolvedValueOnce(reloaded)
    vi.mocked(api.setDefaultSSHProfile).mockResolvedValue(reloaded.ssh[1])
    render(<ControllerHarness host={legacyHost('host-a')} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))

    fireEvent.click(screen.getByRole('button', { name: 'default-secondary' }))

    await waitFor(() => expect(api.setDefaultSSHProfile).toHaveBeenCalledWith(
      'ssh-secondary',
      secondary.updated_at,
    ))
    await waitFor(() => expect(screen.getByTestId('default-ssh')).toHaveTextContent('ssh-secondary'))
  })

  it('VNC 元数据成功而凭据失败时保留新基线和秘密草稿', async () => {
    const desktop = remoteDesktopProfile('host-a')
    const initial = catalog('host-a', { remote_desktops: [desktop] })
    const updated = {
      ...desktop,
      name: 'Updated desktop',
      updated_at: '2026-08-25T00:00:01Z',
    }
    const api = gateway(initial)
    vi.mocked(api.loadCatalog)
      .mockResolvedValueOnce(initial)
      .mockResolvedValue({ ...initial, remote_desktops: [updated] })
    vi.mocked(api.updateRemoteDesktopProfile).mockResolvedValue(updated)
    vi.mocked(api.saveRemoteDesktopTargetAuth).mockRejectedValue(new Error('vault unavailable'))
    render(<ControllerHarness host={legacyHost('host-a')} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))

    fireEvent.click(screen.getByRole('button', { name: 'edit-vnc' }))
    fireEvent.click(screen.getByRole('button', { name: 'fill-vnc-auth' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-profile' }))

    await waitFor(() => expect(api.saveRemoteDesktopTargetAuth).toHaveBeenCalledWith(
      desktop.id,
      updated.updated_at,
      'secret',
    ))
    expect(screen.getByTestId('vnc-name')).toHaveTextContent('Updated desktop')
    expect(screen.getByTestId('vnc-target-auth-mutation')).toHaveTextContent('replace')
    expect(screen.getByTestId('error')).toHaveTextContent(
      'remoteDesktop.targetAuth.profileSavedCredentialFailed',
    )
  })

  it('默认 SSH 异常时新建 VNC 不猜测第一条路由', async () => {
    const source = catalog('host-a')
    const ambiguous = {
      ...source,
      ssh: [
        { ...source.ssh[0], is_default: false },
        { ...source.ssh[0], id: 'ssh-secondary', name: 'Secondary', is_default: false },
      ],
    }
    const api = gateway(ambiguous)
    render(<ControllerHarness host={legacyHost('host-a')} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))

    fireEvent.click(screen.getByRole('button', { name: 'create-vnc' }))

    expect(screen.getByTestId('vnc-ssh-profile')).toBeEmptyDOMElement()
    fireEvent.click(screen.getByRole('button', { name: 'save-profile' }))
    expect(api.createRemoteDesktopProfile).not.toHaveBeenCalled()
  })
})

describe('空连接保存提示', () => {
  it('创建流程已选择无连接保存时，目录失败重试和后续改名保存均不重复提示', async () => {
    const source = catalog('host-a', { ssh: [], files: [] })
    const api = gateway(source)
    const pending = deferred<HostAccessCatalog>()
    vi.mocked(api.loadCatalog).mockRejectedValueOnce(new Error('catalog unavailable')).mockReturnValueOnce(pending.promise)
    vi.mocked(api.updateHostAsset).mockResolvedValue({ ...source.host, name: 'Local draft', updated_at: '2026-08-25T00:00:01Z' })
    const props = { host: source.host, api, initialConnectionSetupConsidered: true }
    const view = render(<ControllerHarness {...props} />)
    await waitFor(() => expect(screen.getByTestId('catalog-error')).toHaveTextContent('catalog unavailable'))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    fireEvent.click(screen.getByRole('button', { name: 'reload' }))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    await act(async () => pending.resolve(source))
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    expect(screen.getByTestId('editor')).toBeEmptyDOMElement()
    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))
    await waitFor(() => expect(api.loadCatalog).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByTestId('refreshing')).toHaveTextContent('false'))
    view.rerender(<ControllerHarness {...props} />)
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    expect(api.updateHostAsset).toHaveBeenCalledTimes(1)
  })

  it.each(['dismiss-setup', 'go-to-setup'])('正常编辑已有空连接主机仍在保存后提示，选择 %s 后不重复', async (choice) => {
    const source = catalog('host-a', { ssh: [], files: [] })
    const api = gateway(source)
    const firstSaved = { ...source.host, name: 'Local draft', updated_at: '2026-08-25T00:00:01Z' }
    const secondSaved = { ...source.host, name: 'Renamed again', updated_at: '2026-08-25T00:00:02Z' }
    vi.mocked(api.updateHostAsset).mockResolvedValueOnce(firstSaved).mockResolvedValueOnce(secondSaved)
    vi.mocked(api.loadCatalog).mockResolvedValueOnce(source)
      .mockResolvedValueOnce({ ...source, host: firstSaved }).mockResolvedValueOnce({ ...source, host: secondSaved })
    render(<ControllerHarness host={source.host} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))
    await waitFor(() => expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('true'))
    fireEvent.click(screen.getByRole('button', { name: choice }))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    expect(screen.getByTestId('view')).toHaveTextContent(choice === 'go-to-setup' ? 'access' : 'asset')
    fireEvent.click(screen.getByRole('button', { name: 'open-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'edit-asset-again' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))
    await waitFor(() => expect(api.loadCatalog).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByTestId('refreshing')).toHaveTextContent('false'))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    expect(api.updateHostAsset).toHaveBeenCalledTimes(2)
  })

  it.each(['initial-access', 'visited-access'])('已%s时空连接保存不再提示', async (path) => {
    const source = catalog('host-a', { ssh: [], files: [] })
    const api = gateway(source)
    const pending = deferred<HostAccessCatalog>()
    vi.mocked(api.loadCatalog).mockReturnValueOnce(pending.promise)
    vi.mocked(api.updateHostAsset).mockResolvedValue({ ...source.host, name: 'Local draft', updated_at: '2026-08-25T00:00:01Z' })
    render(<ControllerHarness host={source.host} api={api} initialView={path === 'initial-access' ? 'access' : 'asset'} />)
    if (path === 'visited-access') fireEvent.click(screen.getByRole('button', { name: 'open-access' }))
    fireEvent.click(screen.getByRole('button', { name: 'open-asset' }))
    await act(async () => pending.resolve(source))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))
    await waitFor(() => expect(api.loadCatalog).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('refreshing')).toHaveTextContent('false'))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
  })

  it('已打开连接编辑器后保存空连接主机不再提示', async () => {
    const source = catalog('host-a', { ssh: [], files: [] })
    const api = gateway(source)
    vi.mocked(api.updateHostAsset).mockResolvedValue({ ...source.host, name: 'Local draft', updated_at: '2026-08-25T00:00:01Z' })
    render(<ControllerHarness host={source.host} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))
    fireEvent.click(screen.getByRole('button', { name: 'create-ssh' }))
    fireEvent.click(screen.getByRole('button', { name: 'close-editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'open-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))
    await waitFor(() => expect(api.loadCatalog).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('refreshing')).toHaveTextContent('false'))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    expect(api.createSSHProfile).not.toHaveBeenCalled()
  })

  it.each(['ssh', 'files', 'remote_desktops'] as const)('存在%s配置时不把主机误判成无连接', async (kind) => {
    const complete = catalog('host-a', { remote_desktops: [remoteDesktopProfile('host-a')] })
    const source = catalog('host-a', { ssh: [], files: [], remote_desktops: [], [kind]: complete[kind] })
    const api = gateway(source)
    vi.mocked(api.updateHostAsset).mockResolvedValue({ ...source.host, name: 'Local draft', updated_at: '2026-08-25T00:00:01Z' })
    render(<ControllerHarness host={source.host} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))
    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))
    await waitFor(() => expect(api.loadCatalog).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('refreshing')).toHaveTextContent('false'))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
  })

  it('保存失败不消费提示资格，成功重试后才按最新目录提示', async () => {
    const source = catalog('host-a', { ssh: [], files: [] })
    const api = gateway(source)
    const saved = { ...source.host, name: 'Local draft', updated_at: '2026-08-25T00:00:01Z' }
    vi.mocked(api.updateHostAsset).mockRejectedValueOnce(new Error('write failed')).mockResolvedValueOnce(saved)
    vi.mocked(api.loadCatalog).mockResolvedValueOnce(source).mockResolvedValue({ ...source, host: saved })
    render(<ControllerHarness host={source.host} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('write failed'))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    expect(api.loadCatalog).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))
    await waitFor(() => expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('true'))
    expect(api.updateHostAsset).toHaveBeenCalledTimes(2)
    expect(api.loadCatalog).toHaveBeenCalledTimes(2)
  })

  it('保存后的目录重载失败不使用旧空目录提示，后续重试成功再提示', async () => {
    const source = catalog('host-a', { ssh: [], files: [] })
    const api = gateway(source)
    const saved = { ...source.host, name: 'Local draft', updated_at: '2026-08-25T00:00:01Z' }
    const pending = deferred<HostAccessCatalog>()
    vi.mocked(api.updateHostAsset).mockResolvedValue(saved)
    vi.mocked(api.loadCatalog).mockResolvedValueOnce(source).mockRejectedValueOnce(new Error('refresh failed')).mockReturnValueOnce(pending.promise)
    render(<ControllerHarness host={source.host} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))
    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))
    await waitFor(() => expect(screen.getByTestId('catalog-error')).toHaveTextContent('refresh failed'))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    expect(screen.getByTestId('asset-name')).toHaveTextContent('Local draft')
    fireEvent.click(screen.getByRole('button', { name: 'reload' }))
    expect(screen.getByTestId('refreshing')).toHaveTextContent('true')
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    await act(async () => pending.resolve({ ...source, host: saved }))
    await waitFor(() => expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('true'))
  })

  it('保存后等待目录完成，若其他操作已添加连接则不提示', async () => {
    const source = catalog('host-a', { ssh: [], files: [] })
    const api = gateway(source)
    const saved = { ...source.host, name: 'Local draft', updated_at: '2026-08-25T00:00:01Z' }
    const pending = deferred<HostAccessCatalog>()
    vi.mocked(api.updateHostAsset).mockResolvedValue(saved)
    vi.mocked(api.loadCatalog).mockResolvedValueOnce(source).mockReturnValueOnce(pending.promise)
    render(<ControllerHarness host={source.host} api={api} />)
    await waitFor(() => expect(screen.getByTestId('catalog-host')).toHaveTextContent('host-a'))
    fireEvent.click(screen.getByRole('button', { name: 'edit-asset' }))
    fireEvent.click(screen.getByRole('button', { name: 'save-asset' }))
    await waitFor(() => expect(screen.getByTestId('refreshing')).toHaveTextContent('true'))
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
    await act(async () => pending.resolve({ ...source, host: saved, remote_desktops: [remoteDesktopProfile('host-a')] }))
    expect(screen.getByTestId('refreshing')).toHaveTextContent('false')
    expect(screen.getByTestId('connection-setup-prompt')).toHaveTextContent('false')
  })
})

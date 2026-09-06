import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import type { ComponentProps } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CredentialView } from '#entities/credential'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { HostCreateEditor } from '../features/hosts/ui/HostCreateEditor'
import { HostEditorShell } from '../features/hosts/ui/HostEditorShell'
import { CredentialEditor } from '../features/vault/ui/CredentialEditor'

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

const passwordCredential: CredentialView = {
  id: 'credential-password',
  name: 'Password',
  type: 'password',
  vault_id: 'local',
  metadata: {},
  bound_host_count: 0,
}

function hostEditorProps(): ComponentProps<typeof HostCreateEditor> {
  return {
    data: {
      hosts: [], hostAssets: [], sshAccessProfiles: [], groups: [], proxies: [],
      credentials: [], hostIcons: [], sessions: [], fileSessions: [], forwards: [],
      remoteDesktopSessions: [],
    },
    busy: false,
    getHostIconUrl: (iconId) => iconId,
    onBack: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onDirtyChange: vi.fn(),
    onProtectedIconIdChange: vi.fn(),
    onCreateGroup: vi.fn(async (name: string) => ({ id: 'group-a', name, sort_order: 0 })),
    onManageIcons: vi.fn(),
    onManageProxies: vi.fn(),
  }
}

function credentialEditorProps(): ComponentProps<typeof CredentialEditor> {
  return {
    credentials: [passwordCredential],
    draft: {
      name: 'Production Password',
      type: 'password',
      vault_id: 'local',
      secret: 'secret',
      metadata: {},
    },
    dirty: false,
    requireSecret: false,
    errors: {},
    actionBusy: false,
    importBusy: false,
    importError: '',
    onChange: vi.fn(),
    onTypeChange: vi.fn(),
    onBack: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onDiscard: vi.fn(),
    onImportKey: vi.fn(),
  }
}

describe('管理编辑器模式视觉合同', () => {
  it('主机新建与编辑保持双页签，区分初始与未保存状态并在忙碌时保护输入', () => {
    const props = hostEditorProps()
    const view = render(<HostCreateEditor {...props} />)

    expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('hosts.newHost')
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'hosts.access.hostInfo' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText('hosts.unsaved')).not.toBeInTheDocument()
    expect(screen.queryByText('hosts.saved')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'hosts.access.hostInfo' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: 'Production Host' } })
    fireEvent.click(screen.getByRole('switch', { name: 'hosts.access.favorite' }))
    expect(screen.getByRole('switch', { name: 'hosts.access.favorite' })).toBeChecked()
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: 'app.save' })).toBeEnabled()
    expect(within(document.querySelector('[data-editor-mode="create"]') as HTMLElement)
      .getByRole('status')).toHaveTextContent('hosts.unsaved')

    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' }))
    expect(props.onCreate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'app.save' })).toBeEnabled()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.hostInfo' }))
    expect(screen.getByRole('textbox', { name: 'hosts.name' })).toHaveValue('Production Host')
    expect(screen.getByRole('switch', { name: 'hosts.access.favorite' })).toBeChecked()

    view.rerender(<HostCreateEditor {...props} busy />)
    expect(screen.getByRole('textbox', { name: 'hosts.name' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'hosts.backToList' })).toBeDisabled()
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveAttribute('aria-disabled', 'true')
  })

  it('编辑主机沿用同步状态和分段导航样式', () => {
    const props: ComponentProps<typeof HostEditorShell> = {
      mode: 'edit', title: 'Production Host', iconId: '', getHostIconUrl: () => '',
      activeSection: 'asset', dirty: false, busy: false, children: <p>资产表单</p>,
      onBack: vi.fn(), onSectionChange: vi.fn(),
    }
    const view = render(<HostEditorShell {...props} />)
    expect(within(document.querySelector('[data-editor-mode="edit"]') as HTMLElement)
      .getByRole('status')).toHaveTextContent('hosts.saved')
    expect(screen.getByRole('tab', { name: 'hosts.access.hostInfo' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' }))
    expect(props.onSectionChange).toHaveBeenCalledWith('connections')
    view.rerender(<HostEditorShell {...props} busy dirty />)
    expect(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('hosts.unsaved')
  })

  it('页签仅切换草稿，统一保存时校验主机名称并定位输入', () => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
    const props = hostEditorProps()
    render(<HostCreateEditor {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.note' }), { target: { value: '未命名的主机草稿' } })
    fireEvent.click(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' }))
    expect(props.onCreate).not.toHaveBeenCalled()
    expect(screen.queryByText('hosts.access.errors.required')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    expect(screen.getByText('hosts.access.errors.required')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'hosts.name' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'hosts.access.hostInfo' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'hosts.access.connectionConfig' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText('hosts.validation.addressRequired')).not.toBeInTheDocument()
  })

  it('空连接保存先提示，明确仅保存主机后才提交资产', async () => {
    const props = hostEditorProps()
    render(<ConfigProvider theme={{ token: { motion: false } }}><HostCreateEditor {...props} /></ConfigProvider>)
    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.name' }), { target: { value: '  Desktop host  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    expect(props.onCreate).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('hosts.creation.noConnectionsTitle')).toBeVisible())
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'hosts.creation.saveHostOnly' }))
    expect(props.onCreate).toHaveBeenCalledExactlyOnceWith({
      client_request_id: expect.any(String),
      host: { name: 'Desktop host', platform: 'linux', icon_id: '', group_id: '',
        tags: [], favorite: false, note: '' },
      ssh: [], remote_desktops: [],
    }, 'asset')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'hosts.access.ssh.add' })).not.toBeInTheDocument()
  })

  it('凭据编辑器区分新建、未保存和已同步编辑状态', () => {
    const props = credentialEditorProps()
    const view = render(<CredentialEditor {...props} />)

    expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('Production Password')
    expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('app.add')
    expect(screen.getByRole('button', { name: 'app.create' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'app.delete' })).not.toBeInTheDocument()
    expect(screen.queryByText('vault.unsaved')).not.toBeInTheDocument()
    expect(screen.queryByText('vault.saved')).not.toBeInTheDocument()

    view.rerender(<CredentialEditor {...props} dirty />)

    expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('Production Password')
    expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('app.add')
    expect(screen.getByRole('button', { name: 'app.create' })).toBeEnabled()
    expect(screen.getByText('vault.unsaved')).toBeVisible()
    expect(screen.queryByText('vault.saved')).not.toBeInTheDocument()

    view.rerender(<CredentialEditor {...props} editingCredential={passwordCredential} />)

    expect(document.querySelector('[data-editor-mode="edit"]')).toHaveTextContent('Production Password')
    expect(document.querySelector('[data-editor-mode="edit"]')).toHaveTextContent('app.edit')
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'app.delete' })).toBeEnabled()
    expect(screen.getByText('vault.saved')).toBeVisible()
    expect(screen.queryByText('vault.unsaved')).not.toBeInTheDocument()

    view.rerender(
      <CredentialEditor
        {...props}
        editingCredential={passwordCredential}
        draft={{ ...props.draft, name: '' }}
        dirty
      />,
    )

    expect(document.querySelector('[data-editor-mode="edit"]')).toHaveTextContent(passwordCredential.name)
    expect(document.querySelector('[data-editor-mode="edit"]')).not.toHaveTextContent('vault.newCredential')
  })
})

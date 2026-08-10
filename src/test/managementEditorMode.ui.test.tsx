import { render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CredentialView } from '#entities/credential'
import type { Host, HostInput } from '#entities/host'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { HostEditor } from '../features/hosts/ui/HostEditor'
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

const hostDraft: HostInput = {
  name: 'Production Host',
  platform: 'linux',
  icon_id: '',
  group_id: '',
  address: 'host.example.com',
  port: 22,
  username: 'root',
  auth_method: 'password',
  credential_id: passwordCredential.id,
  jump_host_id: '',
  proxy_id: '',
  tags: [],
  favorite: false,
  fingerprint_policy: 'confirm_on_change',
  note: '',
}

const existingHost: Host = {
  id: 'host-a',
  ...hostDraft,
}

function hostEditorProps(): ComponentProps<typeof HostEditor> {
  return {
    data: {
      hosts: [existingHost],
      groups: [],
      proxies: [],
      credentials: [passwordCredential],
    },
    draft: hostDraft,
    dirty: false,
    errors: {},
    actionBusy: false,
    uploadingIcon: false,
    getHostIconUrl: (iconId) => iconId,
    onChange: vi.fn(),
    onBack: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onDiscard: vi.fn(),
    onCreateGroup: vi.fn(async (name: string) => ({ id: 'group-a', name, sort_order: 0 })),
    onManageProxies: vi.fn(),
    onUploadIcon: vi.fn(async () => undefined),
    onRemoveIcon: vi.fn(),
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
  it('主机编辑器区分新建、未保存和已同步编辑状态', () => {
    const props = hostEditorProps()
    const view = render(<HostEditor {...props} />)

    expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('Production Host')
    expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('app.add')
    expect(screen.getByRole('button', { name: 'app.create' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'app.delete' })).not.toBeInTheDocument()
    expect(screen.queryByText('hosts.unsaved')).not.toBeInTheDocument()
    expect(screen.queryByText('hosts.saved')).not.toBeInTheDocument()

    view.rerender(<HostEditor {...props} dirty />)

    expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('Production Host')
    expect(document.querySelector('[data-editor-mode="create"]')).toHaveTextContent('app.add')
    expect(screen.getByRole('button', { name: 'app.create' })).toBeEnabled()
    expect(screen.getByText('hosts.unsaved')).toBeVisible()
    expect(screen.queryByText('hosts.saved')).not.toBeInTheDocument()

    view.rerender(<HostEditor {...props} editingHost={existingHost} />)

    expect(document.querySelector('[data-editor-mode="edit"]')).toHaveTextContent('Production Host')
    expect(document.querySelector('[data-editor-mode="edit"]')).toHaveTextContent('app.edit')
    expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'app.delete' })).toBeEnabled()
    expect(screen.getByText('hosts.saved')).toBeVisible()
    expect(screen.queryByText('hosts.unsaved')).not.toBeInTheDocument()

    view.rerender(
      <HostEditor
        {...props}
        editingHost={existingHost}
        draft={{ ...hostDraft, name: '', address: '' }}
        dirty
      />,
    )

    expect(document.querySelector('[data-editor-mode="edit"]')).toHaveTextContent(existingHost.name)
    expect(document.querySelector('[data-editor-mode="edit"]')).not.toHaveTextContent('hosts.newHost')
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

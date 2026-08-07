import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CredentialInput,
  CredentialView,
  SSHKeyGenerateRequest,
  SSHKeyPair,
} from '#entities/credential'

const gatewayMocks = {
  createGateway: vi.fn(),
  generateSSHKey: vi.fn(),
  inspectSSHKey: vi.fn(),
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../features/vault/ui/CredentialCatalog', () => ({
  CredentialCatalog: ({
    credentials,
    selectedCredentialId,
    onSelect,
    onCreate,
    onGenerateKey,
  }: {
    credentials: CredentialView[]
    selectedCredentialId: string | null
    onSelect: (credentialId: string) => void
    onCreate: () => void
    onGenerateKey: () => void
  }) => (
    <section data-testid="credential-catalog" data-selected-id={selectedCredentialId ?? ''}>
      {credentials.map((credential) => (
        <button key={credential.id} type="button" onClick={() => onSelect(credential.id)}>
          select-{credential.id}
        </button>
      ))}
      <button type="button" onClick={onCreate}>create-credential</button>
      <button type="button" onClick={onGenerateKey}>open-key-generation</button>
    </section>
  ),
}))

vi.mock('../features/vault/ui/CredentialEditor', () => ({
  CredentialEditor: ({
    editingCredential,
    draft,
    dirty,
    onChange,
    onBack,
    onSave,
    onDelete,
    onDiscard,
  }: {
    editingCredential?: CredentialView
    draft: CredentialInput
    dirty: boolean
    onChange: (patch: Partial<CredentialInput>) => void
    onBack: () => void
    onSave: () => void
    onDelete: () => void
    onDiscard: () => void
  }) => (
    <section data-testid="credential-editor">
      <output data-testid="editing-id">{editingCredential?.id ?? 'new'}</output>
      <output data-testid="draft-name">{draft.name}</output>
      <output data-testid="draft-metadata">{JSON.stringify(draft.metadata)}</output>
      <output data-testid="draft-dirty">{String(dirty)}</output>
      <input
        aria-label="credential-draft-name"
        value={draft.name}
        onChange={(event) => onChange({ name: event.target.value })}
      />
      <button type="button" onClick={onBack}>back-to-catalog</button>
      <button type="button" onClick={onSave}>save-credential</button>
      <button type="button" onClick={onDelete}>delete-credential</button>
      <button type="button" onClick={onDiscard}>discard-credential</button>
    </section>
  ),
}))

vi.mock('../features/vault/ui/PrivateKeyPassphraseModal', () => ({
  PrivateKeyPassphraseModal: () => null,
}))

vi.mock('../features/vault/ui/SSHKeyGenerationModal', () => ({
  SSHKeyGenerationModal: ({
    open,
    onGenerate,
  }: {
    open: boolean
    onGenerate: (input: SSHKeyGenerateRequest, signal: AbortSignal) => Promise<SSHKeyPair>
  }) => open ? (
    <button
      type="button"
      onClick={() => {
        void onGenerate({ algorithm: 'ed25519' }, new AbortController().signal)
          .catch(() => undefined)
      }}
    >
      run-key-generation
    </button>
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

import { VaultPage } from '#pages/vault'

const generatedKeyPair: SSHKeyPair = {
  private_key_openssh: 'PRIVATE KEY',
  public_key_authorized: 'ssh-ed25519 AAAA',
  encrypted: false,
  info: {
    public_key: 'ssh-ed25519 AAAA',
    fingerprint_sha256: 'SHA256:test',
    algorithm: 'ed25519',
  },
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function credential(
  id: string,
  name: string,
  boundHostCount = 0,
): CredentialView {
  return {
    id,
    name,
    type: 'password',
    vault_id: 'local',
    metadata: {},
    bound_host_count: boundHostCount,
  }
}

function renderVault(
  credentials: CredentialView[],
  overrides: Partial<ComponentProps<typeof VaultPage>> = {},
) {
  const pageProps: ComponentProps<typeof VaultPage> = {
    credentials,
    actionBusy: false,
    onSave: vi.fn(async () => undefined),
    onDelete: vi.fn(async () => true),
    onDirtyChange: vi.fn(),
    createGateway: gatewayMocks.createGateway,
    ...overrides,
  }
  return {
    ...render(<VaultPage {...pageProps} />),
    pageProps,
  }
}

describe('凭据库页面状态合同', () => {
  beforeEach(() => {
    gatewayMocks.createGateway.mockReset()
    gatewayMocks.generateSSHKey.mockReset()
    gatewayMocks.inspectSSHKey.mockReset()
    gatewayMocks.generateSSHKey.mockResolvedValue(generatedKeyPair)
    gatewayMocks.createGateway.mockResolvedValue({
      generateSSHKey: gatewayMocks.generateSSHKey,
      inspectSSHKey: gatewayMocks.inspectSSHKey,
    })
  })

  it('脏草稿会阻止选择意图，取消后保留草稿，确认后再加载目标凭据', async () => {
    const user = userEvent.setup()
    const onDirtyChange = vi.fn()
    renderVault([
      credential('credential-a', 'Alpha'),
      credential('credential-b', 'Beta'),
    ], { onDirtyChange })

    await user.click(screen.getByRole('button', { name: 'select-credential-a' }))
    fireEvent.change(screen.getByLabelText('credential-draft-name'), {
      target: { value: 'Local draft' },
    })

    expect(screen.getByTestId('draft-dirty')).toHaveTextContent('true')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)

    await user.click(screen.getByRole('button', { name: 'select-credential-b' }))
    expect(screen.getByRole('dialog', { name: 'confirm-dialog' })).toBeVisible()
    expect(screen.getByTestId('editing-id')).toHaveTextContent('credential-a')
    expect(screen.getByTestId('draft-name')).toHaveTextContent('Local draft')

    await user.click(screen.getByRole('button', { name: 'cancel-intent' }))
    expect(screen.queryByRole('dialog', { name: 'confirm-dialog' })).toBeNull()
    expect(screen.getByTestId('editing-id')).toHaveTextContent('credential-a')
    expect(screen.getByTestId('draft-name')).toHaveTextContent('Local draft')

    await user.click(screen.getByRole('button', { name: 'select-credential-b' }))
    await user.click(screen.getByRole('button', { name: 'confirm-intent' }))

    await waitFor(() => {
      expect(screen.getByTestId('editing-id')).toHaveTextContent('credential-b')
      expect(screen.getByTestId('draft-name')).toHaveTextContent('Beta')
      expect(screen.getByTestId('draft-dirty')).toHaveTextContent('false')
    })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('保存成功后使用服务端返回快照重建草稿和基线', async () => {
    const user = userEvent.setup()
    const saved = {
      ...credential('credential-a', 'Server canonical name'),
      metadata: { revision: 'server' },
    }
    const saveRequest = deferred<CredentialView>()
    const onSave = vi.fn(() => saveRequest.promise)
    const onDirtyChange = vi.fn()
    const view = renderVault([credential('credential-a', 'Alpha')], { onSave, onDirtyChange })

    await user.click(screen.getByRole('button', { name: 'select-credential-a' }))
    fireEvent.change(screen.getByLabelText('credential-draft-name'), {
      target: { value: '  Local edited name  ' },
    })
    await user.click(screen.getByRole('button', { name: 'save-credential' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'credential-a',
        expect.objectContaining({ name: 'Local edited name' }),
      )
    })
    view.rerender(
      <VaultPage
        {...view.pageProps}
        credentials={[saved]}
      />,
    )
    await act(async () => {
      saveRequest.resolve(saved)
      await saveRequest.promise
    })

    await waitFor(() => {
      expect(screen.getByTestId('draft-name')).toHaveTextContent('Server canonical name')
      expect(screen.getByTestId('draft-metadata')).toHaveTextContent('{"revision":"server"}')
      expect(screen.getByTestId('draft-dirty')).toHaveTextContent('false')
    })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('外部快照刷新不会覆盖脏草稿及其原始基线', async () => {
    const user = userEvent.setup()
    const original = credential('credential-a', 'Original snapshot')
    const view = renderVault([original])

    await user.click(screen.getByRole('button', { name: 'select-credential-a' }))
    fireEvent.change(screen.getByLabelText('credential-draft-name'), {
      target: { value: 'Local pending draft' },
    })

    view.rerender(
      <VaultPage
        {...view.pageProps}
        credentials={[credential('credential-a', 'Externally refreshed snapshot')]}
      />,
    )

    expect(screen.getByTestId('draft-name')).toHaveTextContent('Local pending draft')
    expect(screen.getByTestId('draft-dirty')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'discard-credential' }))
    await waitFor(() => {
      expect(screen.getByTestId('draft-name')).toHaveTextContent('Externally refreshed snapshot')
      expect(screen.getByTestId('draft-dirty')).toHaveTextContent('false')
    })
  })

  it.each([
    ['中间项', 'credential-b', 'credential-c'],
    ['末尾项', 'credential-c', 'credential-b'],
  ])('删除%s后选择相邻凭据', async (_label, selectedId, expectedId) => {
    const user = userEvent.setup()
    const onDelete = vi.fn(async () => true)
    renderVault([
      credential('credential-a', 'Alpha'),
      credential('credential-b', 'Beta'),
      credential('credential-c', 'Gamma'),
    ], { onDelete })

    await user.click(screen.getByRole('button', { name: `select-${selectedId}` }))
    await user.click(screen.getByRole('button', { name: 'delete-credential' }))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(selectedId)
      expect(screen.getByTestId('editing-id')).toHaveTextContent(expectedId)
    })
  })

  it('仅在首次 SSH Key 命令执行时创建并复用运行时 API', async () => {
    const user = userEvent.setup()
    const gatewayRequest = deferred<{
      generateSSHKey: typeof gatewayMocks.generateSSHKey
      inspectSSHKey: typeof gatewayMocks.inspectSSHKey
    }>()
    gatewayMocks.createGateway.mockReturnValue(gatewayRequest.promise)
    renderVault([])

    expect(gatewayMocks.createGateway).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'open-key-generation' }))
    expect(gatewayMocks.createGateway).not.toHaveBeenCalled()

    const generateButton = screen.getByRole('button', { name: 'run-key-generation' })
    await user.click(generateButton)
    await user.click(generateButton)

    expect(gatewayMocks.createGateway).toHaveBeenCalledTimes(1)
    expect(gatewayMocks.generateSSHKey).not.toHaveBeenCalled()
    await act(async () => {
      gatewayRequest.resolve({
        generateSSHKey: gatewayMocks.generateSSHKey,
        inspectSSHKey: gatewayMocks.inspectSSHKey,
      })
      await gatewayRequest.promise
    })

    await waitFor(() => {
      expect(gatewayMocks.generateSSHKey).toHaveBeenCalledTimes(2)
    })
    expect(gatewayMocks.generateSSHKey).toHaveBeenNthCalledWith(
      1,
      { algorithm: 'ed25519' },
      expect.any(AbortSignal),
    )
  })

  it('运行时 API 工厂变化后不再复用旧网关', async () => {
    const user = userEvent.setup()
    const firstGenerate = vi.fn(async () => generatedKeyPair)
    const secondGenerate = vi.fn(async () => generatedKeyPair)
    const firstFactory = vi.fn(async () => ({
      generateSSHKey: firstGenerate,
      inspectSSHKey: gatewayMocks.inspectSSHKey,
    }))
    const secondFactory = vi.fn(async () => ({
      generateSSHKey: secondGenerate,
      inspectSSHKey: gatewayMocks.inspectSSHKey,
    }))
    const view = renderVault([], { createGateway: firstFactory })

    await user.click(screen.getByRole('button', { name: 'open-key-generation' }))
    await user.click(screen.getByRole('button', { name: 'run-key-generation' }))
    await waitFor(() => expect(firstGenerate).toHaveBeenCalledTimes(1))

    view.rerender(
      <VaultPage
        {...view.pageProps}
        createGateway={secondFactory}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'run-key-generation' }))

    await waitFor(() => expect(secondGenerate).toHaveBeenCalledTimes(1))
    expect(firstFactory).toHaveBeenCalledTimes(1)
    expect(secondFactory).toHaveBeenCalledTimes(1)
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionProxy } from '#entities/connection-proxy'
import type { CredentialView } from '#entities/credential'
import type {
  SSHAccessProfile,
  SSHAccessProfileDraft,
} from '#entities/ssh-access-profile'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('#shared/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('#shared/ui')>(),
  CustomSelect: ({
    label,
    value,
    options,
    disabled,
    status,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
    onChange,
  }: {
    label: string
    value: string
    options: Array<{ value: string; label: string; description?: string }>
    disabled?: boolean
    status?: 'error' | 'warning'
    'aria-invalid'?: boolean
    'aria-describedby'?: string
    onChange: (value: string) => void
  }) => (
    <label>
      <span>{label}</span>
      <select
        aria-label={label}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        data-status={status}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  ),
}))

import { SSHProfileEditor } from './SSHProfileEditor.tsx'

const passwordCredential: CredentialView = {
  id: 'credential-password',
  name: 'Password credential',
  type: 'password',
  vault_id: 'local',
  metadata: {},
  bound_host_count: 0,
}

const privateKeyCredential: CredentialView = {
  id: 'credential-key',
  name: 'Private key credential',
  type: 'private_key',
  vault_id: 'local',
  metadata: {},
  bound_host_count: 0,
}

const passphraseCredential: CredentialView = {
  id: 'credential-passphrase',
  name: 'Key passphrase',
  type: 'private_key_passphrase',
  vault_id: 'local',
  metadata: {},
  bound_host_count: 0,
}

const proxy: ConnectionProxy = {
  id: 'proxy-a',
  name: 'Office proxy',
  type: 'socks5',
  url: 'socks5://127.0.0.1:1080',
  bound_host_count: 0,
}

const draft: SSHAccessProfileDraft = {
  name: 'Primary SSH',
  address: 'server.example.com',
  port: 22,
  username: 'root',
  auth_method: 'password',
  credential_id: passwordCredential.id,
  proxy_id: '',
  jump_ssh_profile_id: '',
  fingerprint: '',
  fingerprint_policy: 'confirm_on_change',
}

function profile(id: string, name: string): SSHAccessProfile {
  return {
    id,
    host_id: `host-${id}`,
    name,
    address: `${id}.example.com`,
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: passwordCredential.id,
    fingerprint_policy: 'confirm_on_change',
    is_default: true,
    sort_order: 0,
    created_at: '2026-08-27T00:00:00Z',
    updated_at: '2026-08-27T00:00:00Z',
  }
}

function editorProps(): ComponentProps<typeof SSHProfileEditor> {
  return {
    draft,
    errors: {},
    submitted: false,
    disabled: false,
    credentials: [passwordCredential, privateKeyCredential, passphraseCredential],
    proxies: [proxy],
    jumpProfiles: [profile('ssh-self', 'Current SSH'), profile('ssh-jump', 'Jump SSH')],
    onManageProxies: vi.fn(),
    onChange: vi.fn(),
  }
}

describe('SSHProfileEditor', () => {
  it('按独立 Profile 与主机初始连接两种上下文控制配置名称', () => {
    const props = editorProps()
    const view = render(<SSHProfileEditor {...props} />)

    expect(screen.getByRole('heading', { name: 'hosts.access.ssh.connection' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'hosts.access.ssh.authentication' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'hosts.access.ssh.route' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'hosts.access.profileName' })).toHaveValue('Primary SSH')
    expect(view.container.querySelector('[data-profile-name="visible"]')).toBeInTheDocument()

    view.rerender(
      <SSHProfileEditor
        {...props}
        showProfileName={false}
        autoFocus={false}
      />,
    )

    expect(screen.queryByRole('textbox', { name: 'hosts.access.profileName' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'hosts.address' })).toHaveValue('server.example.com')
    expect(view.container.querySelector('[data-profile-name="hidden"]')).toBeInTheDocument()
  })

  it('认证方式切换时清理不匹配凭据并只展示对应类型', () => {
    const props = editorProps()
    const view = render(<SSHProfileEditor {...props} />)
    const credentialSelect = screen.getByRole('combobox', { name: 'hosts.credential' })

    expect(credentialSelect).toContainElement(screen.getByRole('option', { name: passwordCredential.name }))
    expect(screen.queryByRole('option', { name: privateKeyCredential.name })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: passphraseCredential.name })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('hosts.auth.private_key'))
    expect(props.onChange).toHaveBeenCalledWith({
      ...draft,
      auth_method: 'private_key',
      credential_id: '',
    })

    vi.mocked(props.onChange).mockClear()
    const mismatchedDraft = {
      ...draft,
      credential_id: privateKeyCredential.id,
    }
    view.rerender(<SSHProfileEditor {...props} draft={mismatchedDraft} />)
    fireEvent.click(screen.getByText('hosts.auth.private_key'))

    expect(props.onChange).toHaveBeenCalledWith({
      ...mismatchedDraft,
      auth_method: 'private_key',
      credential_id: privateKeyCredential.id,
    })

    view.rerender(
      <SSHProfileEditor
        {...props}
        draft={{
          ...draft,
          auth_method: 'private_key',
          credential_id: privateKeyCredential.id,
        }}
      />,
    )
    expect(screen.getByRole('option', { name: privateKeyCredential.name })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: passwordCredential.name })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: passphraseCredential.name })).not.toBeInTheDocument()
  })

  it('精确投影字段变更、代理管理和跳板自身过滤', () => {
    const props = editorProps()
    render(<SSHProfileEditor {...props} editingProfileId="ssh-self" />)

    expect(screen.queryByRole('option', { name: 'Current SSH' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Jump SSH' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'hosts.address' }), {
      target: { value: 'new.example.com' },
    })
    expect(props.onChange).toHaveBeenLastCalledWith({
      ...draft,
      address: 'new.example.com',
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'hosts.proxy' }), {
      target: { value: proxy.id },
    })
    expect(props.onChange).toHaveBeenLastCalledWith({
      ...draft,
      proxy_id: proxy.id,
    })

    const manageProxies = screen.getByRole('button', { name: 'proxies.manage' })
    expect(manageProxies.className).toContain('inline-management-action')
    fireEvent.click(manageProxies)
    expect(props.onManageProxies).toHaveBeenCalledTimes(1)
  })

  it('延迟展示领域校验，同时始终展示外部引用错误并完整禁用控件', () => {
    const props = editorProps()
    const errors = {
      address: 'required' as const,
      port: 'range' as const,
      username: 'required' as const,
      credential_id: 'required' as const,
      jump_ssh_profile_id: 'self_reference' as const,
    }
    const view = render(
      <SSHProfileEditor
        {...props}
        errors={errors}
        errorMessages={{ proxy: 'proxy-reference-missing' }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('proxy-reference-missing')
    expect(screen.queryByText('hosts.access.errors.required')).not.toBeInTheDocument()
    expect(screen.queryByText('hosts.validation.portRange')).not.toBeInTheDocument()

    view.rerender(
      <SSHProfileEditor
        {...props}
        errors={errors}
        nameError="profile-name-error"
        submitted
        disabled
        errorMessages={{
          address: 'authoritative-address-error',
          proxy: 'proxy-reference-missing',
        }}
      />,
    )

    expect(screen.getByText('profile-name-error')).toHaveRole('alert')
    expect(screen.getByText('authoritative-address-error')).toHaveRole('alert')
    expect(screen.getByText('hosts.validation.portRange')).toHaveRole('alert')
    expect(screen.getByText('hosts.validation.credentialRequired')).toHaveRole('alert')
    expect(screen.getByText('hosts.access.errors.jumpSelf')).toHaveRole('alert')
    expect(screen.getAllByText('hosts.access.errors.required')).toHaveLength(1)

    expectControlError(
      screen.getByRole('textbox', { name: 'hosts.access.profileName' }),
      'profile-name-error',
    )
    expectControlError(
      screen.getByRole('textbox', { name: 'hosts.address' }),
      'authoritative-address-error',
    )
    expectControlError(screen.getByRole('spinbutton'), 'hosts.validation.portRange')
    expectControlError(
      screen.getByRole('textbox', { name: 'hosts.username' }),
      'hosts.access.errors.required',
    )
    expectControlError(
      screen.getByRole('combobox', { name: 'hosts.credential' }),
      'hosts.validation.credentialRequired',
    )
    expectControlError(
      screen.getByRole('combobox', { name: 'hosts.proxy' }),
      'proxy-reference-missing',
    )
    expectControlError(
      screen.getByRole('combobox', { name: 'hosts.jumpHost' }),
      'hosts.access.errors.jumpSelf',
    )

    for (const control of screen.getAllByRole('textbox')) expect(control).toBeDisabled()
    expect(screen.getByRole('spinbutton')).toBeDisabled()
    for (const control of screen.getAllByRole('combobox')) expect(control).toBeDisabled()
    expect(screen.getByLabelText('hosts.authMethod')).toHaveClass('ant-segmented-disabled')
    expect(screen.getByRole('button', { name: 'proxies.manage' })).toBeDisabled()
  })
})

function expectControlError(control: HTMLElement, message: string) {
  expect(control).toHaveAttribute('aria-invalid', 'true')
  const feedbackId = control.getAttribute('aria-describedby')
  expect(feedbackId).toBeTruthy()
  expect(document.getElementById(feedbackId!)).toHaveTextContent(message)
}

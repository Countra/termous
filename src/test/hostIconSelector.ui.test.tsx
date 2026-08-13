import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CredentialView } from '#entities/credential'
import type { HostIcon, HostInput } from '#entities/host'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { HostEditor } from '../features/hosts/ui/HostEditor'

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

function hostIcon(id: string, displayName: string, fileName: string, sortOrder: number): HostIcon {
  return {
    id,
    display_name: displayName,
    file_name: fileName,
    mime_type: 'image/png',
    size_bytes: 1024,
    sha256: `sha-${id}`,
    sort_order: sortOrder,
    created_at: `2026-08-11T00:00:0${sortOrder}Z`,
  }
}

function editorProps(overrides: Partial<ComponentProps<typeof HostEditor>> = {}): ComponentProps<typeof HostEditor> {
  return {
    data: {
      hosts: [],
      groups: [],
      proxies: [],
      credentials: [passwordCredential],
      hostIcons: [
        hostIcon('icon-production', 'Production Icon', 'server-custom.svg', 0),
        hostIcon('icon-development', 'Development Icon', 'development.png', 1),
      ],
    },
    draft: hostDraft,
    dirty: false,
    errors: {},
    actionBusy: false,
    getHostIconUrl: (iconId) => `http://localhost/api/v1/host-icons/${iconId}/file`,
    onChange: vi.fn(),
    onBack: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onDiscard: vi.fn(),
    onCreateGroup: vi.fn(async (name: string) => ({ id: 'group-a', name, sort_order: 0 })),
    onManageProxies: vi.fn(),
    onManageIcons: vi.fn(),
    ...overrides,
  }
}

describe('主机图标选择器行为合同', () => {
  it('按显示名和原始文件名搜索，并将选中图标写回草稿', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<HostEditor {...editorProps({ onChange })} />)

    const selector = screen.getByRole('combobox', { name: 'hosts.iconLibrary.select' })
    expect(screen.getByText('hosts.iconLibrary.default')).toBeVisible()

    fireEvent.mouseDown(selector)
    await user.type(selector, 'server-custom.svg')

    expect(await screen.findByText('Production Icon')).toBeInTheDocument()
    expect(screen.getByText('server-custom.svg')).toBeInTheDocument()
    expect(screen.queryByText('Development Icon')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Production Icon'))
    expect(onChange).toHaveBeenLastCalledWith({ icon_id: 'icon-production' })
  })

  it('预览当前选择、支持清空为默认图标，并可打开管理器', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onManageIcons = vi.fn()
    const props = editorProps({
      draft: { ...hostDraft, icon_id: 'icon-production' },
      dirty: true,
      onChange,
      onManageIcons,
    })
    const view = render(<HostEditor {...props} />)

    const preview = view.container.querySelector<HTMLImageElement>('.host-editor-heading .host-avatar img')
    expect(preview).toHaveAttribute('src', 'http://localhost/api/v1/host-icons/icon-production/file')

    const selector = screen.getByRole('combobox', { name: 'hosts.iconLibrary.select' })
    const selectRoot = selector.closest('.ant-select')
    const clearButton = selectRoot?.querySelector<HTMLElement>('.ant-select-clear')
    expect(clearButton).not.toBeNull()
    fireEvent.mouseDown(clearButton!)
    fireEvent.click(clearButton!)
    expect(onChange).toHaveBeenLastCalledWith({ icon_id: '' })

    await user.click(screen.getByRole('button', { name: 'hosts.iconLibrary.manage' }))
    expect(onManageIcons).toHaveBeenCalledTimes(1)
  })
})

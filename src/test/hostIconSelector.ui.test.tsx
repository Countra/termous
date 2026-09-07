import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { HostIcon } from '#entities/host'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { HostCreateEditor } from '../features/hosts/ui/HostCreateEditor'

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

function editorProps(overrides: Partial<ComponentProps<typeof HostCreateEditor>> = {}): ComponentProps<typeof HostCreateEditor> {
  return {
    data: {
      hosts: [],
      hostAssets: [],
      sshAccessProfiles: [],
      groups: [],
      proxies: [],
      credentials: [],
      sessions: [],
      fileSessions: [],
      forwards: [],
      remoteDesktopSessions: [],
      hostIcons: [
        hostIcon('icon-production', 'Production Icon', 'server-custom.svg', 0),
        hostIcon('icon-development', 'Development Icon', 'development.png', 1),
      ],
    },
    busy: false,
    getHostIconUrl: (iconId) => `http://localhost/api/v1/host-icons/${iconId}/file`,
    onCreate: vi.fn().mockResolvedValue(undefined),
    onDirtyChange: vi.fn(),
    onProtectedIconIdChange: vi.fn(),
    onBack: vi.fn(),
    onCreateGroup: vi.fn(async (name: string) => ({ id: 'group-a', name, sort_order: 0 })),
    onManageIcons: vi.fn(),
    onManageProxies: vi.fn(),
    ...overrides,
  }
}

describe('主机图标选择器行为合同', () => {
  it('按显示名和原始文件名搜索，并将选中图标写回草稿', async () => {
    const user = userEvent.setup()
    const onProtectedIconIdChange = vi.fn()
    render(<HostCreateEditor {...editorProps({ onProtectedIconIdChange })} />)

    const selector = screen.getByRole('combobox', { name: 'hosts.iconLibrary.select' })
    expect(screen.getByText('hosts.iconLibrary.default')).toBeVisible()

    fireEvent.mouseDown(selector)
    await user.type(selector, 'server-custom.svg')

    expect(await screen.findByText('Production Icon')).toBeInTheDocument()
    expect(screen.getByText('server-custom.svg')).toBeInTheDocument()
    expect(screen.queryByText('Development Icon')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Production Icon'))
    expect(onProtectedIconIdChange).toHaveBeenLastCalledWith('icon-production')
  })

  it('预览当前选择、支持清空为默认图标，并可打开管理器', async () => {
    const user = userEvent.setup()
    const onProtectedIconIdChange = vi.fn()
    const onManageIcons = vi.fn()
    const props = editorProps({
      onProtectedIconIdChange,
      onManageIcons,
    })
    const view = render(<HostCreateEditor {...props} />)

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'hosts.iconLibrary.select' }))
    fireEvent.click(await screen.findByText('Production Icon'))

    const preview = view.container.querySelector<HTMLImageElement>('.host-editor-heading .host-avatar img')
    expect(preview).toHaveAttribute('src', 'http://localhost/api/v1/host-icons/icon-production/file')

    const selector = screen.getByRole('combobox', { name: 'hosts.iconLibrary.select' })
    const selectRoot = selector.closest('.ant-select')
    const clearButton = selectRoot?.querySelector<HTMLElement>('.ant-select-clear')
    expect(clearButton).not.toBeNull()
    fireEvent.mouseDown(clearButton!)
    fireEvent.click(clearButton!)
    expect(onProtectedIconIdChange).toHaveBeenLastCalledWith('')

    const manageIcons = screen.getByRole('button', { name: 'hosts.iconLibrary.manage' })
    expect(manageIcons.className).toContain('inline-management-action')
    await user.click(manageIcons)
    expect(onManageIcons).toHaveBeenCalledTimes(1)
  })
})

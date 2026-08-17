import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FileSession } from '#entities/file'
import type { Host } from '#entities/host'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('#shared/ui', () => ({
  SessionTabButton: ({
    icon,
    sourceIndicator,
    label,
    role,
    tooltipTitle,
    onClick,
    onAuxClick,
    onClose,
    'aria-label': ariaLabel,
    'data-session-origin': sessionOrigin,
  }: {
    icon: ReactNode
    sourceIndicator?: ReactNode
    label: ReactNode
    role?: string
    tooltipTitle?: ReactNode
    onClick?: () => void
    onAuxClick?: (event: React.MouseEvent<HTMLElement>) => void
    onClose?: () => void
    'aria-label'?: string
    'data-session-origin'?: string
  }) => (
    <div>
      <button
        type="button"
        role={role}
        aria-label={ariaLabel}
        data-session-origin={sessionOrigin}
        data-tooltip-title={typeof tooltipTitle === 'string' ? tooltipTitle : undefined}
        onClick={onClick}
        onAuxClick={onAuxClick}
      >
        {sourceIndicator ? <span data-session-source-indicator="">{sourceIndicator}</span> : null}
        {icon}
        {label}
      </button>
      <button type="button" aria-label="close-test-tab" onClick={onClose} />
    </div>
  ),
}))

import { FileSessionTab } from './FileSessionTab'

const appFileSession: FileSession = {
  id: 'files-app',
  host_id: 'host-app',
  origin: 'app',
  status: 'connected',
  current_path: '/',
  started_at: '2026-08-14T00:00:00Z',
}

const mcpFileSession: FileSession = {
  ...appFileSession,
  id: 'files-mcp',
  host_id: 'host-mcp',
  origin: 'mcp',
  status: 'failed',
}

describe('MCP SFTP 会话标签来源标识', () => {
  it('保留主机自定义图标，并在独立位置显示 Bot 来源标识', () => {
    renderFileSessionTab(mcpFileSession, 'MCP server', { host: customIconHost })

    const tab = screen.getByRole('tab', {
      name: 'MCP server · sessionOrigin.mcp · files.sessionStatus.failed',
    })
    expect(tab).toHaveAttribute('data-session-origin', 'mcp')
    expect(tab).toHaveAttribute(
      'data-tooltip-title',
      'MCP server · sessionOrigin.mcp · files.sessionStatus.failed',
    )
    expect(tab.querySelector('img')).toHaveAttribute('src', '/icons/host-icon-mcp')
    expect(tab.querySelector('[data-session-source-indicator] .lucide-bot')).not.toBeNull()
    expect(tab.querySelector('.lucide-folder')).toBeNull()
  })

  it('普通会话保持 Folder 图标与原有操作行为', () => {
    const onSelect = vi.fn()
    const onAuxClose = vi.fn()
    const onClose = vi.fn()
    renderFileSessionTab(appFileSession, 'App server', { onSelect, onAuxClose, onClose })

    const tab = screen.getByRole('tab', { name: 'App server' })
    expect(tab).not.toHaveAttribute('data-session-origin')
    expect(tab.querySelector('.lucide-folder')).not.toBeNull()
    expect(tab.querySelector('.lucide-bot')).toBeNull()

    fireEvent.click(tab)
    fireEvent(tab, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    fireEvent.click(screen.getByRole('button', { name: 'close-test-tab' }))

    expect(onSelect).toHaveBeenCalledWith('files-app')
    expect(onAuxClose).toHaveBeenCalledWith(expect.anything(), 'files-app')
    expect(onClose).toHaveBeenCalledWith('files-app')
  })

  it('普通会话同样优先使用主机自定义图标，加载失败后回退 Folder', () => {
    renderFileSessionTab(appFileSession, 'App server', { host: customIconHost })

    const tab = screen.getByRole('tab', { name: 'App server' })
    const image = tab.querySelector('img')
    expect(image).toHaveAttribute('src', '/icons/host-icon-mcp')
    expect(tab.querySelector('.lucide-bot')).toBeNull()

    fireEvent.error(image!)
    expect(tab.querySelector('.lucide-folder')).not.toBeNull()
  })
})

const customIconHost: Pick<Host, 'icon_id' | 'name'> = {
  name: 'Custom host',
  icon_id: 'host-icon-mcp',
}

function renderFileSessionTab(
  fileSession: FileSession,
  label: string,
  overrides: Partial<{
    host: Pick<Host, 'icon_id' | 'name'>
    onSelect: (fileSessionId: string) => void
    onAuxClose: (event: React.MouseEvent<HTMLElement>, fileSessionId: string) => void
    onClose: (fileSessionId: string) => void
  }> = {},
) {
  return render(
    <FileSessionTab
      fileSession={fileSession}
      host={overrides.host}
      getHostIconUrl={(iconId) => `/icons/${iconId}`}
      label={label}
      active
      closing={false}
      onSelect={overrides.onSelect ?? vi.fn()}
      onAuxClose={overrides.onAuxClose ?? vi.fn()}
      onClose={overrides.onClose ?? vi.fn()}
    />,
  )
}

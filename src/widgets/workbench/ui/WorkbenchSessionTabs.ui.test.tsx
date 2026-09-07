import { fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Host } from '#entities/host'
import type { Session } from '#entities/session'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('antd', () => ({
  Dropdown: ({
    children,
    disabled,
    menu,
  }: {
    children?: ReactNode
    disabled?: boolean
    menu: {
      items: Array<{ key: string; disabled?: boolean; label: ReactNode }>
      onClick: (event: { key: string; domEvent: { stopPropagation: () => void } }) => void
    }
  }) => {
    const [open, setOpen] = useState(false)
    return (
      <div
        onContextMenu={(event) => {
          event.preventDefault()
          if (!disabled) setOpen(true)
        }}
      >
        {children}
        {open ? menu.items.map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            onClick={(event) => menu.onClick({ key: item.key, domEvent: event })}
          >
            {item.label}
          </button>
        )) : null}
      </div>
    )
  },
  Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock('#features/hosts', () => ({ SessionQuickConnect: () => null }))

vi.mock('#shared/ui', () => ({
  SessionTabStrip: ({ children }: { children?: ReactNode }) => <div role="tablist">{children}</div>,
  SessionTabButton: ({
    icon,
    sourceIndicator,
    label,
    role,
    tooltipTitle,
    'aria-label': ariaLabel,
    'data-session-origin': sessionOrigin,
  }: {
    icon: ReactNode
    sourceIndicator?: ReactNode
    label: ReactNode
    role?: string
    tooltipTitle?: ReactNode
    'aria-label'?: string
    'data-session-origin'?: string
  }) => (
    <button
      type="button"
      role={role}
      aria-label={ariaLabel}
      data-session-origin={sessionOrigin}
      data-tooltip-title={typeof tooltipTitle === 'string' ? tooltipTitle : undefined}
    >
      {sourceIndicator ? <span data-session-source-indicator="">{sourceIndicator}</span> : null}
      {icon}
      {label}
    </button>
  ),
}))

vi.mock('./SessionTabColorPanel', () => ({ SessionTabColorPanel: () => null }))

import { WorkbenchSessionTabs, type SessionTabMenuAction } from './WorkbenchSessionTabs'

const sshSession: Session = {
  id: 'session-ssh',
  kind: 'ssh',
  origin: 'app',
  host_id: 'host-a',
  status: 'connected',
  started_at: '2026-08-14T00:00:00Z',
  pty_cols: 120,
  pty_rows: 32,
}

const localSession: Session = {
  id: 'session-local',
  kind: 'local',
  origin: 'app',
  status: 'connected',
  started_at: '2026-08-14T00:00:00Z',
  pty_cols: 120,
  pty_rows: 32,
}

const mcpSession: Session = {
  ...sshSession,
  id: 'session-mcp',
  origin: 'mcp',
}

const customIconHost: Host = {
  id: 'host-a',
  name: 'Custom host',
  platform: 'linux',
  icon_id: 'host-icon-a',
  group_id: '',
  address: '127.0.0.1',
  port: 22,
  username: 'tester',
  auth_method: 'password',
  credential_id: 'credential-a',
  tags: [],
  favorite: false,
  fingerprint_policy: 'strict',
}

describe('MCP SSH 会话标签来源标识', () => {
  it('保留主机自定义图标，并在独立位置显示 Bot 来源标识', () => {
    renderTabs([mcpSession, sshSession], { hosts: [customIconHost] })

    const mcpTab = screen.getByRole('tab', {
      name: 'session-mcp · sessionOrigin.mcp · status.connected',
    })
    expect(mcpTab).toHaveAttribute('data-session-origin', 'mcp')
    expect(mcpTab).toHaveAttribute(
      'data-tooltip-title',
      'session-mcp · sessionOrigin.mcp · status.connected',
    )
    expect(mcpTab.querySelector('img')).toHaveAttribute('src', '/icons/host-icon-a')
    expect(mcpTab.querySelector('[data-session-source-indicator] .lucide-bot')).not.toBeNull()

    const appTab = screen.getByRole('tab', { name: 'session-ssh' })
    expect(appTab).not.toHaveAttribute('data-session-origin')
    expect(appTab.querySelector('img')).toHaveAttribute('src', '/icons/host-icon-a')
    expect(appTab.querySelector('.lucide-bot')).toBeNull()
  })

  it('主机图标缺失或加载失败时回退终端图标，且不影响来源标识', () => {
    renderTabs([mcpSession, localSession], { hosts: [customIconHost] })

    const tab = screen.getByRole('tab', {
      name: 'session-mcp · sessionOrigin.mcp · status.connected',
    })
    const image = tab.querySelector('img')
    expect(image).not.toBeNull()
    fireEvent.error(image!)

    expect(tab.querySelector('.lucide-square-terminal')).not.toBeNull()
    expect(tab.querySelector('[data-session-source-indicator] .lucide-bot')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'session-local' }).querySelector('.lucide-square-terminal')).not.toBeNull()
  })
})

describe('SSH 会话标签右键菜单', () => {
  it('重启被右键的 SSH 会话', () => {
    const onMenuAction = vi.fn<(action: SessionTabMenuAction, session: Session) => void>()
    renderTabs([sshSession], { onMenuAction })

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'session-ssh' }))
    fireEvent.click(screen.getByRole('button', { name: 'terminal.tabMenu.restart' }))

    expect(onMenuAction).toHaveBeenCalledWith('restart', sshSession)
  })

  it('本地终端或全局操作进行中时禁用重启', () => {
    const { rerender } = renderTabs([localSession])

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'session-local' }))
    expect(screen.getByRole('button', { name: 'terminal.tabMenu.restart' })).toBeDisabled()

    rerender(createTabs([sshSession], { actionBusy: true }))
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'session-ssh' }))
    expect(screen.getByRole('button', { name: 'terminal.tabMenu.restart' })).toBeDisabled()
  })
})

function renderTabs(
  sessions: Session[],
  overrides: TabsOverrides = {},
) {
  return render(createTabs(sessions, overrides))
}

function createTabs(
  sessions: Session[],
  overrides: TabsOverrides = {},
) {
  return (
    <WorkbenchSessionTabs
      sessions={sessions}
      hosts={overrides.hosts ?? []}
      activeSessionId={sessions[0]?.id}
      actionBusy={overrides.actionBusy ?? false}
      preferences={{}}
      closingSessionIds={new Set()}
      colorSessionId={null}
      draggingSessionId={null}
      quickConnectOpen={false}
      quickConnectQuery=""
      suppressNextClickRef={{ current: false }}
      getHostIconUrl={(iconId) => `/icons/${iconId}`}
      resolveTitle={(session) => session.id}
      onQuickConnectOpenChange={vi.fn()}
      onQuickConnectQueryChange={vi.fn()}
      onQuickConnect={vi.fn(async () => undefined)}
      onMenuAction={overrides.onMenuAction ?? vi.fn<(action: SessionTabMenuAction, session: Session) => void>()}
      onColorPopoverOpenChange={vi.fn()}
      onColorSelect={vi.fn()}
      onColorReset={vi.fn()}
      onSelectSession={vi.fn()}
      onBeginDrag={vi.fn()}
      onAuxClose={vi.fn()}
      onClose={vi.fn(async () => true)}
    />
  )
}

interface TabsOverrides {
  actionBusy?: boolean
  hosts?: Host[]
  onMenuAction?: (action: SessionTabMenuAction, session: Session) => void
}

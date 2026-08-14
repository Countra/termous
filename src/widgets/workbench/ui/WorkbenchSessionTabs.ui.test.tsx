import { fireEvent, render, screen } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
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
    label,
    role,
  }: {
    label: ReactNode
    role?: string
  }) => <button type="button" role={role}>{label}</button>,
}))

vi.mock('./SessionTabColorPanel', () => ({ SessionTabColorPanel: () => null }))

import { WorkbenchSessionTabs, type SessionTabMenuAction } from './WorkbenchSessionTabs'

const sshSession: Session = {
  id: 'session-ssh',
  kind: 'ssh',
  host_id: 'host-a',
  status: 'connected',
  started_at: '2026-08-14T00:00:00Z',
  pty_cols: 120,
  pty_rows: 32,
}

const localSession: Session = {
  id: 'session-local',
  kind: 'local',
  status: 'connected',
  started_at: '2026-08-14T00:00:00Z',
  pty_cols: 120,
  pty_rows: 32,
}

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
      hosts={[]}
      activeSessionId={sessions[0]?.id}
      actionBusy={overrides.actionBusy ?? false}
      preferences={{}}
      closingSessionIds={new Set()}
      colorSessionId={null}
      draggingSessionId={null}
      quickConnectOpen={false}
      quickConnectQuery=""
      suppressNextClickRef={{ current: false }}
      getHostIconUrl={(iconId) => iconId}
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
  onMenuAction?: (action: SessionTabMenuAction, session: Session) => void
}

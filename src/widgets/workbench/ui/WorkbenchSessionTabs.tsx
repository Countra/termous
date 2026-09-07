import { Dropdown, Popover } from 'antd'
import {
  Bot,
  CopyPlus,
  Layers,
  Palette,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  RotateCcw,
  Search,
  SquareTerminal,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  useMemo,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { SessionQuickConnect } from '#features/hosts'
import { SessionTabButton, SessionTabStrip } from '#shared/ui'
import { HostAvatar, type Host } from '#entities/host'
import type { Session } from '#entities/session'
import type { SessionTabPreferenceMap } from '../model/sessionTabPreferences'
import { SessionTabColorPanel } from './SessionTabColorPanel'
import styles from './WorkbenchSessionTabs.module.scss'

export type SessionTabMenuAction =
  | 'search'
  | 'duplicate'
  | 'restart'
  | 'split'
  | 'rename'
  | 'pin'
  | 'color'
  | 'reset'

interface WorkbenchSessionTabsProps {
  sessions: Session[]
  hosts: Host[]
  activeSessionId?: string
  actionBusy: boolean
  preferences: SessionTabPreferenceMap
  closingSessionIds: ReadonlySet<string>
  colorSessionId: string | null
  draggingSessionId: string | null
  quickConnectOpen: boolean
  quickConnectQuery: string
  suppressNextClickRef: RefObject<boolean>
  getHostIconUrl: (iconId: string) => string
  resolveTitle: (session: Session) => string
  onQuickConnectOpenChange: (open: boolean) => void
  onQuickConnectQueryChange: (query: string) => void
  onQuickConnect: (hostId: string) => Promise<void>
  onMenuAction: (action: SessionTabMenuAction, session: Session) => void
  onColorPopoverOpenChange: (sessionId: string, open: boolean) => void
  onColorSelect: (sessionId: string, color: string, options?: { keepOpen?: boolean }) => void
  onColorReset: (sessionId: string) => void
  onSelectSession: (sessionId: string) => void
  onBeginDrag: (event: ReactPointerEvent<HTMLElement>, sessionId: string) => void
  onAuxClose: (event: MouseEvent<HTMLElement>, sessionId: string) => void
  onClose: (sessionId: string) => Promise<boolean>
}

export function WorkbenchSessionTabs({
  sessions,
  hosts,
  activeSessionId,
  actionBusy,
  preferences,
  closingSessionIds,
  colorSessionId,
  draggingSessionId,
  quickConnectOpen,
  quickConnectQuery,
  suppressNextClickRef,
  getHostIconUrl,
  resolveTitle,
  onQuickConnectOpenChange,
  onQuickConnectQueryChange,
  onQuickConnect,
  onMenuAction,
  onColorPopoverOpenChange,
  onColorSelect,
  onColorReset,
  onSelectSession,
  onBeginDrag,
  onAuxClose,
  onClose,
}: WorkbenchSessionTabsProps) {
  const { t } = useTranslation()
  const hostById = useMemo(
    () => new Map(hosts.map((host) => [host.id, host])),
    [hosts],
  )
  return (
    <SessionTabStrip
      ariaLabel={t('workbench.terminal')}
      activeId={activeSessionId}
      contentKey={sessions.map((session) => session.id).join('|')}
      scrollLeftLabel={t('workbench.scrollTabsLeft')}
      scrollRightLabel={t('workbench.scrollTabsRight')}
      tabsClassName={`${styles['terminal-tabs']} terminal-tabs`}
      trailing={(
        <SessionQuickConnect
          hosts={hosts}
          actionBusy={actionBusy}
          triggerLabel={t('workbench.quickConnect.trigger')}
          open={quickConnectOpen}
          query={quickConnectQuery}
          onOpenChange={onQuickConnectOpenChange}
          onQueryChange={onQuickConnectQueryChange}
          onConnect={onQuickConnect}
          getHostIconUrl={getHostIconUrl}
        />
      )}
    >
      {sessions.length === 0 ? (
        <SessionTabButton empty icon={<SquareTerminal size={18} />} label={t('workbench.noSession')} />
      ) : (
        sessions.map((session) => {
          const preference = preferences[session.id]
          const title = resolveTitle(session)
          const sessionClosing = closingSessionIds.has(session.id)
          const statusLabel = t(`status.${session.status}`)
          const closingLabel = t('workbench.closingSession')
          const isMcpSession = session.origin === 'mcp'
          const originLabel = t('sessionOrigin.mcp')
          const host = session.host_id ? hostById.get(session.host_id) : undefined
          const defaultIcon = <SquareTerminal size={18} />
          const sessionIcon = host?.icon_id?.trim() ? (
            <HostAvatar
              host={host}
              getIconUrl={getHostIconUrl}
              size={18}
              compact
              fallbackIcon={defaultIcon}
            />
          ) : defaultIcon
          const accessibleLabel = isMcpSession
            ? `${title} · ${originLabel} · ${sessionClosing ? closingLabel : statusLabel}`
            : undefined
          const tooltipTitle = isMcpSession
            ? (sessionClosing ? `${title} · ${originLabel}` : accessibleLabel)
            : undefined
          return (
            <Dropdown
              key={session.id}
              disabled={sessionClosing}
              trigger={['contextMenu']}
              classNames={{ root: styles['terminal-tab-dropdown'] }}
              menu={{
                items: buildSessionTabMenuItems(session, preference, actionBusy, t),
                onClick: ({ key, domEvent }) => {
                  domEvent.stopPropagation()
                  onMenuAction(key as SessionTabMenuAction, session)
                },
              }}
            >
              <span className={styles['session-tab-trigger']}>
                <Popover
                  open={colorSessionId === session.id}
                  placement="bottomLeft"
                  arrow={false}
                  trigger="click"
                  classNames={{ root: styles['session-tab-color-popover'] }}
                  onOpenChange={(open) => onColorPopoverOpenChange(session.id, open)}
                  content={(
                    <SessionTabColorPanel
                      color={preference?.color}
                      onSelect={(color, options) => onColorSelect(session.id, color, options)}
                      onReset={() => onColorReset(session.id)}
                    />
                  )}
                >
                  <SessionTabButton
                    active={session.id === activeSessionId}
                    role="tab"
                    aria-selected={session.id === activeSessionId}
                    aria-label={accessibleLabel}
                    data-session-tab-id={session.id}
                    data-session-origin={isMcpSession ? 'mcp' : undefined}
                    dragging={draggingSessionId === session.id}
                    onClick={(event) => {
                      if (sessionClosing || suppressNextClickRef.current) {
                        event.preventDefault()
                        event.stopPropagation()
                        return
                      }
                      onSelectSession(session.id)
                    }}
                    onMouseDown={(event) => {
                      if (event.button === 1) {
                        event.preventDefault()
                      }
                    }}
                    onPointerDown={(event) => {
                      if (!sessionClosing) {
                        onBeginDrag(event, session.id)
                      }
                    }}
                    onAuxClick={(event) => onAuxClose(event, session.id)}
                    icon={sessionIcon}
                    sourceIndicator={isMcpSession ? <Bot size={12} strokeWidth={2} /> : undefined}
                    label={title}
                    status={session.status}
                    statusLabel={statusLabel}
                    closing={sessionClosing}
                    closingLabel={closingLabel}
                    tooltipTitle={tooltipTitle}
                    pinned={preference?.pinned}
                    pinLabel={t('terminal.tabMenu.pinned')}
                    accentColor={preference?.color}
                    closeLabel={`${t('app.close')} ${title}`}
                    closeDisabled={actionBusy && !sessionClosing}
                    onClose={() => void onClose(session.id)}
                  />
                </Popover>
              </span>
            </Dropdown>
          )
        })
      )}
    </SessionTabStrip>
  )
}

function buildSessionTabMenuItems(
  session: Session,
  preference: SessionTabPreferenceMap[string] | undefined,
  actionBusy: boolean,
  t: (key: string) => string,
) {
  const pinned = Boolean(preference?.pinned)
  const canManageSshSession = session.kind === 'ssh' && Boolean(session.host_id)
  return [
    {
      key: 'search',
      label: <TerminalTabMenuItem icon={<Search size={15} />} title={t('terminal.search')} />,
    },
    {
      key: 'duplicate',
      disabled: !canManageSshSession || actionBusy,
      label: <TerminalTabMenuItem icon={<CopyPlus size={15} />} title={t('terminal.tabMenu.duplicate')} />,
    },
    {
      key: 'restart',
      disabled: !canManageSshSession || actionBusy,
      label: <TerminalTabMenuItem icon={<RefreshCw size={15} />} title={t('terminal.tabMenu.restart')} />,
    },
    {
      key: 'split',
      label: <TerminalTabMenuItem icon={<Layers size={15} />} title={t('terminal.tabMenu.split')} />,
    },
    {
      key: 'rename',
      label: <TerminalTabMenuItem icon={<Pencil size={15} />} title={t('terminal.tabMenu.rename')} />,
    },
    {
      key: 'pin',
      label: (
        <TerminalTabMenuItem
          icon={pinned ? <PinOff size={15} /> : <Pin size={15} />}
          title={pinned ? t('terminal.tabMenu.unpin') : t('terminal.tabMenu.pin')}
        />
      ),
    },
    {
      key: 'color',
      label: <TerminalTabMenuItem icon={<Palette size={15} />} title={t('terminal.tabMenu.color')} />,
    },
    {
      key: 'reset',
      disabled: !preference,
      label: <TerminalTabMenuItem icon={<RotateCcw size={15} />} title={t('terminal.tabMenu.reset')} />,
    },
  ]
}

function TerminalTabMenuItem({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <span className={styles['terminal-tab-menu-item']}>
      <span className={styles['terminal-tab-menu-icon']}>{icon}</span>
      <span className={styles['terminal-tab-menu-label']}>{title}</span>
    </span>
  )
}

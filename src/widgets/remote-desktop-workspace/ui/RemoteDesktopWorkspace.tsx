import {
  App as AntdApp,
  Button,
  Dropdown,
  Segmented,
  Switch,
  Tooltip,
  type MenuProps,
} from 'antd'
import {
  ClipboardCopy,
  ClipboardPaste,
  Expand,
  Keyboard,
  Maximize2,
  Minimize2,
  MonitorPlay,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Scaling,
  Scan,
  Unplug,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RemoteDesktopDisplayMode,
  RemoteDesktopSession,
} from '#entities/remote-desktop'
import { readClipboardText, writeClipboardText } from '#shared/clipboard'
import {
  ConnectionActionButton,
  SessionNewTabButton,
  SessionTabButton,
  SessionTabStrip,
  WorkspaceEmptyState,
  termousNotificationClassName,
  contextActionMenuPopupClassName,
  uiStyles,
} from '#shared/ui'
import {
  RemoteDesktopViewport,
  type RemoteDesktopViewerState,
  useRemoteDesktopRuntime,
} from '#features/remote-desktop'
import { useRemoteDesktopFullscreen } from '../model/useRemoteDesktopFullscreen.ts'
import { RemoteDesktopConnectionQuality } from './RemoteDesktopConnectionQuality.tsx'
import {
  RemoteDesktopCredentialDialog,
  RemoteDesktopServerVerificationDialog,
} from './RemoteDesktopSecurityDialogs.tsx'
import styles from './RemoteDesktopWorkspace.module.scss'

export { RemoteDesktopCredentialDialog } from './RemoteDesktopSecurityDialogs.tsx'

export interface RemoteDesktopWorkspaceProps {
  onOpenConnectionLauncher: () => void
}

export function RemoteDesktopWorkspace({
  onOpenConnectionLauncher,
}: RemoteDesktopWorkspaceProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const runtime = useRemoteDesktopRuntime()
  const wasFullscreenRef = useRef(false)
  const activeSession = runtime.sessions.find((session) => session.id === runtime.activeSessionId) ?? null
  const viewerState = activeSession ? runtime.viewerStates[activeSession.id] : undefined
  const fullscreen = useRemoteDesktopFullscreen()

  useEffect(() => {
    if (fullscreen.isFullscreen && !wasFullscreenRef.current && activeSession) {
      runtime.focusViewer(activeSession.id)
    }
    wasFullscreenRef.current = fullscreen.isFullscreen
  }, [activeSession, fullscreen.isFullscreen, runtime])

  const closeSession = (session: RemoteDesktopSession) => {
    modal.confirm({
      centered: true,
      title: t('remoteDesktop.disconnectTitle'),
      content: t('remoteDesktop.disconnectDescription', { name: session.profile_name }),
      okText: t('remoteDesktop.disconnect'),
      cancelText: t('app.cancel'),
      async onOk() {
        try {
          await runtime.closeSession(session.id)
        } catch (error) {
          notification.error({
            title: t('remoteDesktop.disconnectFailed'),
            description: publicError(error),
            className: termousNotificationClassName,
          })
          throw error
        }
      },
    })
  }

  const sendClipboard = async () => {
    if (!activeSession || viewerState?.viewOnly) return
    try {
      runtime.sendClipboard(activeSession.id, await readClipboardText())
      notification.success({ title: t('remoteDesktop.clipboardSent'), duration: 2, className: termousNotificationClassName })
    } catch (error) {
      notification.error({
        title: t('remoteDesktop.clipboardFailed'),
        description: publicError(error, t('remoteDesktop.viewerErrors.clipboard_too_large')),
        className: termousNotificationClassName,
      })
    }
  }

  const receiveClipboard = async () => {
    if (!viewerState?.remoteClipboard) return
    try {
      await writeClipboardText(viewerState.remoteClipboard)
      notification.success({ title: t('remoteDesktop.clipboardReceived'), duration: 2, className: termousNotificationClassName })
    } catch (error) {
      notification.error({ title: t('remoteDesktop.clipboardFailed'), description: publicError(error), className: termousNotificationClassName })
    }
  }

  const sendCtrlAltDel = () => {
    if (!activeSession) return
    modal.confirm({
      centered: true,
      title: t('remoteDesktop.ctrlAltDelTitle'),
      content: t('remoteDesktop.ctrlAltDelDescription'),
      okText: t('remoteDesktop.send'),
      cancelText: t('app.cancel'),
      onOk: () => runtime.sendCtrlAltDel(activeSession.id),
    })
  }

  const toggleFullscreen = async () => {
    try {
      await fullscreen.toggleFullscreen()
    } catch (error) {
      notification.error({
        title: t('remoteDesktop.fullscreenFailed'),
        description: publicError(error),
        className: termousNotificationClassName,
      })
    }
  }

  const workspaceClassName = [
    styles.workspace,
    fullscreen.isFullscreen ? styles['is-fullscreen'] : '',
  ].filter(Boolean).join(' ')
  const chromeClassName = [
    styles['top-chrome'],
    fullscreen.isFullscreen && !fullscreen.toolbarVisible ? styles['is-hidden'] : '',
  ].filter(Boolean).join(' ')

  return (
    <section
      className={workspaceClassName}
      data-remote-desktop-workspace=""
      onPointerMoveCapture={(event) => {
        if (fullscreen.isFullscreen && !fullscreen.toolbarVisible && event.clientY <= 8) {
          fullscreen.revealToolbar()
        }
      }}
    >
      <div
        className={chromeClassName}
        onPointerEnter={fullscreen.revealToolbar}
        onPointerLeave={fullscreen.releaseToolbar}
        onFocusCapture={fullscreen.revealToolbar}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            fullscreen.releaseToolbar()
          }
        }}
      >
        <header className={styles.tabs}>
          <SessionTabStrip
            ariaLabel={t('remoteDesktop.sessions')}
            activeId={activeSession?.id}
            contentKey={runtime.sessions.map((session) => `${session.id}:${session.status}`).join('|')}
            scrollLeftLabel={t('remoteDesktop.scrollTabsLeft')}
            scrollRightLabel={t('remoteDesktop.scrollTabsRight')}
            tabsClassName={styles['session-tabs']}
            trailing={(
              <SessionNewTabButton
                label={t('remoteDesktop.newConnection')}
                onClick={onOpenConnectionLauncher}
              />
            )}
          >
            {runtime.sessions.length === 0 ? (
              <SessionTabButton
                empty
                icon={<MonitorPlay size={18} />}
                label={t('app.noSessions')}
              />
            ) : runtime.sessions.map((session) => (
                <SessionTabButton
                  key={session.id}
                  data-session-tab-id={session.id}
                  active={session.id === activeSession?.id}
                  role="tab"
                  aria-selected={session.id === activeSession?.id}
                  icon={<MonitorPlay size={16} />}
                  label={session.profile_name}
                  status={tabStatus(session)}
                  statusLabel={t(`remoteDesktop.status.${session.status}`)}
                  closeLabel={t('remoteDesktop.disconnect')}
                  tooltipTitle={`${session.profile_name} · ${session.host_name}`}
                  onClick={() => runtime.selectSession(session.id)}
                  onClose={() => closeSession(session)}
                />
              ))}
          </SessionTabStrip>
        </header>
        {activeSession ? (
          <RemoteDesktopToolbar
            session={activeSession}
            viewerState={viewerState}
            fullscreen={fullscreen.isFullscreen}
            fullscreenPinned={fullscreen.toolbarPinned}
            onToggleFullscreenPin={fullscreen.toggleToolbarPinned}
            onDisplayMode={(mode) => runtime.setDisplayMode(activeSession.id, mode)}
            onViewOnly={(viewOnly) => runtime.setViewOnly(activeSession.id, viewOnly)}
            onSendClipboard={() => void sendClipboard()}
            onReceiveClipboard={() => void receiveClipboard()}
            onCtrlAltDel={sendCtrlAltDel}
            onFullscreen={() => void toggleFullscreen()}
            onReconnect={() => void runtime.reconnectSession(activeSession.id).catch((error) => notification.error({ title: t('remoteDesktop.reconnectFailed'), description: publicError(error) }))}
            onDisconnect={() => closeSession(activeSession)}
          />
        ) : null}
      </div>
      {activeSession ? (
        <>
          <main className={styles.viewer}>
            <RemoteDesktopViewport sessionId={activeSession.id} />
            <ViewerOverlay session={activeSession} viewerState={viewerState} />
          </main>
          <RemoteDesktopStatusBar session={activeSession} viewerState={viewerState} />
        </>
      ) : (
        <main className={styles['empty-workspace']}>
          <WorkspaceEmptyState
            className={styles['empty-state']}
            icon={<MonitorPlay size={20} aria-hidden="true" />}
            title={t('remoteDesktop.emptyTitle')}
            description={t('remoteDesktop.emptyDescription')}
            action={(
              <ConnectionActionButton
                className={styles['empty-action']}
                icon={<Plus size={16} />}
                onClick={onOpenConnectionLauncher}
              >
                {t('remoteDesktop.newConnection')}
              </ConnectionActionButton>
            )}
          />
        </main>
      )}

      {activeSession && viewerState ? (
        <RemoteDesktopCredentialDialog session={activeSession} />
      ) : null}
      {activeSession && viewerState?.verification ? (
        <RemoteDesktopServerVerificationDialog session={activeSession} />
      ) : null}
    </section>
  )
}

function RemoteDesktopToolbar({
  session,
  viewerState,
  fullscreen,
  fullscreenPinned,
  onToggleFullscreenPin,
  onDisplayMode,
  onViewOnly,
  onSendClipboard,
  onReceiveClipboard,
  onCtrlAltDel,
  onFullscreen,
  onReconnect,
  onDisconnect,
}: {
  session: RemoteDesktopSession
  viewerState: RemoteDesktopViewerState | undefined
  fullscreen: boolean
  fullscreenPinned: boolean
  onToggleFullscreenPin: () => void
  onDisplayMode: (mode: RemoteDesktopDisplayMode) => void
  onViewOnly: (value: boolean) => void
  onSendClipboard: () => void
  onReceiveClipboard: () => void
  onCtrlAltDel: () => void
  onFullscreen: () => void
  onReconnect: () => void
  onDisconnect: () => void
}) {
  const { t } = useTranslation()
  const connected = viewerState?.connection === 'connected'
  const viewOnly = viewerState?.viewOnly ?? false
  const compactItems: MenuProps['items'] = [
    { key: 'send-clipboard', icon: <ClipboardPaste size={15} />, label: t('remoteDesktop.sendClipboard'), disabled: !connected || viewOnly },
    { key: 'receive-clipboard', icon: <ClipboardCopy size={15} />, label: t('remoteDesktop.receiveClipboard'), disabled: !viewerState?.remoteClipboard },
    { key: 'cad', icon: <Keyboard size={15} />, label: t('remoteDesktop.ctrlAltDel'), disabled: !connected || viewOnly },
    {
      key: 'fullscreen',
      icon: fullscreen ? <Minimize2 size={15} /> : <Expand size={15} />,
      label: t(fullscreen ? 'remoteDesktop.exitFullscreen' : 'remoteDesktop.fullscreen'),
    },
  ]
  const handleCompactAction: MenuProps['onClick'] = ({ key }) => {
    if (key === 'send-clipboard') onSendClipboard()
    if (key === 'receive-clipboard') onReceiveClipboard()
    if (key === 'cad') onCtrlAltDel()
    if (key === 'fullscreen') onFullscreen()
  }
  return (
    <div className={styles.toolbar}>
      <Segmented<RemoteDesktopDisplayMode>
        size="small"
        value={viewerState?.displayMode ?? 'fit'}
        options={[
          { value: 'fit', label: <span className={styles['mode-option']}><Scaling size={14} />{t('remoteDesktop.display.fit')}</span> },
          { value: 'resize', label: <span className={styles['mode-option']}><Scan size={14} />{t('remoteDesktop.display.resize')}</span> },
          { value: 'actual', label: <span className={styles['mode-option']}><Maximize2 size={14} />{t('remoteDesktop.display.actual')}</span> },
        ]}
        onChange={onDisplayMode}
      />
      <span className={styles.divider} />
      <label className={styles['view-only']}>
        <Switch size="small" checked={viewOnly} onChange={onViewOnly} />
        <span>{t('remoteDesktop.disableInput')}</span>
      </label>
      <div className={styles['toolbar-spacer']} />
      {fullscreen ? (
        <ToolbarButton
          title={t(fullscreenPinned ? 'remoteDesktop.unpinToolbar' : 'remoteDesktop.pinToolbar')}
          icon={fullscreenPinned ? <PinOff size={16} /> : <Pin size={16} />}
          pressed={fullscreenPinned}
          onClick={onToggleFullscreenPin}
        />
      ) : null}
      <span className={styles['secondary-tools']}>
        <ToolbarButton title={t('remoteDesktop.sendClipboard')} icon={<ClipboardPaste size={16} />} disabled={!connected || viewOnly} onClick={onSendClipboard} />
        <ToolbarButton title={t('remoteDesktop.receiveClipboard')} icon={<ClipboardCopy size={16} />} disabled={!viewerState?.remoteClipboard} onClick={onReceiveClipboard} />
        <ToolbarButton title={t('remoteDesktop.ctrlAltDel')} icon={<Keyboard size={16} />} disabled={!connected || viewOnly} onClick={onCtrlAltDel} />
        <ToolbarButton
          title={t(fullscreen ? 'remoteDesktop.exitFullscreen' : 'remoteDesktop.fullscreen')}
          icon={fullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}
          onClick={onFullscreen}
        />
      </span>
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        menu={{ items: compactItems, onClick: handleCompactAction }}
        classNames={{ root: contextActionMenuPopupClassName }}
      >
        <Button
          type="text"
          className={`${styles['tool-button']} ${styles['more-actions']}`}
          aria-label={t('app.more')}
          icon={<MoreHorizontal size={16} />}
        />
      </Dropdown>
      <ToolbarButton
        title={t('remoteDesktop.reconnect')}
        icon={<RefreshCw size={16} />}
        disabled={['connecting', 'waiting_host_trust', 'reconnecting', 'stopping'].includes(session.status)}
        onClick={onReconnect}
      />
      <ToolbarButton title={t('remoteDesktop.disconnect')} danger icon={<Unplug size={16} />} onClick={onDisconnect} />
    </div>
  )
}

function ToolbarButton({
  title,
  icon,
  disabled,
  danger,
  pressed,
  onClick,
}: {
  title: string
  icon: React.ReactNode
  disabled?: boolean
  danger?: boolean
  pressed?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip
      title={title}
      arrow={false}
      mouseEnterDelay={0.35}
      classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}
    >
      <Button
        type="text"
        className={`${styles['tool-button']} ${danger ? styles['is-danger'] : ''} ${pressed ? styles['is-pressed'] : ''}`}
        aria-label={title}
        aria-pressed={pressed}
        disabled={disabled}
        icon={icon}
        onClick={onClick}
      />
    </Tooltip>
  )
}

function ViewerOverlay({ session, viewerState }: { session: RemoteDesktopSession; viewerState: RemoteDesktopViewerState | undefined }) {
  const { t } = useTranslation()
  if (viewerState?.connection === 'connected') return null
  const busy = viewerState
    ? viewerState.connection === 'loading' || viewerState.connection === 'connecting'
    : ['connecting', 'waiting_host_trust', 'reconnecting', 'ready', 'reattach_wait'].includes(session.status)
  return (
    <div className={styles.overlay} aria-live="polite">
      <span className={`${styles['overlay-icon']} ${busy ? styles['is-busy'] : ''}`}><MonitorPlay size={24} /></span>
      <strong>{t(`remoteDesktop.status.${session.status}`)}</strong>
      <p>{
        (viewerState?.errorCode ? t(`remoteDesktop.viewerErrors.${viewerState.errorCode}`) : '')
        || session.last_error
        || session.status_message
        || t('remoteDesktop.preparingViewer')
      }</p>
      {session.error_code ? <code className={styles['error-code']}>{session.error_code}</code> : null}
    </div>
  )
}

function RemoteDesktopStatusBar({ session, viewerState }: { session: RemoteDesktopSession; viewerState: RemoteDesktopViewerState | undefined }) {
  const { t } = useTranslation()
  const reconnectAttempt = session.reconnect_attempt ?? 0
  const reconnectMaxAttempts = session.reconnect_max_attempts ?? 0
  return (
    <footer className={styles.statusbar}>
      <div className={styles['status-context']}>
        <span className={`${styles.dot} ${styles[`is-${tabStatus(session).replace('_', '-')}`]}`} />
        <strong>{t(`remoteDesktop.status.${session.status}`)}</strong>
        <span className={styles['status-host']}>{session.host_name}</span>
        {viewerState?.targetLabel ? (
          <span className={styles['status-target']}>{viewerState.targetLabel}</span>
        ) : null}
        {viewerState?.desktopName ? <span className={styles['desktop-name']}>{viewerState.desktopName}</span> : null}
        {session.status === 'reconnecting' && reconnectAttempt > 0 && reconnectMaxAttempts > 0 ? (
          <span className={styles['reconnect-progress']}>
            {t('remoteDesktop.reconnectProgress', { current: reconnectAttempt, total: reconnectMaxAttempts })}
          </span>
        ) : null}
      </div>
      <RemoteDesktopConnectionQuality
        sessionId={session.id}
        connected={viewerState?.connection === 'connected'}
        showSshLatency={session.route === 'ssh_tunnel'}
      />
    </footer>
  )
}

function tabStatus(session: RemoteDesktopSession) {
  if (session.status === 'streaming' || session.status === 'ready') return 'connected'
  if (session.status === 'waiting_host_trust') return 'waiting_host_trust'
  if (session.status === 'failed') return 'failed'
  if (session.status === 'stopping') return 'closing'
  return 'connecting'
}

function publicError(error: unknown, clipboardTooLargeMessage = '') {
  const message = error instanceof Error ? error.message : String(error)
  return message === 'REMOTE_DESKTOP_CLIPBOARD_TOO_LARGE'
    ? clipboardTooLargeMessage
    : message
}

import {
  App as AntdApp,
  Button,
  Dropdown,
  Switch,
  Tooltip,
  type MenuProps,
} from 'antd'
import {
  ClipboardCopy,
  ClipboardPaste,
  Expand,
  Keyboard,
  Minimize2,
  MonitorPlay,
  MoreHorizontal,
  Pin,
  PinOff,
  RefreshCw,
  Unplug,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RemoteDesktopSession,
} from '#entities/remote-desktop'
import { readClipboardText, writeClipboardText } from '#shared/clipboard'
import {
  ConnectionEmptyState,
  termousNotificationClassName,
  contextActionMenuPopupClassName,
  uiStyles,
} from '#shared/ui'
import {
  RemoteDesktopViewport,
  type RemoteDesktopViewerState,
  type DesktopScaleMode,
  useRemoteDesktopRuntime,
} from '#features/remote-desktop'
import { useRemoteDesktopFullscreen } from '../model/useRemoteDesktopFullscreen.ts'
import { RemoteDesktopStatusBar } from './RemoteDesktopStatusBar.tsx'
import { RemoteDesktopSessionTabs, type RemoteDesktopSessionTabsProps } from './RemoteDesktopSessionTabs.tsx'
import styles from './RemoteDesktopWorkspace.module.scss'
import { DesktopFilesPanel, type DesktopFilesTab } from './files/DesktopFilesPanel.tsx'
import { DesktopAutomationStatus } from './DesktopAutomationStatus.tsx'
import { RemoteDesktopWorkspaceActions, type RemoteDesktopWorkspaceTool } from './RemoteDesktopWorkspaceActions.tsx'
import { RemoteDesktopDisplayControls } from './RemoteDesktopDisplayControls.tsx'

export interface RemoteDesktopWorkspaceProps extends Omit<RemoteDesktopSessionTabsProps, 'onOpenLauncher' | 'onClose'> {
  onOpenConnectionLauncher?: () => void
  tools?: RemoteDesktopWorkspaceTool[]
  toolsButtonRef?: Ref<HTMLButtonElement>
}

export function RemoteDesktopWorkspace({
  onOpenConnectionLauncher,
  tools,
  toolsButtonRef,
  getAgentConnectionReferenceSnapshot,
  onReferenceAgentConnection,
  profiles, hosts, sshAccessProfiles, getHostIconUrl,
}: RemoteDesktopWorkspaceProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const runtime = useRemoteDesktopRuntime()
  const [filesOpen, setFilesOpen] = useState(false)
  const wasFullscreenRef = useRef(false)
  const activeSession = runtime.sessions.find((session) => session.id === runtime.activeSessionId) ?? null
  const filesSessionKey = `${activeSession?.id ?? ''}:${activeSession?.connection_generation ?? 0}`
  const [filesSelection, setFilesSelection] = useState<{ sessionKey: string; tab: DesktopFilesTab }>()
  const filesTab = filesSelection?.sessionKey === filesSessionKey ? filesSelection.tab : undefined
  const viewerState = activeSession ? runtime.viewerStates[activeSession.id] : undefined
  const fullscreen = useRemoteDesktopFullscreen()
  const clipboardRequest = useRef({ revision: 0 })

  useLayoutEffect(() => {
    // 系统读取完成前切换会话、重连或交接控制，旧的手动发送不能落到新上下文。
    const request = clipboardRequest.current
    return () => { request.revision++ }
  }, [activeSession?.id, activeSession?.connection_generation, viewerState?.connection, viewerState?.viewOnly, viewerState?.controlOwned, viewerState?.controlLease?.id, viewerState?.controlLease?.generation])

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
    if (!activeSession || viewerState?.connection !== 'connected' || viewerState.viewOnly || viewerState.controlOwned === false) return
    const request = clipboardRequest.current
    const revision = ++request.revision
    try {
      const text = await readClipboardText()
      if (revision !== request.revision) return
      await runtime.sendClipboard(activeSession.id, text)
      if (revision !== request.revision) return
      notification.success({ title: t('remoteDesktop.clipboardSent'), duration: 2, className: termousNotificationClassName })
    } catch (error) {
      if (revision !== request.revision) return
      notification.error({
        title: t('remoteDesktop.clipboardFailed'),
        description: error instanceof Error && ['clipboard_failed', 'clipboard_too_large', 'clipboard_unavailable', 'clipboard_timeout'].includes(error.message)
          ? t(`remoteDesktop.viewerErrors.${error.message}`)
          : publicError(error, t('remoteDesktop.viewerErrors.clipboard_too_large')),
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
      data-tour="desktop-workspace"
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
          <RemoteDesktopSessionTabs onOpenLauncher={onOpenConnectionLauncher} onClose={closeSession}
            profiles={profiles} hosts={hosts} sshAccessProfiles={sshAccessProfiles} getHostIconUrl={getHostIconUrl}
            getAgentConnectionReferenceSnapshot={getAgentConnectionReferenceSnapshot}
            onReferenceAgentConnection={onReferenceAgentConnection}
          />
          <RemoteDesktopWorkspaceActions
            retainedSessions={runtime.sessions.filter((session) => runtime.hiddenSessionIds.includes(session.id))}
            onSelectSession={runtime.selectSession}
            onOpenFiles={runtime.desktopFiles ? () => setFilesOpen(true) : undefined}
            tools={fullscreen.isFullscreen ? undefined : tools}
            toolsButtonRef={toolsButtonRef}
          />
        </header>
        {activeSession ? (
          <RemoteDesktopToolbar
            session={activeSession}
            viewerState={viewerState}
            fullscreen={fullscreen.isFullscreen}
            fullscreenPinned={fullscreen.toolbarPinned}
            onToggleFullscreenPin={fullscreen.toggleToolbarPinned}
            onDisplayMode={(mode) => runtime.setDisplayMode(activeSession.id, mode)}
            onFollowWindow={(value) => runtime.setFollowWindow(activeSession.id, value)}
            onViewOnly={(viewOnly) => runtime.setViewOnly(activeSession.id, viewOnly)}
            onSendClipboard={() => void sendClipboard()}
            onReceiveClipboard={() => void receiveClipboard()}
            onCtrlAltDel={sendCtrlAltDel}
            onFullscreen={() => void toggleFullscreen()}
            reconnectPending={runtime.pendingSessionActionIds.has(activeSession.id)}
            onReconnect={() => void runtime.reconnectSession(activeSession.id).catch((error) => notification.error({ title: t('remoteDesktop.reconnectFailed'), description: publicError(error) }))}
            onDisconnect={() => closeSession(activeSession)}
          />
        ) : null}
      </div>
      {activeSession ? (
        <>
          <main className={styles.viewer}>
            <DesktopAutomationStatus key={activeSession.id} session={activeSession} />
            <RemoteDesktopViewport sessionId={activeSession.id} />
            {!activeSession.automation_host_id && <ViewerOverlay session={activeSession} viewerState={viewerState} />}
          </main>
        </>
      ) : (
        <main className={styles['empty-workspace']}>
          <ConnectionEmptyState
            icon={<MonitorPlay size={20} aria-hidden="true" />}
            title={t('remoteDesktop.emptyTitle')}
            description={t('remoteDesktop.emptyDescription')}
            onConnect={onOpenConnectionLauncher}
          />
        </main>
      )}

      {activeSession && <RemoteDesktopStatusBar session={activeSession} viewerState={viewerState} filesOpen={filesOpen}
        onOpenTransfers={runtime.desktopFiles ? () => {
          setFilesSelection({ sessionKey: filesSessionKey, tab: 'tasks' })
          setFilesOpen(true)
        } : undefined} />}

      {runtime.desktopFiles && <DesktopFilesPanel key={filesSessionKey} open={filesOpen} api={runtime.desktopFiles} session={activeSession} viewer={viewerState}
        activeTab={filesTab} onTabChange={tab => setFilesSelection({ sessionKey: filesSessionKey, tab })} onClose={() => setFilesOpen(false)} />}
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
  onFollowWindow,
  onViewOnly,
  onSendClipboard,
  onReceiveClipboard,
  onCtrlAltDel,
  onFullscreen,
  onReconnect,
  reconnectPending,
  onDisconnect,
}: {
  session: RemoteDesktopSession
  viewerState: RemoteDesktopViewerState | undefined
  fullscreen: boolean
  fullscreenPinned: boolean
  onToggleFullscreenPin: () => void
  onDisplayMode: (mode: DesktopScaleMode) => void
  onFollowWindow: (value: boolean) => void
  onViewOnly: (value: boolean) => void
  onSendClipboard: () => void
  onReceiveClipboard: () => void
  onCtrlAltDel: () => void
  onFullscreen: () => void
  onReconnect: () => void
  reconnectPending: boolean
  onDisconnect: () => void
}) {
  const { t } = useTranslation()
  const connected = viewerState?.connection === 'connected'
  const viewOnly = viewerState?.viewOnly ?? false
  const inputDisabled = viewOnly || viewerState?.controlOwned === false
  const compactItems: MenuProps['items'] = [
    { key: 'send-clipboard', icon: <ClipboardPaste size={15} />, label: t('remoteDesktop.sendClipboard'), disabled: !connected || inputDisabled },
    { key: 'receive-clipboard', icon: <ClipboardCopy size={15} />, label: t('remoteDesktop.receiveClipboard'), disabled: !viewerState?.remoteClipboard },
    { key: 'cad', icon: <Keyboard size={15} />, label: t('remoteDesktop.ctrlAltDel'), disabled: !connected || inputDisabled },
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
      <RemoteDesktopDisplayControls state={viewerState} onScale={onDisplayMode} onFollow={onFollowWindow} />
      <span className={styles.divider} />
      <label className={styles['view-only']}>
        <Switch size="small" aria-label={t('remoteDesktop.disableInput')} checked={viewOnly} onChange={onViewOnly} />
        <span>{t('remoteDesktop.disableInput')}</span>
      </label>
      {connected && viewerState?.controlOwned === false && !viewOnly ? (
        <Button size="small" onClick={() => onViewOnly(false)}>{t('remoteDesktop.reclaimControl')}</Button>
      ) : null}
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
        <ToolbarButton title={t('remoteDesktop.sendClipboard')} icon={<ClipboardPaste size={16} />} disabled={!connected || inputDisabled} onClick={onSendClipboard} />
        <ToolbarButton title={t('remoteDesktop.receiveClipboard')} icon={<ClipboardCopy size={16} />} disabled={!viewerState?.remoteClipboard} onClick={onReceiveClipboard} />
        <ToolbarButton title={t('remoteDesktop.ctrlAltDel')} icon={<Keyboard size={16} />} disabled={!connected || inputDisabled} onClick={onCtrlAltDel} />
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
        disabled={reconnectPending || ['connecting', 'waiting_host_trust', 'reconnecting', 'stopping'].includes(session.status)}
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

function publicError(error: unknown, clipboardTooLargeMessage = '') {
  const message = error instanceof Error ? error.message : String(error)
  return message === 'REMOTE_DESKTOP_CLIPBOARD_TOO_LARGE'
    ? clipboardTooLargeMessage
    : message
}

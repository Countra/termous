import {
  App as AntdApp,
  Button,
  Dropdown,
  Form,
  Input,
  Modal,
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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RemoteDesktopDisplayMode,
  RemoteDesktopProfile,
  RemoteDesktopProfileInput,
  RemoteDesktopSession,
  VncCredentials,
} from '#entities/remote-desktop'
import type { Host } from '#entities/host'
import { readClipboardText, writeClipboardText } from '#shared/clipboard'
import {
  EmptyState,
  SessionNewTabButton,
  SessionTabButton,
  SessionTabStrip,
  termousNotificationClassName,
  contextActionMenuPopupClassName,
  uiStyles,
} from '#shared/ui'
import {
  RemoteDesktopLauncher,
  RemoteDesktopViewport,
  type VncViewerState,
  useRemoteDesktopRuntime,
} from '#features/remote-desktop'
import { useRemoteDesktopFullscreen } from '../model/useRemoteDesktopFullscreen.ts'
import { RemoteDesktopConnectionQuality } from './RemoteDesktopConnectionQuality.tsx'
import styles from './RemoteDesktopWorkspace.module.scss'

export interface RemoteDesktopWorkspaceProps {
  profiles: RemoteDesktopProfile[]
  hosts: Host[]
  actionBusy: boolean
  launcherOpen: boolean
  onLauncherOpenChange: (open: boolean) => void
  onCreateProfile: (input: RemoteDesktopProfileInput) => Promise<RemoteDesktopProfile>
  onUpdateProfile: (id: string, input: RemoteDesktopProfileInput) => Promise<RemoteDesktopProfile>
  onDeleteProfile: (id: string) => Promise<void>
}

export function RemoteDesktopWorkspace({
  profiles,
  hosts,
  actionBusy,
  launcherOpen,
  onLauncherOpenChange,
  onCreateProfile,
  onUpdateProfile,
  onDeleteProfile,
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

  const connectProfile = async (profileId: string) => {
    await runtime.createSession(profileId)
  }

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
            trailing={(
              <SessionNewTabButton
                label={t('remoteDesktop.newConnection')}
                onClick={() => onLauncherOpenChange(true)}
              />
            )}
          >
            {runtime.sessions.map((session) => (
              <SessionTabButton
                key={session.id}
                data-session-tab-id={session.id}
                active={session.id === activeSession?.id}
                icon={<MonitorPlay size={16} />}
                label={session.profile_name}
                status={tabStatus(session)}
                statusLabel={t(`remoteDesktop.status.${session.status}`)}
                closeLabel={t('remoteDesktop.disconnect')}
                tooltipTitle={`${session.profile_name} · ${session.ssh_host_name}`}
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
        <div className={styles['empty-workspace']}>
          <EmptyState title={t('remoteDesktop.emptyTitle')} description={t('remoteDesktop.emptyDescription')} />
          <Button type="primary" icon={<Plus size={16} />} onClick={() => onLauncherOpenChange(true)}>
            {t('remoteDesktop.newConnection')}
          </Button>
        </div>
      )}

      <RemoteDesktopLauncher
        open={launcherOpen}
        profiles={profiles}
        hosts={hosts}
        actionBusy={actionBusy}
        onClose={() => onLauncherOpenChange(false)}
        onCreate={onCreateProfile}
        onUpdate={onUpdateProfile}
        onDelete={onDeleteProfile}
        onConnect={connectProfile}
      />
      {activeSession && viewerState ? (
        <VncCredentialDialog session={activeSession} />
      ) : null}
      {activeSession && viewerState?.verification ? (
        <VncServerVerificationDialog session={activeSession} />
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
  viewerState: VncViewerState | undefined
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
  const viewOnly = viewerState?.viewOnly ?? session.vnc.default_view_only
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
        value={viewerState?.displayMode ?? session.vnc.default_display_mode}
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

function ViewerOverlay({ session, viewerState }: { session: RemoteDesktopSession; viewerState: VncViewerState | undefined }) {
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

function RemoteDesktopStatusBar({ session, viewerState }: { session: RemoteDesktopSession; viewerState: VncViewerState | undefined }) {
  const { t } = useTranslation()
  const reconnectAttempt = session.reconnect_attempt ?? 0
  const reconnectMaxAttempts = session.reconnect_max_attempts ?? 0
  return (
    <footer className={styles.statusbar}>
      <div className={styles['status-context']}>
        <span className={`${styles.dot} ${styles[`is-${tabStatus(session).replace('_', '-')}`]}`} />
        <strong>{t(`remoteDesktop.status.${session.status}`)}</strong>
        <span className={styles['status-host']}>{session.ssh_host_name}</span>
        <span className={styles['status-target']}>VNC · {session.vnc.loopback_host}:{session.vnc.port}</span>
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
      />
    </footer>
  )
}

export function VncCredentialDialog({ session }: { session: RemoteDesktopSession }) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const runtime = useRemoteDesktopRuntime()
  const state = runtime.viewerStates[session.id]
  const [values, setValues] = useState<VncCredentials>({})
  const open = state?.connection === 'credentials_required'
  const credentialTypesKey = state?.credentialTypes.join('|') ?? ''
  const missingRequiredValue = state?.credentialTypes.some((type) => !(values[type] ?? '').length) ?? true

  useEffect(() => {
    setValues({})
  }, [credentialTypesKey, open, session.id])

  const submit = () => {
    if (!state || missingRequiredValue) {
      return
    }
    const credentials = Object.fromEntries(
      state.credentialTypes.map((type) => [type, values[type] ?? '']),
    ) as VncCredentials
    runtime.submitCredentials(session.id, credentials)
    setValues({})
  }

  return (
    <Modal
      open={open}
      centered
      width={440}
      title={t('remoteDesktop.credentialsTitle')}
      okText={t('app.connect')}
      cancelText={t('remoteDesktop.disconnect')}
      okButtonProps={{ disabled: missingRequiredValue }}
      onOk={submit}
      onCancel={() => {
        void runtime.closeSession(session.id).catch((error) => {
          notification.error({
            title: t('remoteDesktop.disconnectFailed'),
            description: publicError(error),
            className: termousNotificationClassName,
          })
        })
      }}
      afterClose={() => setValues({})}
      destroyOnHidden
    >
      <p className={styles['dialog-hint']}>{t('remoteDesktop.credentialsHint')}</p>
      <Form layout="vertical">
        {state?.credentialTypes.map((type) => (
          <Form.Item key={type} label={t(`remoteDesktop.credentials.${type}`)} required>
            <Input
              autoComplete="off"
              type={type === 'password' ? 'password' : 'text'}
              value={values[type] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [type]: event.target.value }))}
              onPressEnter={() => {
                if (!missingRequiredValue) submit()
              }}
            />
          </Form.Item>
        ))}
      </Form>
    </Modal>
  )
}

function VncServerVerificationDialog({ session }: { session: RemoteDesktopSession }) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const runtime = useRemoteDesktopRuntime()
  const verification = runtime.viewerStates[session.id]?.verification
  return (
    <Modal
      open={Boolean(verification)}
      centered
      width={520}
      title={t('remoteDesktop.verifyServerTitle')}
      okText={t('remoteDesktop.trustAndContinue')}
      cancelText={t('remoteDesktop.rejectServer')}
      okButtonProps={{ danger: false }}
      cancelButtonProps={{ danger: true }}
      onOk={() => runtime.approveServer(session.id)}
      onCancel={() => {
        void runtime.rejectServer(session.id).catch((error) => {
          notification.error({
            title: t('remoteDesktop.disconnectFailed'),
            description: publicError(error),
            className: termousNotificationClassName,
          })
        })
      }}
      closable={false}
      mask={{ closable: false }}
    >
      <p className={styles['dialog-hint']}>{t('remoteDesktop.verifyServerHint')}</p>
      <dl className={styles.fingerprint}>
        <div><dt>{t('remoteDesktop.verificationType')}</dt><dd>{verification?.type}</dd></div>
        <div><dt>{t('hostKey.fingerprint')}</dt><dd>{verification?.fingerprint}</dd></div>
      </dl>
    </Modal>
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

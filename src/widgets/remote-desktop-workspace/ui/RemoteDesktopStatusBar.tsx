import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { RemoteDesktopViewerState } from '#features/remote-desktop'
import { RemoteDesktopConnectionQuality } from './RemoteDesktopConnectionQuality.tsx'
import styles from './RemoteDesktopStatusBar.module.scss'

interface Props {
  session?: RemoteDesktopSession
  viewerState?: RemoteDesktopViewerState
}

export function RemoteDesktopStatusBar({ session, viewerState }: Props) {
  const { t } = useTranslation()
  const reconnectAttempt = session?.reconnect_attempt ?? 0
  const reconnectMaxAttempts = session?.reconnect_max_attempts ?? 0
  return <footer className={styles.statusbar}>
    <div className={styles['status-context']}>
      <span className={styles.dot} data-status={session?.status} />
      <strong>{t(session ? `remoteDesktop.status.${session.status}` : 'app.noSessions')}</strong>
      {session && <span className={styles['status-host']}>{session.host_name}</span>}
      {viewerState?.targetLabel && <span className={styles['status-target']}>{viewerState.targetLabel}</span>}
      {viewerState?.desktopName && <span className={styles['desktop-name']}>{viewerState.desktopName}</span>}
      {session?.status === 'reconnecting' && reconnectAttempt > 0 && reconnectMaxAttempts > 0 && <span className={styles['reconnect-progress']}>{t('remoteDesktop.reconnectProgress', { current: reconnectAttempt, total: reconnectMaxAttempts })}</span>}
    </div>
    <div className={styles.actions}>
      {session && <RemoteDesktopConnectionQuality sessionId={session.id} connected={viewerState?.connection === 'connected'} showSshLatency={session.route === 'ssh_tunnel'} />}
    </div>
  </footer>
}

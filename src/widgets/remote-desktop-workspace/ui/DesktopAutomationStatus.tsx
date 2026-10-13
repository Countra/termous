import { Alert, Button, Space } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { useRemoteDesktopRuntime } from '#features/remote-desktop'
import styles from './DesktopAutomationStatus.module.scss'

export function DesktopAutomationStatus({ session }: { session: RemoteDesktopSession }) {
  const { t } = useTranslation()
  const { automation } = useRemoteDesktopRuntime()
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  if (!session.automation && !session.automation_host_id) return null
  const seconds = session.automation ? Math.max(0, Math.ceil((Math.min(Date.parse(session.automation.expires_at), Date.parse(session.automation.idle_expires_at)) - now) / 1000)) : 0
  const act = async (show: boolean) => {
    if (!automation || busy) return
    setBusy(true); setFailed(false)
    try {
      if (show && session.automation_host_id) await automation.show(session.id, session.connection_generation, session.automation_host_id)
      else await automation.reclaim(session.id, session.connection_generation)
    } catch { setFailed(true) } finally { setBusy(false) }
  }
  return <Alert className={styles.status} type={failed ? 'error' : 'info'} title={failed ? t('remoteDesktop.automation.actionFailed') : session.automation ? t('remoteDesktop.automation.controlling', { name: session.automation.client_name, seconds }) : t('remoteDesktop.automation.observing')} action={<Space wrap>
    {session.automation_host_id && <Button size="small" disabled={busy} onClick={() => void act(true)}>{t('remoteDesktop.automation.view')}</Button>}
    <Button size="small" loading={busy} onClick={() => void act(false)}>{t('remoteDesktop.automation.reclaim')}</Button>
  </Space>} />
}

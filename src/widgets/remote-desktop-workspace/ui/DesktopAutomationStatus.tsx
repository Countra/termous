import { Button, Popover } from 'antd'
import { Bot, ChevronUp, Eye, MousePointer2, Undo2, Workflow } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { useRemoteDesktopRuntime } from '#features/remote-desktop'
import styles from './DesktopAutomationStatus.module.scss'

export function DesktopAutomationStatus({ session }: { session: RemoteDesktopSession }) {
  const { t } = useTranslation()
  const { automation } = useRemoteDesktopRuntime()
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<'show' | 'reclaim' | null>(null)
  const [failed, setFailed] = useState(false)
  const pending = useRef(false)
  const lifetime = useRef(0)
  const control = session.automation
  const controlId = control?.id

  useEffect(() => {
    const epoch = ++lifetime.current
    pending.current = false
    setBusy(null)
    setFailed(false)
    setNow(Date.now())
    const timer = controlId ? window.setInterval(() => setNow(Date.now()), 1000) : undefined
    return () => {
      lifetime.current = epoch + 1
      window.clearInterval(timer)
    }
  }, [session.id, session.connection_generation, controlId, session.automation_host_id])

  if (!control && !session.automation_host_id) return null
  const deadline = control ? Math.min(Date.parse(control.expires_at), Date.parse(control.idle_expires_at)) : NaN
  const seconds = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null
  const expired = seconds === 0
  const time = seconds === null ? '—' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const source = control?.source
  const Icon = source === 'agent' ? Bot : source === 'workflow' ? Workflow : MousePointer2
  const label = t(!control ? 'remoteDesktop.automation.observing'
    : expired ? 'remoteDesktop.automation.expired'
      : source === 'agent' ? 'remoteDesktop.automation.aiControlling'
        : source === 'workflow' ? 'remoteDesktop.automation.workflowControlling' : 'remoteDesktop.automation.active')
  const client = source === 'agent' ? t('settings.mcp.builtinAgentName') : control?.client_name
  const expiryLabel = t(seconds === null ? 'remoteDesktop.automation.expiryUnknown'
    : expired ? 'remoteDesktop.automation.expired' : 'remoteDesktop.automation.releasesIn', { time })

  const act = async (kind: 'show' | 'reclaim') => {
    if (!automation || pending.current) return
    const epoch = lifetime.current
    pending.current = true
    setBusy(kind)
    setFailed(false)
    try {
      if (kind === 'show') {
        if (session.automation_host_id) await automation.show(session.id, session.connection_generation, session.automation_host_id)
      } else {
        await automation.reclaim(session.id, session.connection_generation)
      }
    } catch {
      if (epoch === lifetime.current) setFailed(true)
    } finally {
      // 控制权或连接代次变化后，旧操作不能覆盖新状态。
      if (epoch === lifetime.current) {
        pending.current = false
        setBusy(null)
      }
    }
  }
  return (
    <div className={styles.status} data-controlling={Boolean(control && !expired)} data-expired={expired}>
      <div className={styles.corner} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
        {failed && <div className={styles.feedback} role="alert">{t('remoteDesktop.automation.actionFailed')}</div>}
        <div className={styles.bar}>
          <Popover
            trigger={['hover', 'click']}
            placement="topRight"
            content={(
              <div className={styles.details}>
                <strong>{label}</strong>
                {client && <span>{client}</span>}
                {control && <span>{expiryLabel}</span>}
              </div>
            )}
          >
            <Button type="text" className={styles.summary} aria-label={t('remoteDesktop.automation.controlDetails')}>
              <Icon size={15} aria-hidden="true" /><span>{label}</span><ChevronUp size={12} aria-hidden="true" />
            </Button>
          </Popover>
          {control && <span className={styles.countdown} title={expiryLabel}>{time}</span>}
          <div className={styles.actions}>
            {session.automation_host_id && (
              <Button
                type="text"
                size="small"
                loading={busy === 'show'}
                disabled={!automation || Boolean(busy)}
                onClick={() => void act('show')}
                icon={<Eye size={14} aria-hidden="true" />}
              >
                {t('remoteDesktop.automation.view')}
              </Button>
            )}
            <Button
              size="small"
              loading={busy === 'reclaim'}
              disabled={!automation || Boolean(busy)}
              onClick={() => void act('reclaim')}
              icon={<Undo2 size={13} aria-hidden="true" />}
            >
              {t('remoteDesktop.automation.reclaim')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

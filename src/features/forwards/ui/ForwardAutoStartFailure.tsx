import { AlertCircle } from 'lucide-react'
import { Tooltip } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatForwardDateTime } from '../model/forwardTiming'
import styles from './ForwardManagement.module.scss'

export function ForwardAutoStartFailure({ reason, failedAt }: { reason?: string; failedAt?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const failureTime = formatForwardDateTime(failedAt ?? '')

  useEffect(() => {
    if (!open) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      } else if (event.key === 'Tab') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', dismiss, true)
    return () => document.removeEventListener('keydown', dismiss, true)
  }, [open])

  return (
    <Tooltip
      trigger="click"
      placement="topLeft"
      open={open}
      onOpenChange={setOpen}
      destroyOnHidden
      classNames={{ root: `${styles['forward-route-tooltip']} ${styles['forwarding-startup-tooltip']}` }}
      title={(
        <div className={styles['forwarding-startup-error']}>
          <strong>{t('forwards.autoStartFailed')}</strong>
          {failureTime ? (
            <div className={styles['forwarding-startup-error-time']}>
              <span>{t('forwards.autoStartFailedAt')}</span>
              <time dateTime={failedAt}>{failureTime}</time>
            </div>
          ) : null}
          <p>{reason || t('forwards.status.failed')}</p>
        </div>
      )}
    >
      <button
        type="button"
        className={`${styles['forwarding-auto-start-badge']} ${styles['is-failed']}`}
        aria-label={t('forwards.autoStartFailureDetails')}
        aria-expanded={open}
      >
        <AlertCircle size={12} aria-hidden="true" />
        <span>{t('forwards.autoStartBadge')}</span>
      </button>
    </Tooltip>
  )
}

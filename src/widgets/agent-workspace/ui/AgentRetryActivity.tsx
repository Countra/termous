import { Clock3, Wifi } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentRetryActivity as RetryActivity } from '#entities/agent'
import styles from './AgentRetryActivity.module.scss'

export function AgentRetryActivity({ activity, hideError = false }: { activity: RetryActivity; hideError?: boolean }) {
  const { t, i18n } = useTranslation()
  const active = activity.status === 'waiting' || activity.status === 'requesting'
  const formatSeconds = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage, {
    maximumFractionDigits: 1,
  }).format(value / 1_000)
  const duration = !active && activity.duration_ms !== undefined
    ? activity.duration_ms < 1_000 ? `${activity.duration_ms} ms` : `${formatSeconds(activity.duration_ms)} s`
    : undefined
  return (
    <div className={styles.activity} data-retry-id={activity.retry_id} data-status={activity.status}>
      <div className={styles.header} role="status" aria-live="polite" aria-atomic="true">
        <span className={styles.label}>
          <Wifi className={styles.icon} size={14} aria-hidden="true" />
          <span>{t(`agent.retry.${activity.status}`, {
            attempt: activity.status === 'waiting' ? activity.attempt + 1 : activity.attempt,
            max: activity.max_retries,
          })}</span>
          {activity.purpose === 'compaction' ? <span className={styles.purpose}>{t('agent.retry.compaction')}</span> : null}
        </span>
        <span className={styles.metadata}>
          {activity.status === 'waiting' ? t('agent.retry.wait', { seconds: formatSeconds(activity.delay_ms) }) : null}
          {!active ? t('agent.retry.attempts', { count: activity.attempt }) : null}
          {duration ? <span className={styles.duration}><span aria-hidden="true">·</span><Clock3 size={12} aria-hidden="true" />{duration}</span> : null}
        </span>
      </div>
      {activity.error_message && !hideError ? (
        <div className={styles.error} aria-live="off">{activity.error_message}</div>
      ) : null}
    </div>
  )
}

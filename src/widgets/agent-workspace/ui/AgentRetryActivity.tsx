import { ChevronDown, ChevronRight, Clock3, Wifi } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentRetryActivity as RetryActivity } from '#entities/agent'
import styles from './AgentRetryActivity.module.scss'

export function AgentRetryActivity({ activity }: { activity: RetryActivity }) {
  const { t, i18n } = useTranslation()
  const detailsId = useId()
  const [expandedPhase, setExpandedPhase] = useState<string>()
  const active = activity.status === 'waiting' || activity.status === 'requesting'
  const phase = `${activity.retry_id}:${activity.status === 'completed' ? 'completed' : 'details'}`
  const expanded = expandedPhase === phase
  const showDetails = activity.status !== 'completed' || expanded
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
      {activity.error_message ? (
        <div className={styles.details} aria-live="off">
          {showDetails ? (
            <div id={detailsId} className={`${styles.error} ${expanded ? '' : styles.clamped}`}>
              {activity.error_message}
            </div>
          ) : <div id={detailsId} hidden />}
          <button
            type="button"
            className={styles.toggle}
            aria-controls={detailsId}
            aria-expanded={expanded}
            onClick={() => setExpandedPhase(expanded ? undefined : phase)}
          >
            {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
            {t(expanded ? 'agent.retry.collapse' : activity.status === 'completed' ? 'agent.retry.lastError' : 'agent.retry.expand')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

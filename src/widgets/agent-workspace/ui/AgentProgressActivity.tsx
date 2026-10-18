import { CircleAlert, CircleCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentProgressActivity as ProgressActivity } from '#entities/agent'
import styles from './AgentProgressActivity.module.scss'

export function AgentProgressActivity({ activity }: { activity: ProgressActivity }) {
  const { t } = useTranslation()
  const Icon = activity.status === 'progressed' ? CircleCheck : CircleAlert
  return (
    <details className={styles.activity} data-progress-id={activity.pattern_id} data-status={activity.status}>
      <summary><Icon size={14} aria-hidden="true" /><span>{t(`agent.progress.${activity.status}`, { count: activity.count })}</span></summary>
      <p>{activity.guidance}</p>
      {activity.next_tools.length ? <p>{t('agent.progress.candidates')}: {activity.next_tools.join(', ')}</p> : null}
    </details>
  )
}

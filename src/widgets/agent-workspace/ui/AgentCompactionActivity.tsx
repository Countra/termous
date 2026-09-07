import { CircleAlert, Clock3, FileCheck2, LoaderCircle, Minimize2 } from 'lucide-react'
import { Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentCompactionActivity as CompactionActivity } from '#entities/agent'
import { formatAgentTokenCount } from './agentTokenUsageFormat.ts'
import styles from './AgentCompactionActivity.module.scss'

export function AgentCompactionActivity({ activity }: { activity: CompactionActivity }) {
  const { t, i18n } = useTranslation()
  const Icon = activity.status === 'started' ? LoaderCircle
    : activity.status === 'completed' ? FileCheck2
      : activity.status === 'failed' ? CircleAlert : Minimize2
  const label = activity.status === 'completed' && activity.reason === 'manual'
    ? 'agent.compaction.manualCompleted'
    : `agent.compaction.${activity.status}`
  const language = i18n.resolvedLanguage
  const window = activity.context_window_tokens
  const hasWindow = window !== undefined && Number.isSafeInteger(window) && window > 0
  const after = activity.status === 'completed' ? activity.tokens_after : undefined
  const duration = activity.status !== 'started' && activity.duration_ms !== undefined
    && Number.isSafeInteger(activity.duration_ms) && activity.duration_ms >= 0
    ? formatDuration(activity.duration_ms)
    : undefined
  const formatUsage = (tokens: number) => hasWindow
    ? new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 }).format(tokens / window)
    : `${formatAgentTokenCount(tokens, language)} token`
  const usageDetails = t(after === undefined ? 'agent.compaction.tokensBefore' : 'agent.compaction.tokensBeforeAfter', {
    before: formatAgentTokenCount(activity.tokens_before, language),
    after: after === undefined ? undefined : formatAgentTokenCount(after, language),
  })
  const details = [
    usageDetails,
    hasWindow ? t('agent.compaction.contextWindow', { tokens: formatAgentTokenCount(window, language) }) : undefined,
    duration ? t('agent.compaction.duration', { duration }) : undefined,
  ].filter(Boolean).join(' ')
  return (
    <div
      className={styles.activity}
      data-compaction-id={activity.compaction_id}
      data-status={activity.status}
      role="status"
      aria-atomic="true"
    >
      <span className={styles.label}>
        <Icon className={styles.icon} size={14} aria-hidden="true" />
        <span>{t(label)}</span>
      </span>
      <Tooltip title={details} trigger={['hover', 'focus']}>
        <span className={styles.metadata} tabIndex={0} role="group" aria-label={details}>
          <span className={styles.usage}>
            {formatUsage(activity.tokens_before)}{after !== undefined ? ` → ${formatUsage(after)}` : ''}
          </span>
          {duration ? (
            <span className={styles.duration}>
              <span aria-hidden="true">·</span><Clock3 size={12} aria-hidden="true" />{duration}
            </span>
          ) : null}
        </span>
      </Tooltip>
    </div>
  )
}

function formatDuration(value: number) {
  return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(1)} s`
}

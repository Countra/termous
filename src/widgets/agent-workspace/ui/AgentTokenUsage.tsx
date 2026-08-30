import { ChartNoAxesColumnIncreasing, RefreshCw } from 'lucide-react'
import { Button, Skeleton } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentWorkspaceUsageState } from '../model/types.ts'
import { AgentCacheUsagePopover } from './AgentCacheUsagePopover.tsx'
import { formatAgentTokenCount } from './agentTokenUsageFormat.ts'
import styles from './AgentInspector.module.scss'

export function AgentTokenUsage({
  usage,
  onRetry,
}: {
  usage: AgentWorkspaceUsageState
  onRetry: () => void
}) {
  const { t, i18n } = useTranslation()
  const hasRuns = usage.run_count > 0
  const hasReportedTokens = hasRuns && usage.total_tokens > 0

  return (
    <section
      className={styles['inspector-section']}
      aria-label={t('agent.inspector.tokenUsage')}
      aria-busy={usage.phase === 'loading'}
    >
      <header>
        <ChartNoAxesColumnIncreasing size={15} aria-hidden="true" />
        <h3>{t('agent.inspector.tokenUsage')}</h3>
        {hasRuns ? <span>{t('agent.inspector.runCount', { count: usage.run_count })}</span> : null}
      </header>
      {usage.phase === 'unavailable' ? (
        <p className={styles['inspector-empty']}>{t('agent.inspector.usageUnavailable')}</p>
      ) : usage.phase === 'loading' && !usage.has_snapshot ? (
        <Skeleton className={styles['usage-skeleton']} active title={false} paragraph={{ rows: 3 }} />
      ) : usage.has_snapshot && hasReportedTokens ? (
        <UsageSnapshot usage={usage} language={i18n.resolvedLanguage} />
      ) : usage.has_snapshot && hasRuns ? (
        <div className={styles['usage-unreported']}>
          <strong>{t('agent.inspector.usageNotReported')}</strong>
          <span>{t('agent.inspector.usageNotReportedHint')}</span>
        </div>
      ) : usage.phase !== 'error' ? (
        <p className={styles['inspector-empty']}>{t('agent.inspector.usageEmpty')}</p>
      ) : null}
      {usage.phase === 'error' ? (
        <div className={styles['usage-error']} role="status">
          <span>{t('agent.inspector.usageLoadFailed')}</span>
          <Button
            type="text"
            size="small"
            icon={<RefreshCw size={13} aria-hidden="true" />}
            onClick={onRetry}
          >{t('app.retry')}</Button>
        </div>
      ) : null}
    </section>
  )
}

function UsageSnapshot({
  usage,
  language,
}: {
  usage: AgentWorkspaceUsageState
  language?: string
}) {
  const { t } = useTranslation()
  return (
    <div className={styles['usage-snapshot']}>
      <div className={styles['usage-total']}>
        <span>{t('agent.inspector.sessionTotal')}</span>
        <strong>{formatAgentTokenCount(usage.total_tokens, language)}</strong>
        {usage.estimated ? <em>{t('agent.inspector.partialUsage')}</em> : null}
      </div>
      <dl className={styles['usage-breakdown']}>
        <div>
          <dt>{t('agent.inspector.inputTokens')}</dt>
          <dd>{formatAgentTokenCount(usage.input_tokens, language)}</dd>
        </div>
        <div>
          <dt>{t('agent.inspector.outputTokens')}</dt>
          <dd>{formatAgentTokenCount(usage.output_tokens, language)}</dd>
        </div>
        <div>
          <dt className={styles['usage-metric-label']}>
            <span>{t('agent.inspector.cacheTokens')}</span>
            <AgentCacheUsagePopover
              cacheReadTokens={usage.cache_read_tokens}
              cacheWriteTokens={usage.cache_write_tokens}
              language={language}
              placement="left"
            />
          </dt>
          <dd>{formatAgentTokenCount(usage.cache_read_tokens, language)}</dd>
        </div>
      </dl>
    </div>
  )
}

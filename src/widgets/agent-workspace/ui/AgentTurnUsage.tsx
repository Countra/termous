import { ChartNoAxesColumnIncreasing } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentUsage } from '#entities/agent'
import { AgentCacheUsagePopover } from './AgentCacheUsagePopover.tsx'
import { formatAgentTokenCount } from './agentTokenUsageFormat.ts'
import styles from './AgentTurnUsage.module.scss'

export function AgentTurnUsage({ usage }: { usage: AgentUsage }) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage
  return (
    <footer className={styles.root} aria-label={t('agent.message.turnUsage')}>
      <span className={styles.heading}>
        <ChartNoAxesColumnIncreasing size={12} strokeWidth={1.7} aria-hidden="true" />
        <span>{t('agent.message.turnUsage')}</span>
        {usage.estimated ? <em>{t('agent.inspector.partialUsage')}</em> : null}
      </span>
      <dl className={styles.metrics}>
        <div className={styles.total}>
          <dt>{t('agent.message.turnTotal')}</dt>
          <dd>{formatAgentTokenCount(usage.total_tokens, language)}</dd>
        </div>
        <div>
          <dt>{t('agent.inspector.inputTokens')}</dt>
          <dd>{formatAgentTokenCount(usage.input_tokens, language)}</dd>
        </div>
        <div>
          <dt>{t('agent.inspector.outputTokens')}</dt>
          <dd>{formatAgentTokenCount(usage.output_tokens, language)}</dd>
        </div>
        <div>
          <dt className={styles['cache-label']}>
            <span>{t('agent.inspector.cacheTokens')}</span>
            <AgentCacheUsagePopover
              cacheReadTokens={usage.cache_read_tokens}
              cacheWriteTokens={usage.cache_write_tokens}
              language={language}
            />
          </dt>
          <dd>{formatAgentTokenCount(usage.cache_read_tokens, language)}</dd>
        </div>
      </dl>
    </footer>
  )
}

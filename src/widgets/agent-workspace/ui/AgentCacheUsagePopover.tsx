import { Info } from 'lucide-react'
import { Popover, type PopoverProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatAgentTokenCount } from './agentTokenUsageFormat.ts'
import styles from './AgentCacheUsagePopover.module.scss'

export function AgentCacheUsagePopover({
  cacheReadTokens,
  cacheWriteTokens,
  language,
  placement = 'top',
}: {
  cacheReadTokens: number
  cacheWriteTokens: number
  language?: string
  placement?: PopoverProps['placement']
}) {
  const { t } = useTranslation()
  return (
    <Popover
      trigger={['hover', 'focus']}
      placement={placement}
      arrow={false}
      content={(
        <div
          className={styles.details}
          role="group"
          aria-label={t('agent.inspector.cacheDetailsTitle')}
        >
          <strong>{t('agent.inspector.cacheDetailsTitle')}</strong>
          <dl>
            <div>
              <dt>{t('agent.inspector.cacheWriteTokens')}</dt>
              <dd>{formatAgentTokenCount(cacheWriteTokens, language)}</dd>
            </div>
            <div>
              <dt>{t('agent.inspector.cacheReadTokens')}</dt>
              <dd>{formatAgentTokenCount(cacheReadTokens, language)}</dd>
            </div>
          </dl>
        </div>
      )}
      classNames={{ root: styles.popover }}
      getPopupContainer={() => document.body}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label={t('agent.inspector.cacheDetails')}
      >
        <Info size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </Popover>
  )
}

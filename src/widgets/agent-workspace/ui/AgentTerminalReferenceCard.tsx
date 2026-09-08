import { Button, Tooltip } from 'antd'
import { RefreshCw, Terminal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentTerminalReferenceOrigin } from '#entities/agent'
import styles from './AgentTerminalReferenceCard.module.scss'

export function AgentTerminalReferenceCard({ origin, onPreview, onRemove, onRetry, status, disabled = false, listItem = false }: {
  origin: AgentTerminalReferenceOrigin
  onPreview: () => void
  onRemove?: () => void
  onRetry?: () => void
  status?: string
  disabled?: boolean
  listItem?: boolean
}) {
  const { t } = useTranslation()
  const title = t('agent.attachments.terminalReference', { host: origin.host_name })
  return (
    <div className={styles.card} role={listItem ? 'listitem' : 'group'} aria-label={title}>
      <button type="button" className={styles.preview} onClick={onPreview} disabled={disabled}
        aria-label={t('agent.attachments.previewName', { name: title })}>
        <Terminal size={16} aria-hidden="true" />
        <span className={styles.copy}>
          <strong title={title}>{title}</strong>
          <small>{status ?? t('agent.attachments.terminalReferenceLines', { count: origin.line_count })}</small>
        </span>
      </button>
      {onRetry ? <Tooltip title={t('app.retry')}>
        <Button type="text" size="small" disabled={disabled} icon={<RefreshCw size={13} />} onClick={onRetry}
          aria-label={t('agent.attachments.retryName', { name: title })} />
      </Tooltip> : null}
      {onRemove ? <Tooltip title={t('app.remove')}>
        <Button type="text" size="small" disabled={disabled} icon={<X size={13} />} onClick={onRemove}
          aria-label={t('agent.attachments.removeName', { name: title })} />
      </Tooltip> : null}
    </div>
  )
}

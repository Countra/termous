import { Tooltip } from 'antd'
import { ChevronRight, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { maxAgentMessageRequestUsage } from '#common/contracts'
import type { AgentRequestUsage } from '#entities/agent'
import { uiStyles } from '#shared/ui'
import { formatAgentTokenCount } from './agentTokenUsageFormat.ts'
import styles from './AgentRequestUsageDetails.module.scss'

export function AgentRequestUsageDetails({ requests }: { requests: AgentRequestUsage[] }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const key = 'settings.agent.requestMetrics'
  const language = i18n.resolvedLanguage
  return <details className={styles.root} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className={styles.summary}>
      <ChevronRight className={styles.chevron} size={12} aria-hidden="true" />
      <span>{t(`${key}.title`)}</span>
      <span className={styles.count}>{formatAgentTokenCount(requests.length, language)}</span>
    </summary>
    {open && <div className={styles.body}>
      <div className={styles.scroll}>
        <table aria-label={t(`${key}.title`)}>
          <thead><tr>{['request', 'tools', 'schema', 'images', 'tokens', 'duration', 'status'].map((name) => <th key={name} scope="col">{t(`${key}.${name}`)}</th>)}</tr></thead>
          <tbody>{requests.map((request) => <tr key={request.request_index}>
            <td><span className={styles.index}>{request.request_index}</span>{t(`${key}.${request.purpose}`)}</td>
            <td>{request.tool_count}</td>
            <td title={`${request.schema_bytes} bytes`}>≈ {formatAgentTokenCount(request.schema_tokens_estimate, language)}</td>
            <td title={request.images.map(({ width, height }) => `${width}×${height}`).join(', ')}>{request.images.length}</td>
            <td>{request.usage.estimated ? '≈ ' : ''}{formatAgentTokenCount(request.usage.total_tokens, language)}</td>
            <td>{(request.duration_ms / 1000).toFixed(1)} s</td>
            <td className={styles.status} data-outcome={request.outcome} title={request.error_code}>{t(`${key}.${request.outcome}`)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <Tooltip title={t(`${key}.note`, { limit: maxAgentMessageRequestUsage })} trigger={['hover', 'focus']} classNames={{ root: uiStyles.tooltip }}>
        <button type="button" className={styles.help}><Info size={11} aria-hidden="true" />{t(`${key}.help`)}</button>
      </Tooltip>
    </div>}
  </details>
}

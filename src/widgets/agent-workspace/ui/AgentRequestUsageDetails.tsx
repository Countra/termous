import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { maxAgentMessageRequestUsage } from '#common/contracts'
import type { AgentRequestUsage } from '#entities/agent'
import styles from './AgentRequestUsageDetails.module.scss'

export function AgentRequestUsageDetails({ requests }: { requests: AgentRequestUsage[] }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const key = 'settings.agent.requestMetrics'
  return <details className={styles.root} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t(`${key}.title`)} · {requests.length}</summary>
    {open && <><p>{t(`${key}.note`, { limit: maxAgentMessageRequestUsage })}</p>
    <div className={styles.scroll}>
      <table>
        <thead><tr>{['request', 'tools', 'schema', 'images', 'tokens', 'duration', 'status'].map((name) => <th key={name}>{t(`${key}.${name}`)}</th>)}</tr></thead>
        <tbody>{requests.map((request) => <tr key={request.request_index}>
          <td>{request.request_index} · {t(`${key}.${request.purpose}`)}</td>
          <td>{request.tool_count}</td>
          <td title={`${request.schema_bytes} bytes`}>≈ {request.schema_tokens_estimate.toLocaleString()}</td>
          <td title={request.images.map(({ width, height }) => `${width}×${height}`).join(', ')}>{request.images.length}</td>
          <td>{request.usage.estimated ? '≈ ' : ''}{request.usage.total_tokens.toLocaleString()}</td>
          <td>{(request.duration_ms / 1000).toFixed(1)} s</td>
          <td title={request.error_code}>{t(`${key}.${request.outcome}`)}</td>
        </tr>)}</tbody>
      </table>
    </div></>}
  </details>
}

import { Check, ChevronRight, CircleAlert, Clock3, LoaderCircle, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentWorkspaceToolPart } from '../model/types.ts'
import styles from './AgentToolTimeline.module.scss'

export function AgentToolTimeline({ tool }: { tool: AgentWorkspaceToolPart }) {
  const { t } = useTranslation()
  const StatusIcon = tool.status === 'completed'
    ? Check
    : tool.status === 'failed' || tool.status === 'interrupted'
      ? CircleAlert
      : tool.status === 'waiting_approval'
        ? ShieldAlert
        : LoaderCircle
  return (
    <details className={`${styles['tool-row']} ${styles[`is-${tool.status.replace('_', '-')}`]}`}>
      <summary>
        <span className={styles['tool-disclosure']}><ChevronRight size={13} aria-hidden="true" /></span>
        <span className={styles['tool-status-icon']}><StatusIcon size={14} aria-hidden="true" /></span>
        <strong>{tool.name}</strong>
        <span className={styles['tool-state']}>{t(`agent.tool.status.${tool.status}`)}</span>
        {tool.duration_ms !== undefined ? (
          <span className={styles['tool-duration']}><Clock3 size={12} />{formatDuration(tool.duration_ms)}</span>
        ) : null}
      </summary>
      {tool.summary ? <p>{tool.summary}</p> : null}
      {tool.detail ? <pre>{tool.detail}</pre> : null}
    </details>
  )
}

function formatDuration(value: number) {
  return value < 1_000 ? `${Math.max(0, Math.round(value))} ms` : `${(value / 1_000).toFixed(1)} s`
}

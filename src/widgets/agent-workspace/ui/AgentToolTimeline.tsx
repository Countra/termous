import { Check, ChevronRight, CircleAlert, Clock3, LoaderCircle, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import type { AgentImageLoader, AgentWorkspaceToolPart } from '../model/types.ts'
import { AgentImage } from './AgentImage.tsx'
import styles from './AgentToolTimeline.module.scss'

export function AgentToolTimeline({ tool, onLoadToolImage }: { tool: AgentWorkspaceToolPart; onLoadToolImage?: AgentImageLoader }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const StatusIcon = tool.status === 'completed'
    ? Check
    : tool.status === 'failed' || tool.status === 'interrupted'
      ? CircleAlert
      : tool.status === 'waiting_approval'
        ? ShieldAlert
        : LoaderCircle
  return (
    <div>
      <details className={`${styles['tool-row']} ${styles[`is-${tool.status.replace('_', '-')}`]}`}
        onToggle={(event) => setExpanded(event.currentTarget.open)}>
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
        {expanded && tool.images?.length ? <div className={styles.images} aria-label={t('agent.images.toolResults')}>
          {tool.images.map((image, index) => (
            <AgentImage key={image.id} image={image} onLoad={onLoadToolImage} title={t('agent.images.result', { index: index + 1 })} />
          ))}
        </div> : null}
        {tool.detail ? <pre>{tool.detail}</pre> : null}
      </details>
    </div>
  )
}

function formatDuration(value: number) {
  return value < 1_000 ? `${Math.max(0, Math.round(value))} ms` : `${(value / 1_000).toFixed(1)} s`
}

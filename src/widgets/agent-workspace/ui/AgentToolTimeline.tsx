import { Check, ChevronRight, CircleAlert, Clock3, LoaderCircle, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { memo, useState } from 'react'
import type { AgentImageLoader, AgentWorkspaceToolPart } from '../model/types.ts'
import { AgentImage } from './AgentImage.tsx'
import { DesktopBatchResult } from './tool-results/desktop-batch/DesktopBatchResult.tsx'
import styles from './AgentToolTimeline.module.scss'

export const AgentToolTimeline = memo(function AgentToolTimeline({ tool, onLoadToolImage }: { tool: AgentWorkspaceToolPart; onLoadToolImage?: AgentImageLoader }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState(false)
  const preparingControl = (tool.status === 'running' || tool.status === 'waiting_approval')
    && tool.phase === 'waiting' && !tool.desktop_batch && tool.name.startsWith('termous.desktops.')
  const StatusIcon = tool.status === 'completed'
    ? Check
    : tool.status === 'failed' || tool.status === 'interrupted'
      ? CircleAlert
      : tool.status === 'waiting_approval' || preparingControl
        ? ShieldAlert
        : LoaderCircle
  return (
    <div>
      <details className={`${styles['tool-row']} ${styles[`is-${preparingControl ? 'waiting-approval' : tool.status.replace('_', '-')}`]}`}
        onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>
          <span className={styles['tool-disclosure']}><ChevronRight size={13} aria-hidden="true" /></span>
          <span className={styles['tool-status-icon']}><StatusIcon size={14} aria-hidden="true" /></span>
          <strong title={tool.name}>{preparingControl ? t('agent.tool.controlApproval') : tool.name}</strong>
          <span className={styles['tool-state']}>{t(preparingControl ? 'agent.tool.inputNotDispatched' : tool.status === 'running' && tool.phase ? `agent.tool.phase.${tool.phase}` : `agent.tool.status.${tool.status}`)}</span>
          {tool.duration_ms !== undefined ? (
            <span className={styles['tool-duration']}><Clock3 size={12} />{formatDuration(tool.duration_ms)}</span>
          ) : null}
        </summary>
        {tool.summary ? <p>{tool.summary}</p> : null}
        {tool.cancelDesktop ? <button type="button" disabled={cancelling} onClick={() => {
          setCancelling(true); setCancelError(false)
          void tool.cancelDesktop!().catch(() => { setCancelError(true); setCancelling(false) })
        }}>{t('app.cancel')}</button> : null}
        {cancelError ? <p role="alert">{t('agent.tool.batch.cancelFailed')}</p> : null}
        {expanded && tool.desktop_batch ? <DesktopBatchResult receipt={tool.desktop_batch} /> : null}
        {expanded && tool.images?.length ? <div className={styles.images} aria-label={t('agent.images.toolResults')}>
          {tool.images.map((image, index) => (
            <AgentImage key={image.id} image={image} onLoad={onLoadToolImage} title={t('agent.images.result', { index: index + 1 })} />
          ))}
        </div> : null}
        {expanded && tool.detail ? <pre>{tool.detail}</pre> : null}
      </details>
    </div>
  )
})

function formatDuration(value: number) {
  return value < 1_000 ? `${Math.max(0, Math.round(value))} ms` : `${(value / 1_000).toFixed(1)} s`
}

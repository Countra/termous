import { Check, ChevronRight, CircleAlert, Clock3, LoaderCircle, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { memo, useState } from 'react'
import { Button } from 'antd'
import type { AgentImageLoader, AgentWorkspaceToolPart } from '../model/types.ts'
import { AgentImage } from './AgentImage.tsx'
import { DesktopBatchResult } from './tool-results/desktop-batch/DesktopBatchResult.tsx'
import { LocalFileResult } from './tool-results/local-file/LocalFileResult.tsx'
import { WebSearchResult } from './tool-results/web-search/WebSearchResult.tsx'
import { RuntimeWaitStatus } from './tool-results/RuntimeWaitStatus.tsx'
import styles from './AgentToolTimeline.module.scss'

export const AgentToolTimeline = memo(function AgentToolTimeline({ tool, onLoadToolImage, onLoadFileReview }: { tool: AgentWorkspaceToolPart; onLoadToolImage?: AgentImageLoader; onLoadFileReview?: import('#shared/file-review').FileHistoryLoader }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState(false)
  const [rawDetails, setRawDetails] = useState(false)
  const preparingControl = (tool.status === 'running' || tool.status === 'waiting_approval')
    && tool.phase === 'waiting' && !tool.desktop_batch && tool.name.startsWith('termous.desktops.')
  const fileTitle = tool.local_file
    ? `${t(tool.local_file.action === 'read' ? 'localTools.readFile' : tool.local_file.created ? 'localTools.createFile' : 'localTools.changeFile')} · ${tool.local_file.path.split(/[\\/]/u).pop()}`
    : undefined
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
          <strong title={tool.name}>{tool.runtime_wait ? t('localTools.waitTitle', { seconds: tool.runtime_wait.seconds }) : fileTitle ?? (preparingControl ? t('agent.tool.controlApproval') : tool.name)}</strong>
          <span className={styles['tool-state']}>{tool.runtime_wait && (tool.runtime_wait.wakeReason || tool.status === 'running')
            ? <RuntimeWaitStatus wait={tool.runtime_wait} running={tool.status === 'running'} />
            : t(preparingControl ? 'agent.tool.inputNotDispatched' : tool.status === 'running' && tool.phase ? `agent.tool.phase.${tool.phase}` : `agent.tool.status.${tool.status}`)}</span>
          {tool.duration_ms !== undefined ? (
            <span className={styles['tool-duration']}><Clock3 size={12} />{formatDuration(tool.duration_ms)}</span>
          ) : null}
        </summary>
        {tool.summary ? <p>{tool.summary}</p> : null}
        {expanded && tool.runtime_wait?.reason ? <p>{tool.runtime_wait.reason}</p> : null}
        {tool.cancelDesktop ? <button type="button" disabled={cancelling} onClick={() => {
          setCancelling(true); setCancelError(false)
          void tool.cancelDesktop!().catch(() => { setCancelError(true) }).finally(() => { setCancelling(false) })
        }}>{t('app.cancel')}</button> : null}
        {cancelError && tool.status === 'running' ? <p role="alert">{t('agent.tool.batch.cancelFailed')}</p> : null}
        {expanded && tool.desktop_batch ? <DesktopBatchResult receipt={tool.desktop_batch} /> : null}
        {expanded && tool.local_file ? <LocalFileResult file={tool.local_file} onLoadFileReview={onLoadFileReview} /> : null}
        {expanded && tool.web_search ? <WebSearchResult result={tool.web_search} /> : null}
        {expanded && tool.images?.length ? <div className={styles.images} aria-label={t('agent.images.toolResults')}>
          {tool.images.map((image, index) => (
            <AgentImage key={image.id} image={image} onLoad={onLoadToolImage} title={t('agent.images.result', { index: index + 1 })} />
          ))}
        </div> : null}
        {expanded && (tool.local_file || tool.web_search) && tool.detail ? <Button className={styles['raw-details']} type="text" size="small"
          icon={<ChevronRight size={13} aria-hidden />}
          onClick={() => setRawDetails(value => !value)} aria-expanded={rawDetails}>{t('localTools.rawDetails')}</Button> : null}
        {expanded && tool.detail && (!(tool.local_file || tool.web_search) || rawDetails) ? <pre>{tool.detail}</pre> : null}
      </details>
    </div>
  )
})

function formatDuration(value: number) {
  return value < 1_000 ? `${Math.max(0, Math.round(value))} ms` : `${(value / 1_000).toFixed(1)} s`
}

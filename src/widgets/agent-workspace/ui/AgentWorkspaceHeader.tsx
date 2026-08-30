import {
  CornerUpLeft,
  PanelLeftOpen,
  PanelRightOpen,
  Square,
} from 'lucide-react'
import { Button, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type {
  AgentWorkspaceProps,
  AgentWorkspaceRunStatus,
  AgentWorkspaceSession,
} from '../model/types.ts'
import styles from './AgentWorkspace.module.scss'

export function AgentWorkspaceHeader({
  selectedSession,
  runStatus,
  activeRunElsewhere,
  busy,
  sessionsOverlay,
  inspectorOpen,
  onOpenSessions,
  onToggleInspector,
  onReturnToActiveRun,
  onStop,
}: {
  selectedSession?: AgentWorkspaceSession
  runStatus: AgentWorkspaceRunStatus
  activeRunElsewhere?: AgentWorkspaceProps['active_run']
  busy: boolean
  sessionsOverlay: boolean
  inspectorOpen: boolean
  onOpenSessions: () => void
  onToggleInspector: () => void
  onReturnToActiveRun: () => void
  onStop: () => void
}) {
  const { t } = useTranslation()
  const showStatus = shouldShowRunStatus(runStatus)

  return (
    <header className={styles.header}>
      <div className={styles['header-title']}>
        {sessionsOverlay ? (
          <Tooltip title={t('agent.sessions.title')}>
            <Button
              type="text"
              className={styles['header-icon-button']}
              aria-label={t('agent.sessions.title')}
              icon={<PanelLeftOpen size={17} />}
              onClick={onOpenSessions}
            />
          </Tooltip>
        ) : null}
        <div className={styles['header-heading']}>
          <strong>{selectedSession?.title ?? t('agent.sessions.new')}</strong>
          {showStatus ? (
            <span className={styles['header-meta']}>
              <RunStatus status={runStatus} />
            </span>
          ) : null}
        </div>
      </div>
      <div className={styles['header-controls']}>
        {activeRunElsewhere ? (
          <div className={styles['active-run-actions']}>
            <Tooltip title={t('agent.header.returnToActiveRun')}>
              <Button
                type="text"
                size="small"
                aria-label={t('agent.header.returnToActiveRun')}
                icon={<CornerUpLeft size={14} />}
                onClick={onReturnToActiveRun}
              >
                <span className={styles['active-run-label']}>{t('agent.header.returnToActiveRun')}</span>
              </Button>
            </Tooltip>
            <Tooltip title={t('agent.composer.stop')}>
              <Button
                type="text"
                size="small"
                danger
                aria-label={t('agent.composer.stop')}
                icon={<Square size={11} fill="currentColor" />}
                disabled={busy || activeRunElsewhere.status === 'stopping'}
                onClick={onStop}
              />
            </Tooltip>
          </div>
        ) : null}
        {!inspectorOpen ? (
          <Tooltip title={t('agent.inspector.title')}>
            <Button
              type="text"
              className={styles['header-icon-button']}
              aria-label={t('agent.inspector.title')}
              icon={<PanelRightOpen size={17} />}
              onClick={onToggleInspector}
            />
          </Tooltip>
        ) : null}
      </div>
    </header>
  )
}

function RunStatus({ status }: { status: AgentWorkspaceRunStatus }) {
  const { t } = useTranslation()
  return (
    <span className={styles['run-status']} data-status={status.replace('_', '-')} aria-live="polite">
      <i aria-hidden="true" />
      {t(`agent.status.${status}`)}
    </span>
  )
}

function shouldShowRunStatus(status: AgentWorkspaceRunStatus) {
  return status === 'queued'
    || status === 'starting'
    || status === 'running'
    || status === 'waiting_approval'
    || status === 'stopping'
    || status === 'failed'
    || status === 'interrupted'
}

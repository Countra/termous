import { Alert, Button } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentWorkspace, AgentArchiveManager } from '#widgets/agent-workspace'
import type { AgentSurfaceModel } from '../model/surface/agentSurfaceModel.ts'
import { AgentReadinessSurface } from './AgentReadinessSurface.tsx'
import { AgentTerminalReferenceImportNotice } from './AgentTerminalReferenceImportNotice.tsx'
import styles from './AgentPage.module.scss'
import windowStyles from './AgentWindow.module.scss'
import type { AgentPresentation } from '../model/surface/agentPresentation.ts'

export function AgentSurfaceView({ model, windowAction, presentation, onRevealApprovals, interactive = true }: {
  model: AgentSurfaceModel; windowAction?: ReactNode; presentation?: AgentPresentation; onRevealApprovals?: () => void; interactive?: boolean
}) {
  const { t } = useTranslation()
  return <div className={styles.page}>
    {!model.workspace && windowAction && <div className={windowStyles['readiness-toolbar']}>{windowAction}</div>}
    {onRevealApprovals && model.workspace?.active_run?.status === 'waiting_approval' && <Alert className={windowStyles.approval} type="info"
      title={t('agent.window.approvalWaiting')} action={<Button size="small" onClick={onRevealApprovals}>{t('agent.window.approval')}</Button>} />}
    {model.reference && <AgentTerminalReferenceImportNotice {...model.reference} />}
    {model.readiness && <AgentReadinessSurface {...model.readiness} />}
    {model.warning && <Alert className={styles.alert} type="warning" showIcon
      title={t(model.warning === 'reconnecting' ? 'agent.error.reconnecting' : 'agent.error.degraded')}
      description={t(model.warning === 'reconnecting' ? 'agent.error.reconnectingDescription' : 'agent.error.degradedDescription')}
      action={<button type="button" onClick={model.onRetry}>{t('app.retry')}</button>} />}
    {model.workspace && <AgentWorkspace {...model.workspace} composerActive={interactive && model.workspace.composerActive}
      windowAction={windowAction} presentation={presentation} />}
    {model.archive && <AgentArchiveManager {...model.archive} />}
  </div>
}

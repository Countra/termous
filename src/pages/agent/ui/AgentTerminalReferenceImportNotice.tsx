import { Alert, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentSSHResourceState } from '#entities/agent'
import type { AgentTerminalReferenceImportJob } from '#features/agent-runtime'
import { AgentTerminalReferenceConfirmDialog } from './AgentTerminalReferenceConfirmDialog'
import styles from './AgentTerminalReferenceImportNotice.module.scss'

export function AgentTerminalReferenceImportNotice({ job, resources, onConfirm, onRetry, onDismiss, onOpenSettings }: {
  job?: AgentTerminalReferenceImportJob
  resources: AgentSSHResourceState[]
  onConfirm: () => void
  onRetry: () => void
  onDismiss: () => void
  onOpenSettings?: () => void
}) {
  const { t } = useTranslation()
  if (!job) return null
  const binding = job.confirmation?.resource_binding
  const source = job.request.source_resource
  if (job.stage === 'confirm') return (
    <AgentTerminalReferenceConfirmDialog binding={binding} source={source} resources={resources}
      onConfirm={onConfirm} onCancel={onDismiss} />
  )
  const failed = job.stage === 'failed'
  const configuration = job.stage === 'configuration'
  return (
    <div className={styles.notice} role="status" aria-live="polite">
      <Alert type={failed ? 'warning' : 'info'} showIcon
        title={t(`agent.terminalReference.${failed ? 'failed' : configuration ? 'configuration' : 'pending'}`)}
        description={failed ? t(`agent.terminalReference.errors.${job.errorCode}`, {
          defaultValue: t('agent.terminalReference.errors.unknown'),
        }) : t('agent.terminalReference.retained', { host: source.host_name })}
        action={(
          <div className={styles.actions}>
            {failed ? <Button size="small" onClick={onRetry}>{t('app.retry')}</Button> : null}
            {configuration && onOpenSettings ? <Button size="small" onClick={onOpenSettings}>{t('agent.terminalReference.openSettings')}</Button> : null}
            {job.stage !== 'importing' ? <Button size="small" type="text" onClick={onDismiss}>{t('app.cancel')}</Button> : null}
          </div>
        )} />
    </div>
  )
}

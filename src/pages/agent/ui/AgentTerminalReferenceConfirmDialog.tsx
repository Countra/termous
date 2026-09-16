import { Button, Modal, Tooltip } from 'antd'
import { ArrowRightLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { resourceBindingMatchesSource, resourceReference, resourceReferenceId, resourceProfileName, type AgentResourceBinding, type AgentResourceState } from '#entities/agent'
import { confirmDialogStyles, uiStyles } from '#shared/ui'
import styles from './AgentTerminalReferenceConfirmDialog.module.scss'

export function AgentTerminalReferenceConfirmDialog({ binding, source, resources, connectionOnly = false, onConfirm, onCancel }: {
  binding?: AgentResourceBinding
  source: AgentResourceState
  resources: AgentResourceState[]
  connectionOnly?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const original = resources.find((resource) => resourceBindingMatchesSource(binding, resource))
  const file = resourceReference(source).kind === 'file_profile'

  return (
    <Modal open centered width={440} zIndex={3600} footer={null} closable={false}
      title={(
        <header className={styles.header}>
          <ArrowRightLeft className={styles.icon} size={18} aria-hidden="true" />
          <h2>{t(file ? 'agent.fileResource.confirmTitle' : 'agent.terminalReference.confirmTitle')}</h2>
        </header>
      )}
      destroyOnHidden onCancel={onCancel} getContainer={() => document.body}
      className={`${confirmDialogStyles.modal} ${styles.modal} confirm-modal`}
      wrapClassName={`${confirmDialogStyles['modal-wrap']} confirm-modal-wrap`}
      rootClassName={`${confirmDialogStyles['modal-root']} termous-modal-root`}>
      <section className={styles.content}>
        <div className={styles.comparison}>
          <ConnectionSummary label={t('agent.terminalReference.currentAssociation')}
            host={binding?.host_name || t('agent.terminalReference.unknownHost')}
            profile={(original && resourceProfileName(original)) || (binding?.kind === 'file_profile' && binding.file_access_profile_name) || t('agent.terminalReference.profileUnavailable')}
            profileId={binding?.kind === 'file_profile' ? binding.file_access_profile_id : binding?.ssh_profile_id}
            sessionId={binding?.kind === 'ssh_session' ? binding.session_id : undefined} />
          <ConnectionSummary destination label={t('agent.terminalReference.nextAssociation')}
            host={source.host_name || t('agent.terminalReference.unknownHost')} profile={resourceProfileName(source) || t('agent.terminalReference.profileUnavailable')}
            profileId={file ? resourceReferenceId(resourceReference(source)) : source.ssh_profile_id}
            sessionId={'session_id' in source ? source.session_id : undefined} />
        </div>
        <p className={styles.description}>{t(file ? 'agent.fileResource.confirmDescription'
          : connectionOnly ? 'agent.connectionReference.confirmDescription' : 'agent.terminalReference.confirmDescription')}</p>
        <footer className={styles.actions}>
          <Button autoFocus onClick={onCancel}>{t('app.cancel')}</Button>
          <Button type="primary" onClick={onConfirm}>{t(connectionOnly ? 'agent.connectionReference.confirmReplace' : 'agent.terminalReference.confirmReplace')}</Button>
        </footer>
      </section>
    </Modal>
  )
}

function ConnectionSummary({ label, host, profile, profileId, sessionId, destination = false }: {
  label: string
  host: string
  profile: string
  profileId?: string
  sessionId?: string
  destination?: boolean
}) {
  const { t } = useTranslation()
  const details = (
    <div className={styles.details}>
      <strong>{host}</strong>
      <span>{profile}</span>
      {profileId ? <span>{t('agent.terminalReference.profileIdentifier')}<code>{profileId}</code></span> : null}
      {sessionId ? <span>{t('agent.terminalReference.sessionIdentifier')}<code>{sessionId}</code></span> : null}
    </div>
  )
  return (
    <Tooltip title={details} trigger={['hover', 'focus']} placement="top" arrow={false} zIndex={3700}
      classNames={{ root: `${uiStyles.tooltip} termous-tooltip ${styles.tooltip}` }}>
      <div className={`${styles.connection} ${destination ? styles.destination : ''}`} tabIndex={0}
        role="group" aria-label={`${label} · ${host} · ${profile} · ${sessionId ?? ''}`}>
        <span className={styles.label}>{label}</span>
        <div className={styles.names}>
          <strong>{host}</strong>
          <div className={styles.metadata}>
            <span>{profile}</span>
            {sessionId ? <code className={styles.identifier}>#{sessionId.length > 12 ? `…${sessionId.slice(-12)}` : sessionId}</code> : null}
          </div>
        </div>
      </div>
    </Tooltip>
  )
}

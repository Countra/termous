import { Button } from 'antd'
import { CircleAlert, Clock3, RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConnectionActionButton, uiStyles } from '#shared/ui'
import {
  agentResourceBindingKey, getAgentResourceBinding, isAgentResourceRecoveryActive,
  type AgentResourceRecoveryState, type AgentSSHResourceBinding,
} from '#entities/agent'
import styles from './AgentResourceBindingControl.module.scss'

export function AgentResourceRecoveryActions({ binding, state, disabled, connectionReady, onRecover, onCancel }: {
  binding: AgentSSHResourceBinding
  state?: AgentResourceRecoveryState
  disabled: boolean
  connectionReady: boolean
  onRecover: () => Promise<boolean>
  onCancel: () => Promise<boolean>
}) {
  const { t } = useTranslation()
  const operation = state?.view?.operation
  const matches = operation && (agentResourceBindingKey(operation.source_binding) === agentResourceBindingKey(binding)
    || operation.status === 'succeeded' && agentResourceBindingKey(getAgentResourceBinding(operation.result_session?.resource_bindings, 'ssh_session')) === agentResourceBindingKey(binding))
  const current = matches ? operation : undefined
  const running = isAgentResourceRecoveryActive(current)
  const reason = state?.view?.blocked_reason
  const checking = !state || state.checking && !state.view
  const canRecover = !disabled && !state?.submitting && !checking && (state?.view?.can_recover === true || state?.uncertain || Boolean(state?.error_code))
  const operationFailed = Boolean(current?.error_code || current?.status === 'failed')
  const showError = Boolean(state?.error_code || operationFailed)
  const blocked = reason && reason !== 'ready' && reason !== 'recovering'
  const successOutdated = current?.status === 'succeeded' && !connectionReady
  const StatusIcon = showError ? CircleAlert : running || checking || state?.uncertain ? Clock3 : RotateCcw
  if (connectionReady && !running && !state?.uncertain && !operationFailed) return null
  if (reason === 'ready' && !current && !state?.uncertain) return null
  return <div className={styles.recovery} aria-label={t('agent.resource.recovery.details')}
    data-recovery-tone={showError ? 'error' : 'default'}>
    <div className={styles['recovery-heading']}>
      <div className={styles['recovery-label']}>
        <StatusIcon className={styles['recovery-icon']} size={15} aria-hidden="true" />
        <strong>{t('agent.resource.recovery.title')}</strong>
      </div>
      {running ? (
        <Button size="small" className={`${uiStyles['secondary-button']} ${styles['action-button']}`} icon={<X size={13} />} loading={state?.submitting}
          disabled={disabled || state?.submitting || current?.status === 'cancelling'}
          onClick={() => { void onCancel() }}>
          {t('agent.resource.recovery.cancel')}
        </Button>
      ) : reason !== 'ready' ? (
        <ConnectionActionButton size="small" className={styles['action-button']} icon={<RotateCcw size={13} />} loading={state?.submitting}
          disabled={!canRecover} onClick={() => { void onRecover() }}>
          {showError || state?.uncertain ? t('agent.resource.recovery.retry') : t('agent.resource.recovery.recover')}
        </ConnectionActionButton>
      ) : null}
    </div>
    <p className={styles['recovery-hint']} role="status">
      {state?.uncertain ? t('agent.resource.recovery.uncertain')
        : showError ? current?.message || t('agent.resource.recovery.failed')
        : checking || successOutdated && reason === 'ready' ? t('agent.resource.recovery.checking')
        : blocked ? t(`agent.resource.recovery.blocked.${reason}`)
        : current && !successOutdated ? t(`agent.resource.recovery.status.${current.status}`)
        : t('agent.resource.recovery.description')}
    </p>
  </div>
}

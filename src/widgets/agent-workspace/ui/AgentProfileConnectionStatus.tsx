import { Button } from 'antd'
import { CircleAlert, Clock3, RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isAgentResourceConnectionActive } from '#entities/agent'
import { ConnectionActionButton, uiStyles } from '#shared/ui'
import type { AgentWorkspaceProfileConnectionState } from '../model/types.ts'
import styles from './AgentProfileConnectionStatus.module.scss'

const localizedConnectionErrorCodes = new Set([
  'AGENT_RESOURCE_CONNECTION_QUERY_FAILED',
  'AGENT_RESOURCE_CONNECTION_FAILED',
  'AGENT_RESOURCE_CONNECTION_CANCEL_FAILED',
  'AGENT_RESOURCE_CONNECTION_CONFLICT',
  'AGENT_RESOURCE_CONNECTION_TIMEOUT',
  'AGENT_REVISION_CONFLICT',
  'AGENT_RUN_CONFLICT',
  'AGENT_NOT_READY',
  'AGENT_RESOURCE_BINDING_UNAVAILABLE',
  'SSH_CONNECT_FAILED',
  'SSH_AUTH_FAILED',
  'HOST_KEY_UNKNOWN',
  'HOST_KEY_CHANGED',
  'JUMP_HOST_FAILED',
  'NETWORK_ERROR',
  'REQUEST_TIMEOUT',
  'REQUEST_ABORTED',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'INTERNAL_ERROR',
])

export function AgentProfileConnectionStatus({
  state,
  onRetry,
  onCancel,
  onDismiss,
}: {
  state?: AgentWorkspaceProfileConnectionState
  onRetry?: () => Promise<boolean>
  onCancel?: () => Promise<boolean>
  onDismiss?: () => void
}) {
  const { t } = useTranslation()
  const operation = state?.operation
  const active = isAgentResourceConnectionActive(operation)
  const uncertain = Boolean(state?.uncertain)
  const failed = Boolean(
    !uncertain && (state?.error_code
    || operation?.status === 'failed'
    || operation?.error_code),
  )
  const pending = Boolean(state?.submitting || state?.reconciling)
  const reconciling = Boolean(state?.reconciling)
  if (!active && !failed && !uncertain && !pending && !reconciling) return null
  const errorCode = state?.error_code ?? operation?.error_code
  const localizedError = errorCode && localizedConnectionErrorCodes.has(errorCode)
    ? t(`agent.slash.connection.error.${errorCode}`)
    : undefined
  const retryable = Boolean(onRetry && !active && (uncertain || operation?.retryable === true))
  const title = operation?.target
    ? t('agent.slash.connection.target', {
        host: operation.target.host_name,
        profile: operation.target.profile_name,
      })
    : t('agent.slash.connection.title')
  const message = uncertain
    ? t('agent.slash.connection.uncertain')
    : failed
      ? localizedError ?? operation?.message ?? t('agent.slash.connection.failed')
      : reconciling
        ? t('agent.slash.connection.status.succeeded')
        : operation
        ? t(`agent.slash.connection.status.${operation.status}`)
        : t('agent.slash.connection.status.connecting')
  return (
    <div className={styles.connection} data-tone={failed ? 'error' : 'default'}>
      <div className={styles.heading}>
        <span className={styles.label}>
          {failed
            ? <CircleAlert size={14} aria-hidden="true" />
            : <Clock3 size={14} aria-hidden="true" />}
          <strong title={title}>{title}</strong>
        </span>
        <span className={styles.actions}>
          {active ? (
            <Button
              size="small"
              className={uiStyles['secondary-button']}
              icon={<X size={12} />}
              loading={state?.submitting}
              disabled={!onCancel || state?.submitting || operation?.status === 'cancelling'}
              onClick={() => { void onCancel?.() }}
            >
              {t('agent.slash.connection.cancel')}
            </Button>
          ) : null}
          {retryable || failed && !active ? (
            <>
              {retryable ? (
                <ConnectionActionButton
                  size="small"
                  icon={<RotateCcw size={12} />}
                  loading={state?.submitting}
                  disabled={state?.submitting}
                  onClick={() => { void onRetry?.() }}
                >
                  {t('agent.slash.connection.retry')}
                </ConnectionActionButton>
              ) : null}
              {failed && !active ? (
                <Button
                  type="text"
                  size="small"
                  className={styles.dismiss}
                  icon={<X size={12} />}
                  aria-label={t('agent.slash.connection.dismiss')}
                  disabled={!onDismiss || state?.submitting}
                  onClick={onDismiss}
                />
              ) : null}
            </>
          ) : null}
        </span>
      </div>
      <p role="status">{message}</p>
    </div>
  )
}

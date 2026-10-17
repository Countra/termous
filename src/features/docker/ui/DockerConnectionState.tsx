import { Button, Tooltip } from 'antd'
import { AlertTriangle, ChevronRight, Container, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DockerCapability, DockerCapabilityStatus } from '#entities/docker'
import styles from './DockerConnectionState.module.scss'

const statusKeys: Record<DockerCapabilityStatus, string> = {
  available: 'available',
  missing_cli: 'missingCli',
  daemon_unavailable: 'daemonUnavailable',
  permission_denied: 'permissionDenied',
  unknown: 'unknownStatus',
}

interface DockerUnavailableStateProps {
  capability: DockerCapability | null
  error?: string
  failed: boolean
  loading: boolean
  disabled: boolean
  onRetry: () => void
}

export function DockerUnavailableState({ capability, error, failed, loading, disabled, onRetry }: DockerUnavailableStateProps) {
  const { t } = useTranslation()
  const status = capability && Object.prototype.hasOwnProperty.call(statusKeys, capability.status) ? capability.status : 'unknown'
  const title = t(`workbench.docker.${failed ? 'detectionFailed' : statusKeys[status] ?? 'unknownStatus'}`)
  const hint = t(`workbench.docker.availabilityHints.${failed ? 'failed' : status}`)
  const diagnostic = error || capability?.message
  const notInstalled = !failed && status === 'missing_cli'
  const warning = status === 'permission_denied' || status === 'daemon_unavailable'
  const Icon = failed || warning ? AlertTriangle : Container

  return <section className={[styles.unavailable, notInstalled ? styles['not-installed'] : ''].filter(Boolean).join(' ')} aria-label={title} aria-busy={loading}>
    <span className={[styles.icon, failed ? styles.danger : warning ? styles.warning : ''].filter(Boolean).join(' ')}>
      <Icon size={notInstalled ? 26 : 20} strokeWidth={1.5} aria-hidden="true" />
    </span>
    <div className={styles.copy}>
      <h3>{title}</h3>
      <p>{hint}</p>
      <Button className={styles.retry} size="small" loading={loading} disabled={disabled}
        icon={<RefreshCw size={13} aria-hidden="true" />} onClick={onRetry}>
        {t('workbench.docker.detectAgain')}
      </Button>
      {diagnostic && diagnostic !== title && diagnostic !== hint && <details className={styles.diagnostic}>
        <summary>{t('workbench.docker.detectionDetails')}<ChevronRight size={13} aria-hidden="true" /></summary>
        <pre>{diagnostic}</pre>
      </details>}
    </div>
  </section>
}

interface DockerToolbarProps {
  capability: DockerCapability
  loading: boolean
  disabled: boolean
  onRefresh: () => void
  action?: ReactNode
}

export function DockerToolbar({ capability, loading, disabled, onRefresh, action }: DockerToolbarProps) {
  const { t } = useTranslation()
  const version = capability.server_version || capability.docker_version
  return <header className={styles.toolbar}>
    <div className={styles.connection}>
      <span className={styles.ready} role="img" aria-label={t('workbench.docker.available')} />
      <strong>Docker{version ? ` ${version}` : ''}</strong>
      {capability.context && <span className={styles.context} title={capability.context}>{capability.context}</span>}
    </div>
    <div className={styles.actions}>
      {action}
      <Tooltip title={t('workbench.docker.refresh')}>
        <Button className={styles.refresh} type="text" size="small" loading={loading} disabled={disabled}
          aria-label={t('workbench.docker.refresh')} icon={<RefreshCw size={14} aria-hidden="true" />} onClick={onRefresh} />
      </Tooltip>
    </div>
  </header>
}

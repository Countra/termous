import { Button, Skeleton } from 'antd'
import {
  CircleAlert,
  Clipboard,
  Download,
  LoaderCircle,
  RefreshCw,
  SearchX,
  TerminalSquare,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FileNameSearchCapability } from '#entities/file'
import { WorkspaceEmptyState } from '#shared/ui'
import type { FileNameSearchCapabilityPhase } from '../model/types'
import styles from './GlobalFileSearchCapabilityPane.module.scss'

interface GlobalFileSearchCapabilityPaneProps {
  capability: FileNameSearchCapability | null
  phase: FileNameSearchCapabilityPhase
  error: string
  onRetry: () => void
  onInstall: () => void
  onCopyCommand: () => void
}

export function GlobalFileSearchCapabilityPane({
  capability,
  phase,
  error,
  onRetry,
  onInstall,
  onCopyCommand,
}: GlobalFileSearchCapabilityPaneProps) {
  const { t } = useTranslation()

  if (phase === 'detecting' || (phase === 'idle' && !capability)) {
    return (
      <div className={styles['capability-loading']} role="status" aria-live="polite">
        <span className={styles['capability-loading-title']}>
          <LoaderCircle className={styles.spinner} size={17} aria-hidden="true" />
          {t('files.globalSearch.detecting')}
        </span>
        <Skeleton active title={false} paragraph={{ rows: 4, width: ['92%', '76%', '84%', '58%'] }} />
      </div>
    )
  }

  if (phase === 'installing' || phase === 'verifying') {
    return (
      <div className={styles['install-progress']} role="status" aria-live="polite">
        <span className={styles['install-progress-icon']} aria-hidden="true">
          <LoaderCircle className={styles.spinner} size={22} />
        </span>
        <strong>{t(
          phase === 'installing'
            ? 'files.globalSearch.installing'
            : 'files.globalSearch.verifying',
        )}</strong>
        <span>{t('files.globalSearch.installWait')}</span>
        <ol className={styles['install-steps']}>
          <li className={styles['is-complete']}>{t('files.globalSearch.installStepPrepare')}</li>
          <li className={phase === 'installing' ? styles['is-active'] : styles['is-complete']}>
            {t('files.globalSearch.installStepInstall')}
          </li>
          <li className={phase === 'verifying' ? styles['is-active'] : ''}>
            {t('files.globalSearch.installStepVerify')}
          </li>
        </ol>
      </div>
    )
  }

  if (phase === 'failed') {
    return (
      <div className={styles['capability-shell']} role="alert" aria-live="assertive">
        <WorkspaceEmptyState
          className={styles['capability-empty']}
          icon={<CircleAlert size={24} aria-hidden="true" />}
          title={t('files.globalSearch.detectFailed')}
          description={error || t('app.error')}
          tone="danger"
          action={(
            <Button icon={<RefreshCw size={14} aria-hidden="true" />} onClick={onRetry}>
              {t('app.retry')}
            </Button>
          )}
        />
      </div>
    )
  }

  if (capability?.status === 'unsupported') {
    const copyAvailable = (capability.install_plan?.manual_commands.length ?? 0) > 0
    return (
      <div className={styles['capability-shell']} role="status" aria-live="polite">
        <WorkspaceEmptyState
          className={styles['capability-empty']}
          icon={<SearchX size={24} aria-hidden="true" />}
          title={t('files.globalSearch.unsupported')}
          description={t('files.globalSearch.unsupportedDescription')}
          tone="warning"
          action={(
            <span className={styles['capability-actions']}>
              {copyAvailable ? (
                <Button icon={<Clipboard size={14} aria-hidden="true" />} onClick={onCopyCommand}>
                  {t('files.globalSearch.copyInstallCommand')}
                </Button>
              ) : null}
              <Button icon={<RefreshCw size={14} aria-hidden="true" />} onClick={onRetry}>
                {t('files.globalSearch.recheck')}
              </Button>
            </span>
          )}
        />
      </div>
    )
  }

  const outdated = capability?.status === 'outdated'
  const installAvailable = capability?.install_available === true
    && Boolean(capability.install_plan?.plan_hash)
  const copyAvailable = (capability?.install_plan?.manual_commands.length ?? 0) > 0
  return (
    <div className={styles['capability-missing']} role="status" aria-live="polite">
      <WorkspaceEmptyState
        className={styles['capability-empty']}
        icon={outdated
          ? <CircleAlert size={24} aria-hidden="true" />
          : <Download size={24} aria-hidden="true" />}
        title={t(outdated
          ? 'files.globalSearch.outdated'
          : 'files.globalSearch.missing')}
        description={t(outdated
          ? 'files.globalSearch.outdatedDescription'
          : 'files.globalSearch.missingDescription')}
        tone={outdated ? 'warning' : 'neutral'}
        action={(
          <span className={styles['capability-actions']}>
            {installAvailable ? (
              <Button
                type="primary"
                icon={<Download size={14} aria-hidden="true" />}
                onClick={onInstall}
              >
                {t(outdated
                  ? 'files.globalSearch.upgrade'
                  : 'files.globalSearch.install')}
              </Button>
            ) : null}
            {copyAvailable ? (
              <Button icon={<Clipboard size={14} aria-hidden="true" />} onClick={onCopyCommand}>
                {t('files.globalSearch.copyInstallCommand')}
              </Button>
            ) : null}
            <Button icon={<RefreshCw size={14} aria-hidden="true" />} onClick={onRetry}>
              {t('files.globalSearch.recheck')}
            </Button>
          </span>
        )}
      />
      {capability?.install_plan ? (
        <dl className={styles['capability-facts']}>
          <div>
            <dt><TerminalSquare size={13} aria-hidden="true" />{t('files.globalSearch.distribution')}</dt>
            <dd>{capability.distribution || t('files.globalSearch.unknown')}</dd>
          </div>
          <div>
            <dt>{t('files.globalSearch.packageManager')}</dt>
            <dd>{capability.package_manager || t('files.globalSearch.unknown')}</dd>
          </div>
          <div>
            <dt>{t('files.globalSearch.elevation')}</dt>
            <dd>{capability.install_plan.privilege || capability.privilege || t('files.globalSearch.unknown')}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  )
}

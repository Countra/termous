import { Tooltip } from 'antd'
import { ArrowDown, ArrowDownUp, ArrowUp, Files } from 'lucide-react'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { TransferRuntimeContext } from '#features/transfers'
import { uiStyles } from '#shared/ui'
import { formatBytes, formatRate } from '../../model/connectionQuality'
import { summarizeDesktopTransfers } from '../../model/desktopTransferSummary'
import styles from './DesktopTransferStatus.module.scss'

export function DesktopTransferStatus({ sessionId, open, onOpen }: {
  sessionId: string; open?: boolean; onOpen: () => void
}) {
  const { t } = useTranslation()
  const runtime = useContext(TransferRuntimeContext)
  const summary = summarizeDesktopTransfers(runtime?.transfers ?? [], sessionId)
  const active = summary.count > 0
  const live = runtime?.connected === true
  const progress = live ? summary.progress : null
  const details = <div className={styles.details}>
    <strong>{t('remoteDesktop.files.taskTitle')}</strong>
    {active ? <>
      <span>{t('files.activeTransferCount', { count: summary.count })}{live && progress !== null ? ` · ${progress}%` : ''}</span>
      {!live ? <span>{t('files.transferSyncing')}</span> : <>
        {progress !== null && <span>{formatBytes(summary.transferredBytes)} / {formatBytes(summary.totalBytes)}</span>}
        {summary.uploadCount > 0 && <span>{t('remoteDesktop.files.transferStatus.upload')} · {formatRate(summary.uploadRate)}</span>}
        {summary.downloadCount > 0 && <span>{t('remoteDesktop.files.transferStatus.download')} · {formatRate(summary.downloadRate)}</span>}
        {!summary.runningCount && <span>{t('remoteDesktop.files.transferStatus.queued')}</span>}
      </>}
    </> : <span>{t('remoteDesktop.files.transferStatus.idle')}</span>}
    <small>{t('remoteDesktop.files.transferStatus.open')}</small>
  </div>
  return <Tooltip title={details} placement="topRight" arrow={false} mouseEnterDelay={0.35} classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}>
    <button type="button" className={styles.trigger} data-active={active && live} aria-label={t('remoteDesktop.files.transferStatus.open')}
      aria-haspopup="dialog" aria-expanded={!!open} onClick={onOpen}>
      <Files size={13} strokeWidth={1.8} aria-hidden="true" />
      <span className={styles.label}>{t('remoteDesktop.files.title')}</span>
      {active && <>
        <span className={styles.progress}>{!live ? t('remoteDesktop.files.transferStatus.syncing')
          : !summary.runningCount ? t('remoteDesktop.files.transferStatus.queued')
            : progress === null ? t('remoteDesktop.files.transferStatus.active', { count: summary.count }) : `${progress}%`}</span>
        {live && summary.uploadCount > 0 && <span className={styles.rate}><ArrowUp size={12} aria-label={t('remoteDesktop.files.transferStatus.upload')} />{formatRate(summary.uploadRate)}</span>}
        {live && summary.downloadCount > 0 && <span className={styles.rate}><ArrowDown size={12} aria-label={t('remoteDesktop.files.transferStatus.download')} />{formatRate(summary.downloadRate)}</span>}
        {live && summary.runningCount > 0 && (summary.uploadCount > 0 || summary.downloadCount > 0) && <span className={styles['compact-rate']}>
          <ArrowDownUp size={12} aria-label={t('remoteDesktop.files.transferStatus.totalRate')} />{formatRate(summary.uploadRate + summary.downloadRate)}
        </span>}
      </>}
      {active && live && <span className={styles.track} aria-hidden="true"><span style={{ width: progress === null ? '28%' : `${progress}%` }} /></span>}
    </button>
  </Tooltip>
}

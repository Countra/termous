import { Button, Progress, Tooltip } from 'antd'
import { Copy, DownloadCloud, RotateCcw, UploadCloud, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FileTransferGateway } from '#features/files'
import { useTransferRuntime } from '#features/transfers'
import { formatBytes } from '#shared/format'
import { summarizeWorkbenchTransfers } from '../model/workbenchTransferState'
import styles from './WorkbenchTransferBar.module.scss'

const scopedClassName = (className: string) => `${className} ${styles[className]}`

interface WorkbenchTransferBarProps {
  api: FileTransferGateway
  fileSessionId?: string
  onActionError: () => void
}

export function WorkbenchTransferBar({
  api,
  fileSessionId,
  onActionError,
}: WorkbenchTransferBarProps) {
  const { t } = useTranslation()
  const { transfers, upsertTransfer, removeTransfer } = useTransferRuntime()
  const summary = summarizeWorkbenchTransfers(transfers, fileSessionId)
  const task = summary.tasks.find((item) => item.status === 'running' || item.status === 'queued')
    ?? summary.tasks.find((item) => item.status === 'failed')
  const active = task?.status === 'running' || task?.status === 'queued'
  const upload = task?.type.startsWith('upload')
  const download = task?.type.startsWith('download')
  const TransferIcon = upload ? UploadCloud : download ? DownloadCloud : Copy

  const retry = async () => {
    if (!task?.retryable) {
      return
    }
    try {
      upsertTransfer(await api.retryTransfer(task.id))
    } catch {
      onActionError()
    }
  }

  const cancel = async () => {
    if (!task?.cancellable) {
      return
    }
    try {
      await api.deleteTransfer(task.id)
      removeTransfer(task.id)
    } catch {
      onActionError()
    }
  }

  if (!task) {
    return null
  }

  const title = active && summary.activeCount > 1
    ? t('workbench.files.activeTransfers', { count: summary.activeCount })
    : task.status === 'failed'
      ? t('workbench.files.transferFailed')
      : t(`files.transferType.${task.type}`)
  const description = task.status === 'failed'
    ? task.error_message || t('workbench.files.transferFailed')
    : task.current_file || t(`files.transferStatus.${task.status}`)
  const transferred = formatBytes(summary.activeTransferredBytes)
  const total = formatBytes(summary.activeTotalBytes)
  const speed = t('files.transferSpeed', { value: formatBytes(summary.speed) })
  const progressText = `${summary.progress}%`
  const metricsLabel = t('workbench.files.transferMetricsAria', {
    progress: summary.progress,
    done: transferred,
    total,
    speed,
  })

  return (
    <div
      className={[
        scopedClassName('workbench-file-transfer'),
        styles.root,
        active ? 'is-active' : 'is-failed',
        !active ? styles['is-failed'] : '',
        upload ? 'is-upload' : '',
        download ? 'is-download' : '',
      ].filter(Boolean).join(' ')}
      data-workbench-file-transfer
      data-state={active ? 'active' : 'failed'}
    >
      <span
        className={scopedClassName('workbench-file-transfer-announcement')}
        role={task.status === 'failed' ? 'alert' : 'status'}
        aria-live={task.status === 'failed' ? 'assertive' : 'polite'}
      >
        {title}
      </span>
      <div className={scopedClassName('workbench-file-transfer-main')}>
        <span className={scopedClassName('workbench-file-transfer-icon')} aria-hidden="true"><TransferIcon size={15} /></span>
        <div className={scopedClassName('workbench-file-transfer-copy')}>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        {task.retryable ? (
          <Tooltip title={t('files.retryTransfer')}>
            <Button
              type="text"
              size="small"
              aria-label={t('files.retryTransfer')}
              icon={<RotateCcw size={14} />}
              onClick={() => void retry()}
            />
          </Tooltip>
        ) : null}
        {task.cancellable ? (
          <Tooltip title={t('files.cancelTransfer')}>
            <Button
              type="text"
              size="small"
              aria-label={t('files.cancelTransfer')}
              icon={<X size={14} />}
              onClick={() => void cancel()}
            />
          </Tooltip>
        ) : null}
      </div>
      {active ? (
        <>
          <dl className={scopedClassName('workbench-file-transfer-metrics')} aria-label={metricsLabel}>
            <div className="is-bytes">
              <dt>{t('workbench.files.transferSizeLabel')}</dt>
              <dd>{t('files.transferBytes', { done: transferred, total })}</dd>
            </div>
            <div className={scopedClassName('is-speed')}>
              <dt>{t('files.transferSpeedLabel')}</dt>
              <dd>{speed}</dd>
            </div>
            <div className={scopedClassName('is-progress')}>
              <dt>{t('workbench.files.transferProgressLabel')}</dt>
              <dd>{progressText}</dd>
            </div>
          </dl>
          <div className={scopedClassName('workbench-file-transfer-progress')}>
            <Progress
              aria-label={t('workbench.files.transferProgressLabel')}
              percent={summary.progress}
              showInfo={false}
              size="small"
              strokeColor="var(--accent)"
              trailColor="var(--line-soft)"
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

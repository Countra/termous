import { Button, Tooltip } from 'antd'
import { Copy, DownloadCloud, RotateCcw, UploadCloud, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TransferTask } from '../../types/domain'
import { formatBytes, formatSeconds, pathBase, transferProgress, transferStatusClass } from './fileUtils'

interface TransferQueuePanelProps {
  transfers: TransferTask[]
  connected: boolean
  onCancel: (id: string) => Promise<void>
  onRetry: (id: string) => Promise<void>
}

export function TransferQueuePanel({ transfers, connected, onCancel, onRetry }: TransferQueuePanelProps) {
  const { t } = useTranslation()
  const runningCount = transfers.filter((task) => task.status === 'running' || task.status === 'queued').length
  const completedCount = transfers.filter((task) => task.status === 'completed').length
  const failedCount = transfers.filter((task) => task.status === 'failed').length

  return (
    <section className="files-transfer-panel">
      <div className="files-transfer-status-card">
        <div>
          <strong>{t('files.transfers')}</strong>
          <span>{connected ? t('files.transferEventsConnected') : t('files.transferEventsOffline')}</span>
        </div>
        <span className={`files-live-dot ${connected ? 'is-online' : ''}`} />
      </div>
      <div className="transfer-summary-strip">
        <span>
          <strong>{runningCount}</strong>
          <small>{t('files.transferActive')}</small>
        </span>
        <span>
          <strong>{completedCount}</strong>
          <small>{t('files.transferCompleted')}</small>
        </span>
        <span>
          <strong>{failedCount}</strong>
          <small>{t('files.transferFailed')}</small>
        </span>
      </div>
      <div className="transfer-list">
        {transfers.length === 0 ? (
          <div className="files-quiet-empty">
            <strong>{t('files.noTransfers')}</strong>
            <span>{t('files.noTransfersHint')}</span>
          </div>
        ) : (
          transfers.map((task) => <TransferRow key={task.id} task={task} onCancel={onCancel} onRetry={onRetry} />)
        )}
      </div>
    </section>
  )
}

function TransferRow({
  task,
  onCancel,
  onRetry,
}: {
  task: TransferTask
  onCancel: (id: string) => Promise<void>
  onRetry: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const isUpload = task.type.startsWith('upload')
  const isDownload = task.type.startsWith('download')
  const progress = transferProgress(task)
  const speed = task.speed_bytes_per_sec || task.average_speed_bytes_per_sec
  const currentName = task.current_file || pathBase(task.source_paths[0] ?? task.target_path)
  const totalFiles = Math.max(0, task.total_files || task.source_paths.length)
  const completedFiles = Math.max(0, Math.min(totalFiles, task.completed_files || 0))
  const Icon = isUpload ? UploadCloud : isDownload ? DownloadCloud : Copy

  return (
    <article className={`transfer-row ${transferStatusClass(task.status)}`}>
      <div className="transfer-row-main">
        <span className="transfer-kind-icon">
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="transfer-copy">
          <div className="transfer-title-line">
            <strong>{currentName}</strong>
            <span className="transfer-status">{t(`files.transferStatus.${task.status}`)}</span>
          </div>
          <span>{t(`files.transferType.${task.type}`)} · {pathBase(task.target_path)}</span>
        </div>
        <div className="transfer-actions">
          {task.cancellable ? (
            <Tooltip title={t('files.cancelTransfer')}>
              <Button
                type="text"
                size="small"
                className="files-icon-button files-icon-button-cancel"
                aria-label={t('files.cancelTransfer')}
                onClick={() => void onCancel(task.id)}
                icon={<XCircle size={15} aria-hidden="true" />}
              />
            </Tooltip>
          ) : null}
          {task.retryable ? (
            <Tooltip title={t('files.retryTransfer')}>
              <Button
                type="text"
                size="small"
                className="files-icon-button"
                aria-label={t('files.retryTransfer')}
                onClick={() => void onRetry(task.id)}
                icon={<RotateCcw size={13} aria-hidden="true" />}
              />
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div className="transfer-progress-line">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="transfer-meta-grid">
        <span>{t('files.transferBytes', { done: formatBytes(task.transferred_bytes), total: formatBytes(task.total_bytes) })}</span>
        <span>{t('files.transferFiles', { done: completedFiles, total: totalFiles })}</span>
        <span>{t('files.transferSpeed', { value: formatBytes(speed) })}</span>
        <span>{t('files.transferEta', { value: formatSeconds(task.eta_seconds) })}</span>
      </div>
      {task.error_message ? <p className="transfer-error">{task.error_message}</p> : null}
    </article>
  )
}

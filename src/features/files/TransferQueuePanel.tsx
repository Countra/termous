import { Button, Progress, Tooltip } from 'antd'
import { RotateCcw, Square, UploadCloud, DownloadCloud } from 'lucide-react'
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

  return (
    <aside className="files-side-panel details-panel">
      <div className="panel-heading">
        <div>
          <h2>{t('files.transfers')}</h2>
          <span>{connected ? t('files.transferEventsConnected') : t('files.transferEventsOffline')}</span>
        </div>
        <span className={`files-live-dot ${connected ? 'is-online' : ''}`} />
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
    </aside>
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
  const progress = transferProgress(task)
  const speed = task.speed_bytes_per_sec || task.average_speed_bytes_per_sec
  const currentName = task.current_file || pathBase(task.source_paths[0] ?? task.target_path)

  return (
    <article className={`transfer-row ${transferStatusClass(task.status)}`}>
      <div className="transfer-row-top">
        <span className="transfer-kind-icon">
          {isUpload ? <UploadCloud size={16} aria-hidden="true" /> : <DownloadCloud size={16} aria-hidden="true" />}
        </span>
        <div className="transfer-copy">
          <strong>{currentName}</strong>
          <span>{t(`files.transferType.${task.type}`)}</span>
        </div>
        <span className="transfer-status">{t(`files.transferStatus.${task.status}`)}</span>
      </div>
      <Progress
        percent={progress}
        size="small"
        showInfo={false}
        status={task.status === 'failed' ? 'exception' : task.status === 'completed' ? 'success' : 'active'}
      />
      <div className="transfer-meta-grid">
        <span>{formatBytes(task.transferred_bytes)} / {formatBytes(task.total_bytes)}</span>
        <span>{formatBytes(speed)}/s</span>
        <span>{formatSeconds(task.eta_seconds)}</span>
      </div>
      {task.error_message ? <p className="transfer-error">{task.error_message}</p> : null}
      <div className="transfer-actions">
        {task.cancellable ? (
          <Tooltip title={t('files.cancelTransfer')}>
            <Button
              type="text"
              size="small"
              className="files-icon-button"
              onClick={() => void onCancel(task.id)}
              icon={<Square size={13} aria-hidden="true" />}
            />
          </Tooltip>
        ) : null}
        {task.retryable ? (
          <Tooltip title={t('files.retryTransfer')}>
            <Button
              type="text"
              size="small"
              className="files-icon-button"
              onClick={() => void onRetry(task.id)}
              icon={<RotateCcw size={13} aria-hidden="true" />}
            />
          </Tooltip>
        ) : null}
      </div>
    </article>
  )
}

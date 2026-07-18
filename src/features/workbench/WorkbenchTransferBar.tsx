import { Button, Progress, Tooltip } from 'antd'
import { Download, RotateCcw, X } from 'lucide-react'
import type { DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import { useTransferRuntime } from '../../app/useTransferRuntime'
import { formatBytes, formatSeconds } from '../files/fileUtils'
import { summarizeWorkbenchTransfers } from './workbenchTransferState'

interface WorkbenchTransferBarProps {
  api: TermousApi
  fileSessionId?: string
  downloadDropActive: boolean
  onActionError: () => void
  onDownloadDragEnter: (event: DragEvent<HTMLDivElement>) => void
  onDownloadDragLeave: (event: DragEvent<HTMLDivElement>) => void
  onDownloadDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDownloadDrop: (event: DragEvent<HTMLDivElement>) => void
}

export function WorkbenchTransferBar({
  api,
  fileSessionId,
  downloadDropActive,
  onActionError,
  onDownloadDragEnter,
  onDownloadDragLeave,
  onDownloadDragOver,
  onDownloadDrop,
}: WorkbenchTransferBarProps) {
  const { t } = useTranslation()
  const { transfers, upsertTransfer, removeTransfer } = useTransferRuntime()
  const summary = summarizeWorkbenchTransfers(transfers, fileSessionId)
  const latest = summary.tasks[0]

  const retry = async () => {
    if (!latest?.retryable) {
      return
    }
    try {
      upsertTransfer(await api.retryTransfer(latest.id))
    } catch {
      onActionError()
    }
  }

  const cancel = async () => {
    if (!latest?.cancellable) {
      return
    }
    try {
      await api.deleteTransfer(latest.id)
      removeTransfer(latest.id)
    } catch {
      onActionError()
    }
  }

  return (
    <div
      className={`workbench-file-transfer ${downloadDropActive ? 'is-drop-target' : ''}`}
      onDragEnter={onDownloadDragEnter}
      onDragLeave={onDownloadDragLeave}
      onDragOver={onDownloadDragOver}
      onDrop={onDownloadDrop}
    >
      <div className="workbench-file-transfer-main">
        <span className="workbench-file-transfer-icon"><Download size={15} /></span>
        <div className="workbench-file-transfer-copy">
          <strong>
            {downloadDropActive
              ? t('workbench.files.chooseDownloadDirectory')
              : summary.activeCount > 0
                ? t('workbench.files.activeTransfers', { count: summary.activeCount })
                : latest?.status === 'failed'
                  ? t('workbench.files.transferFailed')
                  : t('workbench.files.dropToDownload')}
          </strong>
          <span>
            {summary.activeCount > 0
              ? `${formatBytes(summary.speed)}/s · ${formatSeconds(summary.eta)}`
              : latest?.current_file || latest?.error_message || t('workbench.files.dropToDownloadHint')}
          </span>
        </div>
        {latest?.retryable ? (
          <Tooltip title={t('files.retryTransfer')}>
            <Button type="text" size="small" icon={<RotateCcw size={14} />} onClick={() => void retry()} />
          </Tooltip>
        ) : null}
        {latest?.cancellable ? (
          <Tooltip title={t('files.cancelTransfer')}>
            <Button type="text" size="small" icon={<X size={14} />} onClick={() => void cancel()} />
          </Tooltip>
        ) : null}
      </div>
      {summary.activeCount > 0 ? (
        <Progress
          percent={summary.progress}
          showInfo={false}
          size="small"
          strokeColor="var(--accent)"
          trailColor="var(--line-soft)"
        />
      ) : null}
    </div>
  )
}

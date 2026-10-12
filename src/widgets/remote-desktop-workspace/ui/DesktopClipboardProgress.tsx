import { Button, Progress } from 'antd'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TransferTask } from '#entities/file'
import { formatBytes } from '#shared/format'
import styles from './DesktopFilesPanel.module.scss'

export function DesktopClipboardProgress({ task, busy, cancel }: { task: TransferTask; busy: boolean; cancel: () => void }) {
  const { t } = useTranslation()
  const failed = task.status === 'failed' || task.status === 'cancelled'
  const phase = task.status === 'completed' ? 'clipboardReceiveProvided' : failed ? 'clipboardReceiveStopped' : task.status === 'queued' ? 'clipboardReceiveQueued' : 'clipboardReceiving'
  const percent = task.total_bytes > 0 ? Math.min(100, Math.floor(task.transferred_bytes / task.total_bytes * 100)) : 0
  return <div className={styles['clipboard-progress']} role="group" aria-label={t('remoteDesktop.files.clipboardReceiving')}>
    <div className={styles['clipboard-progress-heading']}><strong>{t(`remoteDesktop.files.${phase}`)}</strong>
      {task.cancellable && <Button type="text" size="small" icon={<X size={14} />} disabled={busy} onClick={cancel}>{t('remoteDesktop.files.clipboardReceiveCancel')}</Button>}
    </div>
    {task.current_file && <span className={styles['clipboard-progress-file']} title={task.current_file}>{task.current_file}</span>}
    <Progress percent={percent} size="small" status={failed ? 'exception' : task.status === 'completed' ? 'success' : 'normal'} />
    <span>{formatBytes(task.transferred_bytes)} / {formatBytes(task.total_bytes)}{task.status === 'running' && task.speed_bytes_per_sec > 0 ? ` · ${formatBytes(task.speed_bytes_per_sec)}/s` : ''}</span>
    {failed && <p>{t('remoteDesktop.files.clipboardReceivePartial')}</p>}
    {task.status === 'completed' && <p>{t('remoteDesktop.files.clipboardReceiveResult')}</p>}
  </div>
}

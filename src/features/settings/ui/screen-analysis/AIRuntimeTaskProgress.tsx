import { Progress } from 'antd'
import type { TFunction } from 'i18next'
import { Clock3, Download, LoaderCircle } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { AIRuntimeTask } from '#entities/ai-runtime'
import { formatBytes } from '#shared/format'
import styles from './AIRuntimeTaskProgress.module.scss'

function remainingDownloadTime(task: AIRuntimeTask, t: TFunction) {
  if (task.total <= 0 || task.bytes_per_second <= 0) return t('settings.aiRuntime.downloadEstimating')
  const seconds = (task.total - task.downloaded) / task.bytes_per_second
  if (seconds < 60) return t('settings.aiRuntime.downloadRemainingShort')
  // 复用状态快照的平滑速度，按分钟向上取整，不建立独立倒计时。
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return t('settings.aiRuntime.downloadRemainingMinutes', { count: minutes })
  if (minutes >= 1440) {
    const totalHours = Math.ceil(minutes / 60)
    const days = Math.floor(totalHours / 24)
    const hours = totalHours % 24
    return hours === 0 ? t('settings.aiRuntime.downloadRemainingDays', { count: days })
      : t('settings.aiRuntime.downloadRemainingDaysHours', { days, hours })
  }
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? t('settings.aiRuntime.downloadRemainingHours', { count: hours })
    : t('settings.aiRuntime.downloadRemainingHoursMinutes', { hours, minutes: remainder })
}

export function AIRuntimeTaskProgress({ task, downloadSize, statusUnavailable }: {
  task: AIRuntimeTask
  downloadSize: number
  statusUnavailable: boolean
}) {
  const { t } = useTranslation()
  const labelId = useId()
  const downloading = task.phase === 'downloading'
  const total = task.total || downloadSize
  const percent = total > 0 ? Math.min(100, Math.floor(task.downloaded / total * 1000) / 10) : 0
  const finishing = task.total > 0 && task.downloaded >= task.total
  const title = !downloading ? t(`settings.aiRuntime.phases.${task.phase}`)
    : statusUnavailable ? t('settings.aiRuntime.downloadStatusUnavailable')
      : finishing ? t('settings.aiRuntime.downloadFinishing')
        : task.downloaded === 0 ? t('settings.aiRuntime.downloadConnecting') : t('settings.aiRuntime.phases.downloading')

  return <div className={styles.progress}>
    <div className={styles.header}>
      <div className={styles.status}>
        {downloading ? <Download size={15} aria-hidden="true" /> : <LoaderCircle size={15} className={styles.spinner} aria-hidden="true" />}
        <span id={labelId} role="status">{title}</span>
      </div>
      {downloading && <span className={styles.percent} aria-hidden="true">{percent}%</span>}
    </div>
    {downloading && <>
      <Progress className={styles.bar} percent={percent} showInfo={false} status="normal"
        size={{ height: 4 }} strokeColor="var(--accent)" railColor="var(--border)" aria-labelledby={labelId} aria-valuenow={percent} />
      <dl className={styles.metrics}>
        <div className={styles.amount}>
          <dt className={styles.label}>{t('settings.aiRuntime.downloadedLabel')}</dt>
          <dd>{t('settings.aiRuntime.downloadProgress', { downloaded: formatBytes(task.downloaded), total: formatBytes(total) })}</dd>
        </div>
        {!statusUnavailable && !finishing && <>
          <div>
            <dt className={styles.label}>{t('settings.aiRuntime.downloadSpeedLabel')}</dt>
            <dd>{t('settings.aiRuntime.downloadSpeed', { speed: formatBytes(task.bytes_per_second) })}</dd>
          </div>
          <div>
            <dt className={styles.label}>{t('settings.aiRuntime.downloadRemainingLabel')}</dt>
            <dd className={styles.remaining}><Clock3 size={12} aria-hidden="true" />{remainingDownloadTime(task, t)}</dd>
          </div>
        </>}
      </dl>
    </>}
    {!task.cancellable && <p className={styles.notice}>{t('settings.aiRuntime.writing')}</p>}
  </div>
}

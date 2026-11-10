import { Alert, Button, Progress } from 'antd'
import type { TFunction } from 'i18next'
import { Cpu } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { analysisDevice, analysisPhase, useAIRuntime, type AIRuntimeTask } from '#entities/ai-runtime'
import { formatBytes } from '#shared/format'
import { SettingsGroup } from '../controls/SettingsGroup'
import styles from '../controls/SettingsGroup.module.scss'
import layout from './ScreenAnalysisSettings.module.scss'

const downloadErrors: Record<string, string> = {
  runtime_download_timeout: 'settings.aiRuntime.downloadTimeout',
  runtime_download_network: 'settings.aiRuntime.downloadNetwork',
  runtime_download_settings: 'settings.aiRuntime.downloadSettings',
  runtime_download_redirect: 'settings.aiRuntime.downloadRedirect',
}

function remainingDownloadTime(task: AIRuntimeTask, t: TFunction) {
  if (task.total <= 0) return t('settings.aiRuntime.downloadEstimating')
  if (task.downloaded >= task.total) return t('settings.aiRuntime.downloadFinishing')
  if (task.bytes_per_second <= 0) return t('settings.aiRuntime.downloadEstimating')
  const seconds = (task.total - task.downloaded) / task.bytes_per_second
  if (seconds < 60) return t('settings.aiRuntime.downloadRemainingShort')
  // 复用同一状态快照的平滑速度，按分钟向上取整，不制造独立倒计时。
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

export function AIRuntimeSetting({ disabled, active: visible = true }: { disabled: boolean; active?: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const { available, status, error, pending, active, act } = useAIRuntime(visible)
  if (!available) return <SettingsGroup title={t('settings.aiRuntime.title')} icon={<Cpu size={16} aria-hidden="true" />}>
    <p className={layout.notice} role="status">{t('settings.screenAnalysis.runtimeUnavailable')}</p>
  </SettingsGroup>
  const task = status?.task
  const gpu = status?.check?.gpu_available === true
  const device = analysisDevice(error ? undefined : status)
  const deviceName = status?.service?.device_name || (device === 'cuda' ? status?.device.name : undefined)
  const unavailable = !status?.managed || status.state !== 'complete'
  const locked = disabled || pending || active || unavailable
  const size = status ? (status.download_size / 1024 ** 3).toFixed(2) : '—'
  const failed = error || task?.phase === 'failed' || status?.state === 'incomplete' || status?.check?.cpu_available === false
  const downloadTotal = task?.total || status?.download_size || 0
  const percent = downloadTotal && task ? Math.min(100, Math.floor(task.downloaded / downloadTotal * 1000) / 10) : 0
  const failureDescription = status?.state === 'incomplete' || status?.check?.cpu_available === false ? 'settings.aiRuntime.repair'
    : !error && task?.phase === 'failed' ? downloadErrors[task.error ?? ''] ?? 'settings.aiRuntime.retry' : 'settings.aiRuntime.retry'
  const phase = analysisPhase(error ? undefined : status?.service)
  const description = status?.state === 'development' ? 'settings.aiRuntime.development'
    : status?.capabilities?.gpu_install ? 'settings.aiRuntime.description' : 'settings.aiRuntime.cpuDescription'
  return <SettingsGroup title={t('settings.aiRuntime.title')} icon={<Cpu size={16} aria-hidden="true" />}>
    <div className={layout.runtime}>
      <div className={layout['runtime-summary']}>
        <div className={layout['runtime-device']}><span>{t('settings.screenAnalysis.device')}</span>
          <strong>{t(device === 'unknown' ? 'settings.aiRuntime.unknown' : device === 'cuda' ? 'settings.aiRuntime.gpu' : 'settings.aiRuntime.cpu')}</strong>
          {device !== 'unknown' && deviceName && <p className={styles.hint}>{deviceName}</p>}
        </div>
        <div className={layout['runtime-device']}><span>{t('settings.screenAnalysis.service')}</span>
          <strong className={layout['service-state']} data-phase={phase} role="status">{t(`settings.aiRuntime.serviceShortStates.${phase}`)}</strong>
          {phase !== 'ready' && <p className={styles.hint}>{t(`settings.aiRuntime.serviceStates.${phase}`)}</p>}
        </div>
      </div>
      <p className={styles.hint}>{t('settings.screenAnalysis.runtimeHint')}</p>
      <div className={layout['runtime-actions']}>
        <p className={styles.hint}>{t(description, { size })}</p>
        <div className={layout.actions}>
        {status?.capabilities?.gpu_install && status.profile !== 'cuda' && <Button id={id} aria-label={t('settings.aiRuntime.download')} disabled={locked || !status?.device.eligible}
          loading={pending} onClick={() => void act('download')}>{t('settings.aiRuntime.download')}</Button>}
        {status?.capabilities?.gpu_check && status.profile === 'cuda' && <Button id={id} aria-label={t('settings.aiRuntime.check')} disabled={locked} onClick={() => void act('check')}>{t('settings.aiRuntime.check')}</Button>}
        {active && <Button disabled={pending || !task?.cancellable} onClick={() => void act('cancel')}>{t('app.cancel')}</Button>}
        </div>
      </div>
      {status?.capabilities?.gpu_install && status.profile !== 'cuda' && <p className={styles.hint}>{t('settings.aiRuntime.networkHint')}</p>}
      {status?.service?.state === 'failed' && <Alert type="error" title={t('settings.aiRuntime.serviceFailed')} />}
      {status?.capabilities?.gpu_install && !status.device.eligible && <p className={styles.hint}>{t('settings.aiRuntime.requirements')}</p>}
      {active && task && <div role="status" aria-live="polite">
        <p className={styles.hint}>{t(`settings.aiRuntime.phases.${task.phase}`)}</p>
        {task.phase === 'downloading' && <>
          <Progress percent={percent} />
          {task.downloaded === 0 && <p className={styles.hint}>{t('settings.aiRuntime.downloadConnecting')}</p>}
          <p className={styles.hint}>{t('settings.aiRuntime.downloadProgress', { downloaded: formatBytes(task.downloaded), total: formatBytes(downloadTotal) })}</p>
          {!error && <p className={styles.hint}>
            <span>{t('settings.aiRuntime.downloadSpeed', { speed: formatBytes(task.bytes_per_second) })}</span>
            {' · '}<span>{remainingDownloadTime(task, t)}</span>
          </p>}
        </>}
        {!task.cancellable && <p className={styles.hint}>{t('settings.aiRuntime.writing')}</p>}
      </div>}
      {failed && <Alert type="error" title={t('settings.aiRuntime.failed')} description={t(failureDescription)} />}
      {status?.check?.cpu_available && !gpu && status.profile === 'cuda' && <Alert type="warning" title={t('settings.aiRuntime.fallback')} />}
      {gpu && <p role="status" className={styles.hint}>{t('settings.aiRuntime.ready')}</p>}
    </div>
  </SettingsGroup>
}

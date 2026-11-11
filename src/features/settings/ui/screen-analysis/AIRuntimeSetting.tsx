import { Alert, Button } from 'antd'
import { Cpu } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { analysisDevice, analysisPhase, useAIRuntime } from '#entities/ai-runtime'
import { SettingsGroup } from '../controls/SettingsGroup'
import styles from '../controls/SettingsGroup.module.scss'
import { AIRuntimeTaskProgress } from './AIRuntimeTaskProgress'
import layout from './ScreenAnalysisSettings.module.scss'

const downloadErrors: Record<string, string> = {
  runtime_download_timeout: 'settings.aiRuntime.downloadTimeout',
  runtime_download_network: 'settings.aiRuntime.downloadNetwork',
  runtime_download_settings: 'settings.aiRuntime.downloadSettings',
  runtime_download_redirect: 'settings.aiRuntime.downloadRedirect',
}

export function AIRuntimeSetting({ disabled, active: visible = true }: { disabled: boolean; active?: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const { available, status, error, statusUnavailable, pending, active, act } = useAIRuntime(visible)
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
      {status?.service?.state === 'failed' && <Alert type="error" title={t('settings.aiRuntime.serviceFailed')} />}
      {status?.capabilities?.gpu_install && !status.device.eligible && <p className={styles.hint}>{t('settings.aiRuntime.requirements')}</p>}
      {active && task && <AIRuntimeTaskProgress task={task} downloadSize={status.download_size} statusUnavailable={statusUnavailable} />}
      {failed && <Alert type="error" title={t('settings.aiRuntime.failed')} description={t(failureDescription)} />}
      {status?.check?.cpu_available && !gpu && status.profile === 'cuda' && <Alert type="warning" title={t('settings.aiRuntime.fallback')} />}
      {gpu && <p role="status" className={styles.hint}>{t('settings.aiRuntime.ready')}</p>}
    </div>
  </SettingsGroup>
}

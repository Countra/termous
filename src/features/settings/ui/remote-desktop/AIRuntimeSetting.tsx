import { Alert, Button, Progress, Space } from 'antd'
import { Cpu } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { analysisDevice, useAIRuntime } from '#entities/ai-runtime'
import { SettingsField, SettingsGroup } from '../controls/SettingsGroup'
import styles from '../controls/SettingsGroup.module.scss'

export function AIRuntimeSetting({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const { available, status, error, pending, active, act } = useAIRuntime()
  if (!available) return null
  const task = status?.task
  const gpu = status?.check?.gpu_available === true
  const device = analysisDevice(error ? undefined : status)
  const unavailable = !status?.managed || status.state !== 'complete'
  const locked = disabled || pending || active || unavailable
  const size = status ? (status.download_size / 1024 ** 3).toFixed(2) : '—'
  const failed = error || task?.phase === 'failed' || status?.state === 'incomplete' || status?.check?.cpu_available === false
  return <SettingsGroup title={t('settings.aiRuntime.title')} icon={<Cpu size={16} aria-hidden="true" />}>
    <SettingsField htmlFor={id} descriptionId={`${id}-description`} label={t(device === 'unknown' ? 'settings.aiRuntime.unknown' : device === 'cuda' ? 'settings.aiRuntime.gpu' : 'settings.aiRuntime.cpu')}
      description={t(status?.capabilities?.gpu_install ? 'settings.aiRuntime.description' : 'settings.aiRuntime.cpuDescription', { size })} control={<Space wrap>
        {status?.capabilities?.gpu_install && status.profile !== 'cuda' && <Button id={id} aria-label={t('settings.aiRuntime.download')} disabled={locked || !status?.device.eligible}
          loading={pending} onClick={() => void act('download')}>{t('settings.aiRuntime.download')}</Button>}
        {status?.capabilities?.gpu_check && status.profile === 'cuda' && <Button id={id} aria-label={t('settings.aiRuntime.check')} disabled={locked} onClick={() => void act('check')}>{t('settings.aiRuntime.check')}</Button>}
        {active && <Button disabled={pending || !task?.cancellable} onClick={() => void act('cancel')}>{t('app.cancel')}</Button>}
      </Space>}>
      {status?.device.name && <p className={styles.hint}>{status.device.name}</p>}
      {status?.state === 'development' && <p className={styles.hint}>{t('settings.aiRuntime.development')}</p>}
      {status?.capabilities?.gpu_install && !status.device.eligible && <p className={styles.hint}>{t('settings.aiRuntime.requirements')}</p>}
      {active && task && <div role="status" aria-live="polite">
        <p className={styles.hint}>{t(`settings.aiRuntime.phases.${task.phase}`)}</p>
        {task.phase === 'downloading' && <Progress percent={task.total ? Math.min(100, Math.round(task.downloaded / task.total * 100)) : 0} />}
        {!task.cancellable && <p className={styles.hint}>{t('settings.aiRuntime.writing')}</p>}
      </div>}
      {failed && <Alert type="error" title={t('settings.aiRuntime.failed')} description={t(status?.state === 'incomplete' || status?.check?.cpu_available === false ? 'settings.aiRuntime.repair' : 'settings.aiRuntime.retry')} />}
      {status?.check?.cpu_available && !gpu && status.profile === 'cuda' && <Alert type="warning" title={t('settings.aiRuntime.fallback')} />}
      {gpu && <p role="status" className={styles.hint}>{t('settings.aiRuntime.ready')}</p>}
    </SettingsField>
  </SettingsGroup>
}

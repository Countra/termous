import { Alert, App, Button } from 'antd'
import { Database, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsErrorCode, useSettingsModule } from '#entities/settings'
import { useVisibleQuery, type AnalysisGateway, type AnalysisStorageSettings } from '#entities/screen-analysis'
import { SettingsField, SettingsGroup } from '../controls/SettingsGroup'
import { SettingsNumberInput } from '#shared/ui'
import styles from '../controls/SettingsGroup.module.scss'
import layout from './ScreenAnalysisSettings.module.scss'
import { ScreenAnalysisStorageUsage } from './ScreenAnalysisStorageUsage'

function valid(value: unknown): value is AnalysisStorageSettings {
  if (!value || typeof value !== 'object') return false
  const v = value as AnalysisStorageSettings
  return Number.isSafeInteger(v.max_bytes) && v.max_bytes >= 128 * 1024 ** 2 && v.max_bytes <= 10 * 1024 ** 3
    && Number.isInteger(v.max_records) && v.max_records >= 10 && v.max_records <= 10000
    && Number.isInteger(v.retention_days) && v.retention_days >= 1 && v.retention_days <= 90
}
export function ScreenAnalysisStorageSetting({ disabled, gateway, active = true }: { disabled: boolean; gateway?: AnalysisGateway; active?: boolean }) {
  const { t } = useTranslation(); const { modal, message } = App.useApp(); const id = useId()
  const module = useSettingsModule('screen_analysis_storage', { refreshOnFocus: true })
  const usage = useVisibleQuery('analysis-storage', signal => gateway!.analysisStorage(signal), active && !!gateway)
  const [edit, setEdit] = useState<{ value: { [K in keyof AnalysisStorageSettings]: number | null }; revision: number }>()
  const latestEdit = useRef(edit)
  const confirmation = useRef<ReturnType<typeof modal.confirm> | undefined>(undefined)
  useEffect(() => () => confirmation.current?.destroy(), [])
  useEffect(() => { if (!active) confirmation.current?.destroy() }, [active])
  const [clearing, setClearing] = useState(false)
  const pending = useRef(false)
  const confirmed = valid(module.snapshot?.value) ? module.snapshot.value : undefined
  const value = edit?.value ?? confirmed
  const locked = disabled || module.busy || !confirmed || !module.available || module.snapshot?.state.status === 'unavailable'
  const conflict = settingsErrorCode(module.error) === 'SETTINGS_REVISION_CONFLICT'
  const save = async () => {
    const next = latestEdit.current
    if (locked || pending.current || !next || !valid(next.value)) return
    pending.current = true
    try { if (await module.update({ ...next.value }, next.revision) && latestEdit.current === next) { latestEdit.current = undefined; setEdit(undefined); usage.reload() } }
    finally { pending.current = false }
  }
  const clear = () => { confirmation.current?.destroy(); confirmation.current = modal.confirm({ title: t('analysisCenter.clear'), content: t('analysisCenter.clearHint'), okButtonProps: { danger: true }, onOk: async () => {
    if (!gateway) return
    setClearing(true)
    try { await gateway.clearAnalyses(); usage.reload() }
    catch (error) { void message.error(t('analysisCenter.operationFailed')); throw error }
    finally { setClearing(false) }
  } }) }
  return <SettingsGroup title={t('analysisCenter.storage')} icon={<Database size={16} />}>
    {(['max_bytes', 'max_records', 'retention_days'] as const).map(key => <SettingsField key={key} htmlFor={`${id}-${key}`} descriptionId={`${id}-${key}-hint`}
      label={t(`analysisCenter.${key}`)} description={t(`analysisCenter.${key}Hint`)} control={<SettingsNumberInput id={`${id}-${key}`} disabled={locked} aria-describedby={`${id}-${key}-hint`}
        unit={key === 'max_bytes' ? 'MiB' : key === 'retention_days' ? t('settings.screenAnalysis.days') : undefined}
        value={value?.[key] == null ? null : key === 'max_bytes' ? value[key] / 1024 ** 2 : value[key]} changeOnBlur={false}
        status={value && !valid(value) ? 'error' : undefined} aria-invalid={!!value && !valid(value)} onChange={next => { if (value) {
          const draft = { revision: latestEdit.current?.revision ?? module.snapshot!.revision,
            value: { ...value, [key]: next == null ? null : key === 'max_bytes' ? next * 1024 ** 2 : next } }
          latestEdit.current = draft; setEdit(draft)
        } }} onBlur={() => void save()} onPressEnter={() => void save()} />} />)}
    {module.error && <Alert type="error" title={t(conflict ? 'settings.conflict' : 'settings.screenAnalysis.saveFailed')}
      action={<Button disabled={disabled || module.busy} onClick={() => { if (conflict || !edit) void module.refresh().then(value => { if (value) { latestEdit.current = undefined; setEdit(undefined) } }); else void save() }}>{t('app.retry')}</Button>} />}
    <div className={layout['storage-footer']}>
      {usage.data && <ScreenAnalysisStorageUsage usage={usage.data} />}
      {!confirmed && !module.busy && <p className={styles.hint} role="status">{t('settings.screenAnalysis.storageUnavailable')}</p>}
      {(usage.error != null || usage.data?.cleanup_error) && <Alert type="warning" title={t('analysisCenter.cleanupFailed')} />}
      <div className={layout['storage-actions']}>
        <Button icon={<RefreshCw size={14} aria-hidden="true" />} styles={{ icon: { width: 14 } }} disabled={!gateway || clearing || !active} loading={usage.loading} onClick={usage.reload}>{t('desktopWorkflow.refresh')}</Button>
        <Button danger icon={<Trash2 size={14} aria-hidden="true" />} disabled={disabled || !gateway || clearing || !active} loading={clearing} onClick={clear}>{t('analysisCenter.clear')}</Button>
      </div>
    </div>
  </SettingsGroup>
}

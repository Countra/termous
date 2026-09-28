import { Alert, Button, InputNumber, Spin, Switch } from 'antd'
import { ClipboardList } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { decodeAuditSettings, type AuditSettings as Settings } from '#entities/audit'
import { useSettingsModule, settingsErrorCode } from '#entities/settings'
import type { AuditSettingsGateway } from '../../api/auditSettingsGateway'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './AuditSettings.module.scss'

export function AuditSettings({ gateway, disabled }: { gateway: AuditSettingsGateway; disabled: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const [saved, setSaved] = useState<Settings | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [days, setDays] = useState<number | null>(90)
  const [records, setRecords] = useState<number | null>(0)
  const module = useSettingsModule('audit', { gateway })
  const [savedRevision, setSavedRevision] = useState<number>()
  const [savedNotice, setSavedNotice] = useState(false)
  const loading = module.busy && saved === null
  const saving = module.busy && saved !== null
  const unavailable = module.snapshot?.state.status === 'unavailable'
  const failed = module.error !== null || unavailable
  const conflict = settingsErrorCode(module.error) === 'SETTINGS_REVISION_CONFLICT'

  useEffect(() => { setSaved(null); setSavedRevision(undefined); setSavedNotice(false) }, [gateway])
  useEffect(() => {
    if (!module.snapshot || module.snapshot.state.status === 'unavailable' || saved !== null) return
    const value = decodeAuditSettings(module.snapshot.value)
    setSaved(value)
    setSavedRevision(module.snapshot.revision)
    setEnabled(value.enabled)
    setDays(value.retention_days)
    setRecords(value.max_records)
  }, [module.snapshot, saved])

  useEffect(() => { if (conflict && module.snapshot) setSavedRevision(module.snapshot.revision) }, [conflict, module.snapshot])

  const validDays = days !== null && Number.isInteger(days) && days >= 1 && days <= 3650
  const validRecords = records !== null && Number.isInteger(records) && (records === 0 || (records >= 1000 && records <= 1_000_000))
  const dirty = saved !== null && (saved.enabled !== enabled || saved.retention_days !== days || saved.max_records !== records)
  const locked = disabled || loading || saving || !saved || unavailable
  const save = async () => {
    if (locked || !saved || !validDays || !validRecords || !dirty) return
    setSavedNotice(false)
    const patch: Partial<Settings> = {}
    if (enabled !== saved.enabled) patch.enabled = enabled
    if (days !== saved.retention_days) patch.retention_days = days
    if (records !== saved.max_records) patch.max_records = records
    const snapshot = await module.update(patch, savedRevision)
    if (!snapshot) return
    const value = decodeAuditSettings(snapshot.value)
    setSaved(value)
    setSavedRevision(snapshot.revision)
    setEnabled(value.enabled)
    setDays(value.retention_days)
    setRecords(value.max_records)
    setSavedNotice(true)
  }

  return (
    <section className={surfaceStyles.surface} aria-labelledby={`${id}-title`}>
      <div className={surfaceStyles.header}>
        <ClipboardList size={18} aria-hidden="true" />
        <h2 id={`${id}-title`}>{t('settings.audit.title')}</h2>
      </div>
      <div className={styles.body}>
        {failed && <Alert type="error" showIcon title={t(conflict ? 'settings.conflict' : saved ? 'settings.audit.saveFailed' : 'settings.audit.loadFailed')}
          action={!saved ? <Button size="small" disabled={disabled || loading} onClick={() => void module.refresh()}>{t('app.retry')}</Button> : undefined} />}
        {loading ? <div className={styles.loading}><Spin /></div> : saved && <>
          <div className={styles.toggle}>
            <div><label htmlFor={`${id}-enabled`}>{t('settings.audit.enabled')}</label><p className={surfaceStyles.hint} id={`${id}-enabled-hint`}>{t('settings.audit.enabledHint')}</p></div>
            <Switch id={`${id}-enabled`} aria-describedby={`${id}-enabled-hint`} checked={enabled} disabled={locked} onChange={setEnabled} />
          </div>
          <div className={styles.retention}>
            <div className={styles.row}>
              <label htmlFor={`${id}-days`}>{t('settings.audit.days')}</label>
              <InputNumber id={`${id}-days`} value={days} min={1} max={3650} precision={0} suffix={t('settings.audit.dayUnit')} disabled={locked} status={validDays ? undefined : 'error'} onChange={setDays} />
            </div>
            <div className={styles.row}>
              <div><label htmlFor={`${id}-records`}>{t('settings.audit.records')}</label><p className={surfaceStyles.hint} id={`${id}-records-hint`}>{t('settings.audit.recordsHint')}</p></div>
              <InputNumber id={`${id}-records`} aria-describedby={`${id}-records-hint`} value={records} min={0} max={1_000_000} step={1000} precision={0} disabled={locked} status={validRecords ? undefined : 'error'} onChange={setRecords} />
            </div>
            <p className={surfaceStyles.hint}>{t('settings.audit.retentionHint')}</p>
          </div>
        </>}
        <div className={styles.footer}>
          {savedNotice && !dirty && <p className={surfaceStyles.hint} role="status">{t('settings.audit.saved')}</p>}
          <Button aria-label={t('app.save')} type="primary" loading={saving} disabled={locked || !dirty || !validDays || !validRecords} onClick={() => void save()}>{t('app.save')}</Button>
        </div>
      </div>
    </section>
  )
}

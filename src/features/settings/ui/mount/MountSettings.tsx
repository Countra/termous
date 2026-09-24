import { Alert, Button, Input, InputNumber, Segmented, Spin, Tag } from 'antd'
import { FolderOpen, HardDrive } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MountSettings as MountSettingsValue, MountSettingsState } from '#common/contracts'
import { getTermousBridge } from '#shared/bridge'
import type { MountSettingsGateway } from '../../api/mountSettingsGateway'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './MountSettings.module.scss'
import { MountCacheUsage } from './MountCacheUsage'

export function MountSettings({ gateway, disabled }: { gateway?: MountSettingsGateway; disabled: boolean }) {
  const { t } = useTranslation()
  const inputId = useId()
  const [state, setState] = useState<MountSettingsState | null>(null)
  const [custom, setCustom] = useState(false)
  const [directory, setDirectory] = useState('')
  const [capacity, setCapacity] = useState<number | null>(10)
  const [reserve, setReserve] = useState<number | null>(512)
  const [operation, setOperation] = useState<'load' | 'save' | 'pick' | null>(null)
  const busy = operation !== null
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const pending = useRef(false)
  const revision = useRef(0)
  const bridge = getTermousBridge()?.files

  const request = useCallback(async (settings?: MountSettingsValue) => {
    if (pending.current) return
    if (settings === undefined) {
      setState(null)
      setCustom(false)
      setDirectory('')
      setCapacity(10)
      setReserve(512)
      setOperation(null)
    }
    setError(null)
    setSaved(false)
    if (!gateway) return
    const current = ++revision.current
    pending.current = true
    setOperation(settings === undefined ? 'load' : 'save')
    try {
      const next = settings === undefined ? await gateway.mountSettings() : await gateway.updateMountSettings(settings)
      if (current !== revision.current) return
      setState(next)
      setCustom(Boolean(next.cache_directory))
      setDirectory(next.cache_directory)
      setCapacity(next.cache_max_bytes / 2 ** 30)
      setReserve(next.cache_min_free_bytes / 2 ** 20)
      setSaved(settings !== undefined)
    } catch (err) {
      if (current === revision.current) setError(err instanceof Error ? err.message : '')
    } finally {
      if (current === revision.current) { pending.current = false; setOperation(null) }
    }
  }, [gateway])

  useEffect(() => {
    void request()
    return () => { revision.current += 1; pending.current = false }
  }, [request])

  const pick = async () => {
    if (!bridge || pending.current) return
    const current = ++revision.current
    pending.current = true
    setOperation('pick')
    setError(null)
    try {
      const selected = await bridge.pickDirectory()
      if (current === revision.current && selected?.[0]) { setDirectory(selected[0]); setSaved(false) }
    } catch (err) {
      if (current === revision.current) setError(err instanceof Error ? err.message : '')
    } finally {
      if (current === revision.current) { pending.current = false; setOperation(null) }
    }
  }
  const value = custom ? directory.trim() : ''
  const draft = { cache_directory: value, cache_max_bytes: (capacity ?? 0) * 2 ** 30, cache_min_free_bytes: (reserve ?? 0) * 2 ** 20 }
  const dirty = state !== null && (value !== state.cache_directory || draft.cache_max_bytes !== state.cache_max_bytes || draft.cache_min_free_bytes !== state.cache_min_free_bytes)
  const valid = (!custom || Boolean(value)) && capacity !== null && Number.isInteger(capacity) && capacity >= 1 && capacity <= 4096 && reserve !== null && Number.isInteger(reserve) && reserve >= 64 && reserve <= 65536
  const locked = disabled || busy || !state || !gateway

  return (
    <div className={surfaceStyles.surface}>
      <div className={surfaceStyles.header}>
        <HardDrive size={18} aria-hidden="true" />
        <h2>{t('settings.mount.title')}</h2>
      </div>
      {!gateway ? <Alert type="warning" title={t('settings.mount.unavailable')} /> : null}
      {error !== null ? <Alert type="error" title={error || t('settings.mount.failed')} action={!state ? <Button size="small" onClick={() => void request()} disabled={disabled || busy || !gateway}>{t('app.retry')}</Button> : undefined} /> : null}
      {busy && !state ? <div className={styles.loading}><Spin /></div> : null}
      <div className={styles.body}>
        <div className={styles.directory}>
          <div className={styles.heading}>
            <label htmlFor={inputId}>{t('settings.mount.directory')}</label>
            <Segmented block className={styles['location-switch']} aria-label={t('settings.mount.directory')} disabled={locked} value={custom ? 'custom' : 'default'} options={[
              { value: 'default', label: <span className={styles['location-option']}><HardDrive size={14} aria-hidden="true" />{t('settings.mount.default')}</span> },
              { value: 'custom', label: <span className={styles['location-option']}><FolderOpen size={14} aria-hidden="true" />{t('settings.mount.custom')}</span> },
            ]} onChange={(value) => { setCustom(value === 'custom'); setSaved(false) }} />
          </div>
          {custom ? <div className={styles.input}>
            <Input id={inputId} value={directory} disabled={locked} maxLength={4096}
              placeholder={t('settings.mount.placeholder')}
              onChange={(event) => { setDirectory(event.target.value); setSaved(false) }}
              onPressEnter={() => { if (!locked && dirty && valid) void request(draft) }} />
            {bridge ? <Button aria-label={t('settings.mount.choose')} loading={operation === 'pick'} disabled={locked} icon={<FolderOpen size={16} />} onClick={() => void pick()}>{t('settings.mount.choose')}</Button> : null}
          </div> : <Input id={inputId} readOnly value={state?.default_directory ?? ''} />}
        </div>
        <div className={styles.budgets}>
          <div className={styles.budget}>
            <div><label htmlFor={`${inputId}-capacity`}>{t('settings.mount.capacity')}</label><p id={`${inputId}-capacity-hint`} className={surfaceStyles.hint}>{t('settings.mount.capacityHint')}</p></div>
            <InputNumber id={`${inputId}-capacity`} aria-describedby={`${inputId}-capacity-hint`} value={capacity} min={1} max={4096} precision={0} suffix="GiB" disabled={locked} onChange={(value) => { setCapacity(value); setSaved(false) }} />
          </div>
          <div className={styles.budget}>
            <div><label htmlFor={`${inputId}-reserve`}>{t('settings.mount.reserve')}</label><p id={`${inputId}-reserve-hint`} className={surfaceStyles.hint}>{t('settings.mount.reserveHint')}</p></div>
            <InputNumber id={`${inputId}-reserve`} aria-describedby={`${inputId}-reserve-hint`} value={reserve} min={64} max={65536} precision={0} step={64} suffix="MiB" disabled={locked} onChange={(value) => { setReserve(value); setSaved(false) }} />
          </div>
        </div>
        {state ? <div className={styles.status}>
          <div className={styles.heading}>
            <span>{t('settings.mount.active')}</span>
            {state.restart_required ? <Tag>{t('settings.mount.pending')}</Tag> : null}
          </div>
          <code>{state.active_cache_directory}</code>
          {state.restart_required ? <span>{t('settings.mount.activeBudget', { capacity: state.active_cache_max_bytes / 2 ** 30, reserve: state.active_cache_min_free_bytes / 2 ** 20 })}</span> : null}
          {state.restart_required && state.next_cache_directory && state.next_cache_directory !== state.active_cache_directory ? <>
            <span>{t('settings.mount.next')}</span>
            <code>{state.next_cache_directory}</code>
          </> : null}
          {state.startup_warning ? <Alert type="warning" title={state.startup_warning} /> : null}
        </div> : null}
        {gateway?.mountCache ? <MountCacheUsage gateway={gateway} disabled={disabled} /> : null}
        <div className={styles.footer}>
          <p className={surfaceStyles.hint} role={saved ? 'status' : undefined}>{t(saved ? (state?.restart_required ? 'settings.mount.savedPending' : 'settings.mount.saved') : 'settings.mount.restartHint')}</p>
          <Button aria-label={t('app.save')} type="primary" loading={operation === 'save'} disabled={locked || !dirty || !valid} onClick={() => void request(draft)}>{t('app.save')}</Button>
        </div>
      </div>
    </div>
  )
}

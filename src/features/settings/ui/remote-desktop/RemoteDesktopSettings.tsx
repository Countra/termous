import { InputNumber } from 'antd'
import { MonitorPlay, Timer } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionSettings, ConnectionSettingsPatch } from '#common/contracts'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './RemoteDesktopSettings.module.scss'
import { SystemClipboardSetting } from './SystemClipboardSetting'

interface RemoteDesktopSettingsProps {
  value: ConnectionSettings
  disabled: boolean
  onChange: (patch: ConnectionSettingsPatch) => Promise<void>
}

export function RemoteDesktopSettings({ value, disabled, onChange }: RemoteDesktopSettingsProps) {
  const { t } = useTranslation()
  const id = useId()
  const [minutes, setMinutes] = useState<number | null>(value.rdp_unattended_timeout_minutes)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const pending = useRef(false)
  const dirty = useRef(false)
  const valid = minutes !== null && Number.isInteger(minutes) && minutes >= 1 && minutes <= 30

  useEffect(() => {
    // 保存冲突会刷新外部确认值，尚未确认的本地草稿仍需保留以便重试。
    if (pending.current || dirty.current) return
    setMinutes(value.rdp_unattended_timeout_minutes)
    setSaveFailed(false)
  }, [value.rdp_unattended_timeout_minutes])

  const save = async () => {
    if (!valid || disabled || pending.current) return
    if (minutes === value.rdp_unattended_timeout_minutes) {
      dirty.current = false
      setSaveFailed(false)
      return
    }
    pending.current = true
    setSaving(true)
    setSaveFailed(false)
    try {
      await onChange({ rdp_unattended_timeout_minutes: minutes })
      dirty.current = false
    } catch {
      setSaveFailed(true)
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return (
    <section className={surfaceStyles.surface}>
      <div className={surfaceStyles.header}>
        <MonitorPlay size={18} aria-hidden="true" />
        <h2>{t('settings.rdpSettings')}</h2>
      </div>
      <SystemClipboardSetting disabled={disabled} />
      <div className={styles.row}>
        <Timer size={18} className={styles.icon} aria-hidden="true" />
        <div className={styles.copy}>
          <label htmlFor={id}>{t('settings.rdpUnattendedTimeout')}</label>
          <p id={`${id}-hint`}>{t('settings.rdpUnattendedTimeoutHint')}</p>
        </div>
        <div className={styles.control}>
          <InputNumber<number>
            id={id}
            aria-describedby={`${id}-hint ${id}-status`}
            aria-invalid={!valid}
            aria-valuemin={1}
            aria-valuemax={30}
            step={1}
            changeOnBlur={false}
            value={minutes}
            disabled={disabled || saving}
            status={!valid || saveFailed ? 'error' : undefined}
            onChange={(next) => { dirty.current = next !== value.rdp_unattended_timeout_minutes; setMinutes(next); setSaveFailed(false) }}
            onBlur={() => void save()}
            onPressEnter={() => void save()}
          />
          <span>{t('settings.rdpUnattendedMinutes')}</span>
        </div>
        <p id={`${id}-status`} className={!valid || saveFailed ? styles.error : styles.note} aria-live="polite">
          {!valid ? t('settings.rdpUnattendedInvalid') : saveFailed ? t('settings.rdpUnattendedSaveFailed') : t('settings.rdpUnattendedRange')}
        </p>
      </div>
    </section>
  )
}

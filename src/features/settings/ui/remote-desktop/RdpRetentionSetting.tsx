import { InputNumber } from 'antd'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionSettings, ConnectionSettingsPatch } from '#common/contracts'
import { SettingsDetails, SettingsField } from '../controls/SettingsGroup'
import fieldStyles from '../controls/SettingsGroup.module.scss'
import styles from './RdpRetentionSetting.module.scss'

export function RdpRetentionSetting({ value, disabled, onChange }: {
  value: ConnectionSettings
  disabled: boolean
  onChange: (patch: ConnectionSettingsPatch) => Promise<void>
}) {
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

  return <SettingsField label={t('settings.rdpUnattendedTimeout')} htmlFor={id}
    description={t('settings.rdpUnattendedTimeoutHint')} descriptionId={`${id}-hint`}
    control={<div className={styles.control}>
      <div className={styles.input}>
        <InputNumber<number>
          id={id}
          aria-describedby={`${id}-hint ${id}-range ${id}-status`}
          aria-invalid={!valid}
          aria-busy={saving}
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
      <p id={`${id}-range`} className={styles.range}>{t('settings.rdpUnattendedRange')}</p>
    </div>}>
    <p id={`${id}-status`} className={fieldStyles.error} aria-live="polite">
      {!valid ? t('settings.rdpUnattendedInvalid') : saveFailed ? t('settings.rdpUnattendedSaveFailed') : null}
    </p>
    <SettingsDetails summary={t('settings.rdpRetentionDetailsTitle')}>{t('settings.rdpRetentionDetails')}</SettingsDetails>
  </SettingsField>
}

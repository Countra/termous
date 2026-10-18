import { Switch } from 'antd'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionSettingsPatch } from '#common/contracts'
import { SettingsField } from '../controls/SettingsGroup'
import styles from '../controls/SettingsGroup.module.scss'

type ConnectionToggleKey = Exclude<keyof ConnectionSettingsPatch, 'rdp_unattended_timeout_minutes'>

export function ConnectionToggleSetting({ setting, label, description, checked, disabled, onChange }: {
  setting: ConnectionToggleKey
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (patch: ConnectionSettingsPatch) => Promise<void>
}) {
  const { t } = useTranslation()
  const id = useId()
  const pending = useRef(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const save = async (next: boolean) => {
    if (disabled || pending.current) return
    pending.current = true
    setSaving(true)
    setFailed(false)
    try {
      await onChange({ [setting]: next })
    } catch {
      setFailed(true)
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return <SettingsField label={label} htmlFor={id} description={description} descriptionId={`${id}-hint`}
    control={<Switch id={id} checked={checked} disabled={disabled || saving} loading={saving}
      aria-describedby={`${id}-hint`} onChange={next => void save(next)} />}>
    {failed && <p className={styles.error} role="alert">{t('settings.connectionSaveFailed')}</p>}
  </SettingsField>
}

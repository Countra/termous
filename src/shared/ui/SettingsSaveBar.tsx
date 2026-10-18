import { Button } from 'antd'
import { Check, Circle, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './SettingsSaveBar.module.scss'

interface SettingsSaveBarProps {
  dirty: boolean
  busy: boolean
  saving?: boolean
  invalid: boolean
  ready?: boolean
  saved?: boolean
  onSave(): void
  onReset(): void
}

export function SettingsSaveBar({ dirty, busy, saving = busy, invalid, ready = true, saved, onSave, onReset }: SettingsSaveBarProps) {
  const { t } = useTranslation()
  return <footer className={styles.bar}>
    <span className={styles.status} role="status" aria-live="polite" data-dirty={dirty}>
      {dirty || !ready ? <Circle size={7} fill={dirty ? 'currentColor' : 'none'} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
      {t(busy ? !ready ? 'settings.editor.loading' : saving ? 'settings.editor.saving' : 'settings.editor.processing'
        : !ready ? 'settings.editor.unavailable' : dirty ? 'settings.editor.unsaved' : saved ? 'settings.editor.saved' : 'settings.editor.upToDate')}
    </span>
    <div className={styles.actions}>
      <Button disabled={busy || !dirty} onClick={onReset}>{t('settings.editor.reset')}</Button>
      <Button type="primary" aria-label={t('app.save')} icon={<Save size={14} aria-hidden="true" />} loading={saving}
        disabled={!ready || busy || !dirty || invalid} onClick={onSave}>{t('settings.editor.save')}</Button>
    </div>
  </footer>
}

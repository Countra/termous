import { Input, InputNumber } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import type { FileAccessProfileEditorViewProps } from '../../model/types.ts'
import styles from './SMBProfileEditor.module.scss'

export function SMBProfileEditor({ draft, errors, disabled, onChange }: FileAccessProfileEditorViewProps) {
  const { t } = useTranslation()
  const [advanced, setAdvanced] = useState(false)
  if (draft.engine !== 'smb') return null
  const showAdvanced = advanced || Boolean(errors?.port || errors?.domain || errors?.root_path)
  return (
    <div className={styles.form}>
      {(['name', 'host', 'share', 'username'] as const).map((field) => (
        <label className={`${styles.field} ${field === 'name' || field === 'host' ? styles.wide : ''}`} key={field}>
          <span className={styles.label}>{t(`files.smb.${field}`)}</span>
          <Input aria-label={t(`files.smb.${field}`)} value={draft[field]} disabled={disabled} autoComplete="off" maxLength={field === 'name' ? 80 : field === 'username' ? 256 : 255}
            placeholder={field === 'host' ? 'smb.example.com' : undefined} status={errors?.[field] ? 'error' : undefined}
            onChange={(event) => onChange({ ...draft, [field]: event.target.value })} />
          {errors?.[field] ? <small role="alert">{t(field === 'name' ? `hosts.access.errors.${errors.name === 'too_long' ? 'tooLong' : 'required'}` : `files.smb.errors.${field}`)}</small> : null}
        </label>
      ))}
      <label className={`${styles.field} ${styles.wide}`}>
        <span className={styles.label}>{t('files.smb.password')}</span>
        <Input.Password aria-label={t('files.smb.password')} value={draft.password} disabled={disabled} autoComplete="new-password" status={errors?.password ? 'error' : undefined}
          placeholder={draft.password_configured ? t('files.smb.configured') : undefined}
          onChange={(event) => onChange({ ...draft, password: event.target.value })} />
        {errors?.password ? <small role="alert">{t('files.smb.errors.password')}</small> : null}
      </label>
      <button type="button" className={styles['advanced-toggle']} aria-expanded={showAdvanced} onClick={() => setAdvanced(!showAdvanced)}>
        {t('files.smb.advanced')}<ChevronDown size={14} aria-hidden="true" className={showAdvanced ? styles.expanded : undefined} />
      </button>
      {showAdvanced ? <>
        <label className={styles.field}>
          <span className={styles.label}>{t('files.smb.port')}</span>
          <InputNumber aria-label={t('files.smb.port')} value={draft.port} min={1} max={65535} precision={0} disabled={disabled} status={errors?.port ? 'error' : undefined}
            onChange={(port) => { setAdvanced(true); onChange({ ...draft, port }) }} />
          {errors?.port ? <small role="alert">{t('files.smb.errors.port')}</small> : null}
        </label>
        {(['domain', 'root_path'] as const).map((field) => <label className={`${styles.field} ${field === 'root_path' ? styles.wide : ''}`} key={field}>
          <span className={styles.label}>{t(`files.smb.${field}`)}</span>
          <Input aria-label={t(`files.smb.${field}`)} value={draft[field]} disabled={disabled} placeholder={field === 'root_path' ? '/' : undefined} status={errors?.[field] ? 'error' : undefined}
            onChange={(event) => { setAdvanced(true); onChange({ ...draft, [field]: event.target.value }) }} />
          {errors?.[field] ? <small role="alert">{t(`files.smb.errors.${field}`)}</small> : null}
        </label>)}
      </> : null}
      <p className={styles.hint}>{t('files.smb.authHint')}</p>
    </div>
  )
}

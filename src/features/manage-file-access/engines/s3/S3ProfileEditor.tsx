import { Checkbox, Input, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { customSelectStyles } from '#shared/ui'
import type { FileAccessProfileEditorViewProps } from '../../model/types.ts'
import styles from './S3ProfileEditor.module.scss'

export function S3ProfileEditor({ draft, errors, disabled, onChange }: FileAccessProfileEditorViewProps) {
  const { t } = useTranslation()
  if (draft.engine !== 's3') return null
  return (
    <div className={styles.form}>
      {(['name', 'endpoint', 'bucket', 'prefix', 'region'] as const).map((field) => (
        <label className={`${styles.field} ${field === 'name' || field === 'endpoint' ? styles.wide : ''}`} key={field}>
          <span className={styles.label}>{t(`files.s3.${field}`)}</span>
          <Input value={draft[field]} disabled={disabled} autoComplete="off" maxLength={field === 'name' ? 80 : 1024}
            status={field in (errors ?? {}) && errors?.[field as keyof typeof errors] ? 'error' : undefined}
            onChange={(event) => onChange({ ...draft, [field]: event.target.value })} />
          {field in (errors ?? {}) && errors?.[field as keyof typeof errors] ? <small role="alert">{t(field === 'name' ? `hosts.access.errors.${errors?.name === 'too_long' ? 'tooLong' : 'required'}` : `files.s3.errors.${field}`)}</small> : null}
        </label>
      ))}
      <label className={styles.field}>
        <span className={styles.label}>{t('files.s3.addressing')}</span>
        <Select value={draft.addressing_style} disabled={disabled}
          classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
          options={(['path', 'virtual', 'auto'] as const).map((value) => ({ value, label: t(`files.s3.addressingOptions.${value}`) }))}
          onChange={(addressing_style) => onChange({ ...draft, addressing_style })} />
      </label>
      {(['access_key', 'secret_key', 'session_token'] as const).map((slot) => (
        <label className={`${styles.field} ${slot === 'session_token' ? styles.wide : ''}`} key={slot}>
          <span className={styles.label}>{t(`files.s3.${slot}`)}</span>
          <Input.Password value={draft[slot]} disabled={disabled || slot === 'session_token' && draft.clear_session_token} autoComplete="new-password"
            placeholder={draft.configured_slots.includes(slot) ? t('files.s3.configured') : undefined}
            status={slot !== 'session_token' && errors?.[slot] ? 'error' : undefined}
            onChange={(event) => onChange({ ...draft, [slot]: event.target.value })} />
          {slot !== 'session_token' && errors?.[slot] ? <small role="alert">{t('files.s3.requiredSecret')}</small> : null}
        </label>
      ))}
      {draft.configured_slots.includes('session_token') ? <Checkbox className={styles['clear-token']} disabled={disabled} checked={draft.clear_session_token} onChange={(event) => onChange({ ...draft, clear_session_token: event.target.checked })}>{t('files.s3.clearToken')}</Checkbox> : null}
      <p className={styles.hint}>{t(draft.endpoint.startsWith('http://') ? 'files.s3.httpHint' : 'files.s3.authHint')}</p>
    </div>
  )
}

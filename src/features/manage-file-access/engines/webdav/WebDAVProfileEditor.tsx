import { Input } from 'antd'
import { useTranslation } from 'react-i18next'
import type { FileAccessProfileEditorViewProps } from '../../model/types.ts'
import styles from './WebDAVProfileEditor.module.scss'

export function WebDAVProfileEditor({ draft, errors, disabled, onChange }: FileAccessProfileEditorViewProps) {
  const { t } = useTranslation()
  if (draft.engine !== 'webdav') return null
  return (
    <div className={styles.form}>
      {(['name', 'endpoint', 'username'] as const).map((field) => (
        <label className={styles.field} key={field}>
          <span className={styles.label}>{t(`files.webdav.${field}`)}</span>
          <Input value={draft[field]} disabled={disabled} autoComplete="off" maxLength={field === 'name' ? 80 : 2048}
            placeholder={field === 'endpoint' ? 'https://example.com/dav/' : undefined}
            status={errors?.[field] ? 'error' : undefined}
            onChange={(event) => onChange({ ...draft, [field]: event.target.value })} />
          {errors?.[field] ? <small role="alert">{t(field === 'name' ? `hosts.access.errors.${errors.name === 'too_long' ? 'tooLong' : 'required'}` : `files.webdav.errors.${field}`)}</small> : null}
        </label>
      ))}
      <label className={styles.field}>
        <span className={styles.label}>{t('files.webdav.password')}</span>
        <Input.Password value={draft.password} disabled={disabled} autoComplete="new-password"
          placeholder={draft.password_configured ? t('files.webdav.configured') : undefined}
          status={errors?.password ? 'error' : undefined}
          onChange={(event) => onChange({ ...draft, password: event.target.value })} />
        {errors?.password ? <small role="alert">{t('files.webdav.errors.password')}</small> : null}
      </label>
      <p className={styles.hint}>{t(/^http:\/\//iu.test(draft.endpoint.trim()) ? 'files.webdav.httpHint' : 'files.webdav.authHint')}</p>
    </div>
  )
}

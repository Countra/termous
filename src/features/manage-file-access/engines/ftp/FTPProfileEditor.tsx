import { Input, InputNumber, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { customSelectStyles } from '#shared/ui'
import type { FileAccessProfileEditorViewProps, FTPProfileDraft } from '../../model/types.ts'
import styles from './FTPProfileEditor.module.scss'

export function FTPProfileEditor({ draft, errors, disabled, onChange }: FileAccessProfileEditorViewProps) {
  const { t } = useTranslation()
  if (draft.engine !== 'ftp') return null
  const defaultPort = (security: FTPProfileDraft['security']) => security === 'implicit_tls' ? 990 : 21
  return (
    <div className={styles.form}>
      {(['name', 'host'] as const).map((field) => (
        <label className={`${styles.field} ${styles.wide}`} key={field}>
          <span className={styles.label}>{t(`files.ftp.${field}`)}</span>
          <Input aria-label={t(`files.ftp.${field}`)} value={draft[field]} disabled={disabled} autoComplete="off" maxLength={field === 'name' ? 80 : 253}
            placeholder={field === 'host' ? 'ftp.example.com' : undefined} status={errors?.[field] ? 'error' : undefined}
            onChange={(event) => onChange({ ...draft, [field]: event.target.value })} />
          {errors?.[field] ? <small role="alert">{t(field === 'name' ? `hosts.access.errors.${errors.name === 'too_long' ? 'tooLong' : 'required'}` : 'files.ftp.errors.host')}</small> : null}
        </label>
      ))}
      <label className={styles.field}>
        <span className={styles.label}>{t('files.ftp.security')}</span>
        <Select aria-label={t('files.ftp.security')} value={draft.security} disabled={disabled}
          classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
          options={(['none', 'explicit_tls', 'implicit_tls'] as const).map((value) => ({ value, label: t(`files.ftp.securityOptions.${value}`) }))}
          onChange={(security: FTPProfileDraft['security']) => onChange({ ...draft, security, port: draft.port === defaultPort(draft.security) ? defaultPort(security) : draft.port })} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t('files.ftp.port')}</span>
        <InputNumber aria-label={t('files.ftp.port')} value={draft.port} min={1} max={65535} precision={0} disabled={disabled} status={errors?.port ? 'error' : undefined}
          onChange={(port) => onChange({ ...draft, port })} />
        {errors?.port ? <small role="alert">{t('files.ftp.errors.port')}</small> : null}
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t('files.ftp.username')}</span>
        <Input aria-label={t('files.ftp.username')} value={draft.username} disabled={disabled} autoComplete="off" status={errors?.username ? 'error' : undefined}
          onChange={(event) => onChange({ ...draft, username: event.target.value })} />
        {errors?.username ? <small role="alert">{t('files.ftp.errors.username')}</small> : null}
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t('files.ftp.password')}</span>
        <Input.Password aria-label={t('files.ftp.password')} value={draft.password} disabled={disabled} autoComplete="new-password" status={errors?.password ? 'error' : undefined}
          placeholder={draft.password_configured ? t('files.ftp.configured') : undefined}
          onChange={(event) => onChange({ ...draft, password: event.target.value })} />
        {errors?.password ? <small role="alert">{t('files.ftp.errors.password')}</small> : null}
      </label>
      <label className={`${styles.field} ${styles.wide}`}>
        <span className={styles.label}>{t('files.ftp.root_path')}</span>
        <Input aria-label={t('files.ftp.root_path')} value={draft.root_path} disabled={disabled} placeholder="/" status={errors?.root_path ? 'error' : undefined}
          onChange={(event) => onChange({ ...draft, root_path: event.target.value })} />
        {errors?.root_path ? <small role="alert">{t('files.ftp.errors.root_path')}</small> : null}
      </label>
      <p className={styles.hint}>{t(draft.security === 'none' ? 'files.ftp.plainHint' : 'files.ftp.tlsHint')}</p>
      <p className={styles.hint}>{t('files.ftp.writeHint')}</p>
    </div>
  )
}

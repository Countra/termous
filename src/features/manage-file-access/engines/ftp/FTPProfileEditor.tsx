import { Input, InputNumber, Select } from 'antd'
import { Server, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { customSelectStyles } from '#shared/ui'
import type { FileAccessProfileEditorViewProps, FTPProfileDraft } from '../../model/types.ts'
import { FileProfileField, FileProfileForm, FileProfileSection } from '../../ui/FileProfileForm.tsx'
import styles from '../../ui/FileProfileForm.module.scss'

export function FTPProfileEditor(props: FileAccessProfileEditorViewProps) {
  const { draft, errors, disabled, onChange } = props
  const { t } = useTranslation()
  if (draft.engine !== 'ftp') return null
  const defaultPort = (security: FTPProfileDraft['security']) => security === 'implicit_tls' ? 990 : 21
  const error = (field: 'host' | 'port' | 'username' | 'password' | 'root_path') => errors?.[field] ? t(`files.ftp.errors.${field}`) : undefined
  return <FileProfileForm {...props} nameLabel={t('files.ftp.name')}>
    <FileProfileSection title={t('hosts.access.file.sections.server')} icon={<Server size={15} />}>
      <div className={styles.stack}>
        <div className={styles['endpoint-grid']}>
          <FileProfileField label={t('files.ftp.host')} error={error('host')}>
            {controlProps => <Input {...controlProps} value={draft.host} disabled={disabled} autoComplete="off" maxLength={253}
              placeholder="ftp.example.com" status={errors?.host ? 'error' : undefined}
              onChange={event => onChange({ ...draft, host: event.target.value })} />}
          </FileProfileField>
          <FileProfileField label={t('files.ftp.port')} error={error('port')}>
            {controlProps => <InputNumber {...controlProps} value={draft.port} min={1} max={65535} precision={0} disabled={disabled} status={errors?.port ? 'error' : undefined}
              onChange={port => onChange({ ...draft, port })} />}
          </FileProfileField>
        </div>
        <FileProfileField label={t('files.ftp.security')}>
          {controlProps => <Select {...controlProps} value={draft.security} disabled={disabled}
            classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
            options={(['none', 'explicit_tls', 'implicit_tls'] as const).map(value => ({ value, label: t(`files.ftp.securityOptions.${value}`) }))}
            onChange={(security: FTPProfileDraft['security']) => onChange({ ...draft, security, port: draft.port === defaultPort(draft.security) ? defaultPort(security) : draft.port })} />}
        </FileProfileField>
        <FileProfileField label={t('files.ftp.root_path')} error={error('root_path')}>
          {controlProps => <Input {...controlProps} value={draft.root_path} disabled={disabled} placeholder="/" status={errors?.root_path ? 'error' : undefined}
            onChange={event => onChange({ ...draft, root_path: event.target.value })} />}
        </FileProfileField>
      </div>
      <p className={`${styles.hint} ${styles.notice}`}>{t('files.ftp.writeHint')}</p>
    </FileProfileSection>
    <FileProfileSection title={t('hosts.access.file.sections.authentication')} icon={<ShieldCheck size={15} />}>
      <div className={styles.stack}>
        <FileProfileField label={t('files.ftp.username')} error={error('username')}>
          {controlProps => <Input {...controlProps} value={draft.username} disabled={disabled} autoComplete="off" status={errors?.username ? 'error' : undefined}
            onChange={event => onChange({ ...draft, username: event.target.value })} />}
        </FileProfileField>
        <FileProfileField label={t('files.ftp.password')} error={error('password')}>
          {controlProps => <Input.Password {...controlProps} value={draft.password} disabled={disabled} autoComplete="new-password" status={errors?.password ? 'error' : undefined}
            placeholder={draft.password_configured ? t('files.ftp.configured') : undefined}
            onChange={event => onChange({ ...draft, password: event.target.value })} />}
        </FileProfileField>
      </div>
      <p className={`${styles.hint} ${styles.notice}`}>{t(draft.security === 'none' ? 'files.ftp.plainHint' : 'files.ftp.tlsHint')}</p>
    </FileProfileSection>
  </FileProfileForm>
}

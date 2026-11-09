import { Checkbox, Input, Select } from 'antd'
import { Database, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { customSelectStyles } from '#shared/ui'
import type { FileAccessProfileEditorViewProps } from '../../model/types.ts'
import { FileProfileField, FileProfileForm, FileProfileSection } from '../../ui/FileProfileForm.tsx'
import styles from '../../ui/FileProfileForm.module.scss'

export function S3ProfileEditor(props: FileAccessProfileEditorViewProps) {
  const { draft, errors, disabled, onChange } = props
  const { t } = useTranslation()
  if (draft.engine !== 's3') return null
  return <FileProfileForm {...props} nameLabel={t('files.s3.name')}>
    <FileProfileSection title={t('hosts.access.file.sections.storage')} icon={<Database size={15} />}>
      <div className={styles.grid}>
        {(['endpoint', 'bucket', 'prefix', 'region'] as const).map(field => {
          const invalid = field !== 'region' && errors?.[field]
          return <FileProfileField key={field} wide={field === 'endpoint'} label={t(`files.s3.${field}`)} error={invalid ? t(`files.s3.errors.${field}`) : undefined}>
            {controlProps => <Input {...controlProps} value={draft[field]} disabled={disabled} autoComplete="off" maxLength={1024}
              placeholder={field === 'endpoint' ? 'https://s3.example.com' : undefined}
              status={invalid ? 'error' : undefined} onChange={event => onChange({ ...draft, [field]: event.target.value })} />}
          </FileProfileField>
        })}
        <FileProfileField label={t('files.s3.addressing')}>
          {controlProps => <Select {...controlProps} value={draft.addressing_style} disabled={disabled}
            classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
            options={(['path', 'virtual', 'auto'] as const).map(value => ({ value, label: t(`files.s3.addressingOptions.${value}`) }))}
            onChange={addressing_style => onChange({ ...draft, addressing_style })} />}
        </FileProfileField>
      </div>
    </FileProfileSection>
    <FileProfileSection title={t('hosts.access.file.sections.authentication')} icon={<ShieldCheck size={15} />}>
      <div className={styles.stack}>
        {(['access_key', 'secret_key', 'session_token'] as const).map(slot => {
          const invalid = slot !== 'session_token' && errors?.[slot]
          return <FileProfileField key={slot} label={t(`files.s3.${slot}`)} error={invalid ? t('files.s3.requiredSecret') : undefined}>
            {controlProps => <Input.Password {...controlProps} value={draft[slot]} disabled={disabled || slot === 'session_token' && draft.clear_session_token} autoComplete="new-password"
              placeholder={draft.configured_slots.includes(slot) ? t('files.s3.configured') : undefined}
              status={invalid ? 'error' : undefined} onChange={event => onChange({ ...draft, [slot]: event.target.value })} />}
          </FileProfileField>
        })}
        {draft.configured_slots.includes('session_token') ? <Checkbox disabled={disabled} checked={draft.clear_session_token}
          onChange={event => onChange({ ...draft, clear_session_token: event.target.checked })}>{t('files.s3.clearToken')}</Checkbox> : null}
      </div>
      <p className={`${styles.hint} ${styles.notice}`}>{t(/^http:\/\//iu.test(draft.endpoint.trim()) ? 'files.s3.httpHint' : 'files.s3.authHint')}</p>
    </FileProfileSection>
  </FileProfileForm>
}

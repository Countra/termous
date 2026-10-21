import { Input } from 'antd'
import { Globe2, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FileAccessProfileEditorViewProps } from '../../model/types.ts'
import { FileProfileField, FileProfileForm, FileProfileSection } from '../../ui/FileProfileForm.tsx'
import styles from '../../ui/FileProfileForm.module.scss'

export function WebDAVProfileEditor(props: FileAccessProfileEditorViewProps) {
  const { draft, errors, disabled, onChange } = props
  const { t } = useTranslation()
  if (draft.engine !== 'webdav') return null
  const error = (field: 'endpoint' | 'username' | 'password') => errors?.[field] ? t(`files.webdav.errors.${field}`) : undefined
  return <FileProfileForm {...props} nameLabel={t('files.webdav.name')}>
    <FileProfileSection title={t('hosts.access.file.sections.server')} icon={<Globe2 size={15} />}>
      <FileProfileField label={t('files.webdav.endpoint')} error={error('endpoint')}>
        {controlProps => <Input {...controlProps} value={draft.endpoint} disabled={disabled} autoComplete="off" maxLength={2048}
          placeholder="https://example.com/dav/" status={errors?.endpoint ? 'error' : undefined}
          onChange={event => onChange({ ...draft, endpoint: event.target.value })} />}
      </FileProfileField>
      <p className={`${styles.hint} ${styles.notice}`}>{t(/^http:\/\//iu.test(draft.endpoint.trim()) ? 'files.webdav.httpHint' : 'files.webdav.authHint')}</p>
    </FileProfileSection>
    <FileProfileSection title={t('hosts.access.file.sections.authentication')} icon={<ShieldCheck size={15} />}>
      <div className={styles.stack}>
        <FileProfileField label={t('files.webdav.username')} error={error('username')}>
          {controlProps => <Input {...controlProps} value={draft.username} disabled={disabled} autoComplete="off" maxLength={2048}
            status={errors?.username ? 'error' : undefined} onChange={event => onChange({ ...draft, username: event.target.value })} />}
        </FileProfileField>
        <FileProfileField label={t('files.webdav.password')} error={error('password')}>
          {controlProps => <Input.Password {...controlProps} value={draft.password} disabled={disabled} autoComplete="new-password"
            placeholder={draft.password_configured ? t('files.webdav.configured') : undefined}
            status={errors?.password ? 'error' : undefined} onChange={event => onChange({ ...draft, password: event.target.value })} />}
        </FileProfileField>
      </div>
    </FileProfileSection>
  </FileProfileForm>
}

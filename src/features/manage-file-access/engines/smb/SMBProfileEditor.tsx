import { Input, InputNumber } from 'antd'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Server, Settings2, ShieldCheck } from 'lucide-react'
import type { FileAccessProfileEditorViewProps } from '../../model/types.ts'
import { FileProfileField, FileProfileForm, FileProfileSection } from '../../ui/FileProfileForm.tsx'
import formStyles from '../../ui/FileProfileForm.module.scss'
import styles from './SMBProfileEditor.module.scss'

export function SMBProfileEditor(props: FileAccessProfileEditorViewProps) {
  const { draft, errors, disabled, onChange } = props
  const { t } = useTranslation()
  const [advanced, setAdvanced] = useState(false)
  const advancedId = useId()
  if (draft.engine !== 'smb') return null
  const showAdvanced = advanced || Boolean(errors?.port || errors?.domain || errors?.root_path)
  const error = (field: 'host' | 'share' | 'username' | 'password' | 'port' | 'domain' | 'root_path') => errors?.[field] ? t(`files.smb.errors.${field}`) : undefined
  return <FileProfileForm {...props} nameLabel={t('files.smb.name')}>
    <FileProfileSection title={t('hosts.access.file.sections.server')} icon={<Server size={15} />}>
      <div className={formStyles.stack}>
        {(['host', 'share'] as const).map(field => <FileProfileField key={field} label={t(`files.smb.${field}`)} error={error(field)}>
          {controlProps => <Input {...controlProps} value={draft[field]} disabled={disabled} autoComplete="off" maxLength={255}
            placeholder={field === 'host' ? 'smb.example.com' : undefined} status={errors?.[field] ? 'error' : undefined}
            onChange={event => onChange({ ...draft, [field]: event.target.value })} />}
        </FileProfileField>)}
      </div>
    </FileProfileSection>
    <FileProfileSection title={t('hosts.access.file.sections.authentication')} icon={<ShieldCheck size={15} />}>
      <div className={formStyles.stack}>
        <FileProfileField label={t('files.smb.username')} error={error('username')}>
          {controlProps => <Input {...controlProps} value={draft.username} disabled={disabled} autoComplete="off" maxLength={256} status={errors?.username ? 'error' : undefined}
            onChange={event => onChange({ ...draft, username: event.target.value })} />}
        </FileProfileField>
        <FileProfileField label={t('files.smb.password')} error={error('password')}>
          {controlProps => <Input.Password {...controlProps} value={draft.password} disabled={disabled} autoComplete="new-password" status={errors?.password ? 'error' : undefined}
            placeholder={draft.password_configured ? t('files.smb.configured') : undefined}
            onChange={event => onChange({ ...draft, password: event.target.value })} />}
        </FileProfileField>
      </div>
      <p className={`${formStyles.hint} ${formStyles.notice}`}>{t('files.smb.authHint')}</p>
    </FileProfileSection>
    <div className={`${formStyles.section} ${formStyles.wide}`}>
      <button type="button" className={styles['advanced-toggle']} disabled={disabled} aria-expanded={showAdvanced} aria-controls={advancedId} onClick={() => setAdvanced(!showAdvanced)}>
        <span><Settings2 size={15} aria-hidden="true" />{t('files.smb.advanced')}</span>
        <ChevronDown size={14} aria-hidden="true" className={showAdvanced ? styles.expanded : undefined} />
      </button>
      <div id={advancedId} hidden={!showAdvanced}>
        {showAdvanced ? <div className={`${formStyles.grid} ${styles.advanced}`}>
          <FileProfileField label={t('files.smb.port')} error={error('port')}>
            {controlProps => <InputNumber {...controlProps} value={draft.port} min={1} max={65535} precision={0} disabled={disabled} status={errors?.port ? 'error' : undefined}
              onChange={port => { setAdvanced(true); onChange({ ...draft, port }) }} />}
          </FileProfileField>
          {(['domain', 'root_path'] as const).map(field => <FileProfileField key={field} wide={field === 'root_path'} label={t(`files.smb.${field}`)} error={error(field)}>
            {controlProps => <Input {...controlProps} value={draft[field]} disabled={disabled} placeholder={field === 'root_path' ? '/' : undefined} status={errors?.[field] ? 'error' : undefined}
              onChange={event => { setAdvanced(true); onChange({ ...draft, [field]: event.target.value }) }} />}
          </FileProfileField>)}
        </div> : null}
      </div>
    </div>
  </FileProfileForm>
}

import { Select } from 'antd'
import { Cable, Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { customSelectStyles } from '#shared/ui'
import type { FileAccessProfileEditorViewProps } from '../../model/types.ts'
import { FileProfileField, FileProfileForm, FileProfileSection } from '../../ui/FileProfileForm.tsx'
import formStyles from '../../ui/FileProfileForm.module.scss'
import styles from './SFTPProfileEditor.module.scss'

interface SFTPProfileEditorProps extends FileAccessProfileEditorViewProps {
  bindingLocked?: boolean
}

export function SFTPProfileEditor(props: SFTPProfileEditorProps) {
  const { draft, sshProfiles, errors, disabled, bindingLocked, onChange } = props
  const { t } = useTranslation()
  if (draft.engine !== 'sftp') return null
  const profiles = sshProfiles.filter(profile => profile.host_id === draft.host_id)
  const selected = profiles.find(profile => profile.id === draft.ssh_profile_id)
  const error = errors?.ssh_profile_id ? t(errors.ssh_profile_id === 'unavailable' ? 'hosts.access.file.missingSSHDescription' : 'hosts.access.file.sshRequired') : undefined
  return <FileProfileForm {...props} autoFocus>
    <FileProfileSection title={t('hosts.access.file.binding')} icon={<Link2 size={15} />}>
      <FileProfileField label={t('hosts.access.file.sshProfile')} error={error}>
        {controlProps => <Select {...controlProps}
          classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
          value={selected ? selected.id : undefined}
          placeholder={t(profiles.length ? 'hosts.access.file.selectSSH' : 'hosts.access.file.noSSH')}
          disabled={disabled || bindingLocked || profiles.length === 0}
          status={errors?.ssh_profile_id ? 'error' : undefined}
          options={profiles.map(profile => ({ value: profile.id, label: profile.name || `${profile.username}@${profile.address}` }))}
          onChange={sshProfileId => onChange({ ...draft, ssh_profile_id: sshProfileId })}
        />}
      </FileProfileField>
      <p className={`${formStyles.hint} ${formStyles.notice}`}>{t(bindingLocked ? 'hosts.access.file.companionHint' : 'hosts.access.file.bindingHint')}</p>
    </FileProfileSection>
    <FileProfileSection title={t('hosts.access.file.sections.connection')} icon={<Cable size={15} />}>
      {selected ? <>
        <strong className={styles.name}>{selected.name || t('hosts.access.file.sshProfile')}</strong>
        <dl className={styles.details}>
          <div><dt>{t('hosts.address')}</dt><dd>{selected.address}</dd></div>
          <div><dt>{t('hosts.port')}</dt><dd>{selected.port}</dd></div>
          <div><dt>{t('hosts.username')}</dt><dd>{selected.username}</dd></div>
          <div><dt>{t('hosts.authMethod')}</dt><dd>{t(`hosts.auth.${selected.auth_method}`)}</dd></div>
        </dl>
      </> : <p className={formStyles.hint}>{t(draft.ssh_profile_id ? 'hosts.access.file.missingSSHDescription' : profiles.length ? 'hosts.access.file.selectSSH' : 'hosts.access.file.noSSHHint')}</p>}
    </FileProfileSection>
  </FileProfileForm>
}

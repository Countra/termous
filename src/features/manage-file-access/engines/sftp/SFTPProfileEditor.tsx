import { Input, Select } from 'antd'
import { Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { customSelectStyles } from '#shared/ui'
import type { FileAccessProfileEditorViewProps } from '../../model/types.ts'
import styles from './SFTPProfileEditor.module.scss'

export function SFTPProfileEditor({
  draft,
  sshProfiles,
  errors,
  disabled,
  onChange,
}: FileAccessProfileEditorViewProps) {
  const { t } = useTranslation()
  if (draft.engine !== 'sftp') return null

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>{t('hosts.access.profileName')}</span>
        <Input
          value={draft.name}
          maxLength={80}
          autoFocus
          status={errors?.name ? 'error' : undefined}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        {errors?.name ? <small role="alert">{t(`hosts.access.errors.${errors.name === 'too_long' ? 'tooLong' : 'required'}`)}</small> : null}
      </label>
      <label className={styles.field}>
        <span>{t('hosts.access.file.binding')}</span>
        <Select
          classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
          value={draft.ssh_profile_id || undefined}
          placeholder={t('hosts.access.file.selectSSH')}
          disabled={disabled}
          status={errors?.ssh_profile_id ? 'error' : undefined}
          options={sshProfiles.map((profile) => ({
            value: profile.id,
            label: profile.name || `${profile.username}@${profile.address}`,
          }))}
          onChange={(sshProfileId) => onChange({ ...draft, ssh_profile_id: sshProfileId })}
        />
        {errors?.ssh_profile_id ? <small role="alert">{t('hosts.access.file.sshRequired')}</small> : null}
      </label>
      <section className={styles.binding} aria-label={t('hosts.access.file.binding')}>
        <span className={styles['binding-icon']} aria-hidden="true"><Link2 size={17} /></span>
        <span className={styles['binding-copy']}>
          <strong>{sshProfiles.find((profile) => profile.id === draft.ssh_profile_id)?.name || t('hosts.access.file.missingSSH')}</strong>
          <small>
            {sshProfiles.find((profile) => profile.id === draft.ssh_profile_id)
              ? (() => {
                  const profile = sshProfiles.find((item) => item.id === draft.ssh_profile_id)!
                  return `${profile.username}@${profile.address}:${profile.port}`
                })()
              : t('hosts.access.file.missingSSHDescription')}
          </small>
        </span>
      </section>
      <p className={styles.hint}>{t('hosts.access.file.bindingHint')}</p>
    </div>
  )
}

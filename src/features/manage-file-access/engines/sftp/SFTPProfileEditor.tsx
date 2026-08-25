import { Input } from 'antd'
import { Link2, LockKeyhole } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FileAccessProfileMetadataInput } from '#entities/file-access-profile'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import styles from './SFTPProfileEditor.module.scss'

interface SFTPProfileEditorProps {
  draft: FileAccessProfileMetadataInput
  sshProfile?: SSHAccessProfile
  error?: string
  disabled: boolean
  onChange: (draft: FileAccessProfileMetadataInput) => void
}

export function SFTPProfileEditor({
  draft,
  sshProfile,
  error,
  disabled,
  onChange,
}: SFTPProfileEditorProps) {
  const { t } = useTranslation()

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>{t('hosts.access.profileName')}</span>
        <Input
          value={draft.name}
          maxLength={80}
          autoFocus
          status={error ? 'error' : undefined}
          disabled={disabled}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        {error ? <small role="alert">{error}</small> : null}
      </label>
      <section className={styles.binding} aria-label={t('hosts.access.file.binding')}>
        <span className={styles['binding-icon']} aria-hidden="true"><Link2 size={17} /></span>
        <span className={styles['binding-copy']}>
          <strong>{sshProfile?.name || t('hosts.access.file.missingSSH')}</strong>
          <small>
            {sshProfile
              ? `${sshProfile.username}@${sshProfile.address}:${sshProfile.port}`
              : t('hosts.access.file.missingSSHDescription')}
          </small>
        </span>
        <span className={styles.locked}><LockKeyhole size={12} />{t('hosts.access.file.fixedBinding')}</span>
      </section>
      <p className={styles.hint}>{t('hosts.access.file.bindingHint')}</p>
    </div>
  )
}

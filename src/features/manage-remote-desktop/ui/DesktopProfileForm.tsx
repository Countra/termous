import { Input } from 'antd'
import { FileText } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ProfileEditorField, ProfileEditorSectionHeading } from '#shared/ui'
import styles from './DesktopProfileForm.module.scss'

interface Identity {
  name: string
  description: string
}
interface Props {
  draft: Identity
  nameError?: string
  disabled: boolean
  onChange: (patch: Partial<Identity>) => void
  children: ReactNode
}

export function DesktopProfileForm({ draft, nameError, disabled, onChange, children }: Props) {
  const { t } = useTranslation()
  const id = useId()
  return <div className={styles.form}>
    <section className={`${styles.section} ${styles.identity}`} aria-labelledby={id}>
      <ProfileEditorSectionHeading
        classNames={styles} id={id}
        icon={<FileText size={16} />} title={t('remoteDesktop.basicSection')}
      />
      <div className={styles['identity-grid']}>
        <ProfileEditorField classNames={styles} label={t('hosts.access.profileName')} error={nameError}>
          {controlProps => <Input
            {...controlProps} name="name" disabled={disabled}
            status={nameError ? 'error' : undefined} maxLength={80}
            placeholder={t('remoteDesktop.profileNamePlaceholder')}
            value={draft.name} onChange={event => onChange({ name: event.target.value })}
          />}
        </ProfileEditorField>
        <ProfileEditorField classNames={styles} label={t('remoteDesktop.description')}>
          {controlProps => <Input.TextArea
            {...controlProps} autoSize={{ minRows: 1, maxRows: 3 }}
            disabled={disabled} maxLength={240}
            placeholder={t('remoteDesktop.editor.descriptionPlaceholder')}
            value={draft.description} onChange={event => onChange({ description: event.target.value })}
          />}
        </ProfileEditorField>
      </div>
    </section>
    <div className={styles.sections}>{children}</div>
  </div>
}

import { Input } from 'antd'
import { useId, type ComponentProps, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ProfileEditorField, ProfileEditorSectionHeading } from '#shared/ui'
import type { FileAccessProfileEditorViewProps } from '../model/types.ts'
import styles from './FileProfileForm.module.scss'

interface FormProps extends Pick<FileAccessProfileEditorViewProps, 'draft' | 'errors' | 'disabled' | 'protocolControl' | 'onChange'> {
  nameLabel?: string
  autoFocus?: boolean
  children: ReactNode
}

export function FileProfileForm({ draft, errors, disabled, protocolControl, onChange, nameLabel, autoFocus, children }: FormProps) {
  const { t } = useTranslation()
  const nameError = errors?.name ? t(`hosts.access.errors.${errors.name === 'too_long' ? 'tooLong' : 'required'}`) : undefined
  return <div className={styles.form}>
    <div className={`${styles.identity} ${protocolControl ? styles['with-protocol'] : ''}`}>
      {protocolControl ? <div className={styles['protocol-field']}>{protocolControl}</div> : null}
      <FileProfileField label={nameLabel ?? t('hosts.access.profileName')} error={nameError}>
        {controlProps => <Input
          {...controlProps} value={draft.name} maxLength={80} autoFocus={autoFocus} autoComplete="off"
          status={nameError ? 'error' : undefined} disabled={disabled}
          onChange={event => onChange({ ...draft, name: event.target.value })}
        />}
      </FileProfileField>
    </div>
    <div className={styles.sections}>{children}</div>
  </div>
}

export function FileProfileSection({ title, icon, children }: {
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return <section className={styles.section} aria-labelledby={id}>
    <ProfileEditorSectionHeading classNames={styles} id={id} icon={icon} title={title} />
    {children}
  </section>
}

export function FileProfileField({ wide, ...props }: Omit<ComponentProps<typeof ProfileEditorField>, 'classNames' | 'className'> & { wide?: boolean }) {
  return <ProfileEditorField {...props} classNames={styles} className={wide ? styles.wide : undefined} />
}

import { Input, InputNumber, Radio } from 'antd'
import { FileKey2, KeyRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionProxy } from '#entities/connection-proxy'
import type { CredentialView } from '#entities/credential'
import type {
  SSHAccessProfile,
  SSHAccessProfileDraft,
  SSHAccessProfileValidationErrors,
} from '#entities/ssh-access-profile'
import { CustomSelect } from '#shared/ui'
import styles from './SSHProfileEditor.module.scss'

interface SSHProfileEditorProps {
  draft: SSHAccessProfileDraft
  errors: SSHAccessProfileValidationErrors
  nameError?: string
  submitted: boolean
  disabled: boolean
  editingProfileId?: string
  credentials: CredentialView[]
  proxies: ConnectionProxy[]
  jumpProfiles: SSHAccessProfile[]
  onChange: (draft: SSHAccessProfileDraft) => void
}

export function SSHProfileEditor({
  draft,
  errors,
  nameError,
  submitted,
  disabled,
  editingProfileId = '',
  credentials,
  proxies,
  jumpProfiles,
  onChange,
}: SSHProfileEditorProps) {
  const { t } = useTranslation()
  const visibleErrors = submitted ? errors : {}
  const credentialType = draft.auth_method === 'password' ? 'password' : 'private_key'
  const credentialOptions = credentials
    .filter((credential) => credential.type === credentialType)
    .map((credential) => ({
      value: credential.id,
      label: credential.name,
      description: t(`hosts.auth.${draft.auth_method}`),
    }))

  const changeAuthMethod = (authMethod: SSHAccessProfileDraft['auth_method']) => {
    const currentCredential = credentials.find((credential) => credential.id === draft.credential_id)
    onChange({
      ...draft,
      auth_method: authMethod,
      credential_id: currentCredential?.type === (authMethod === 'password' ? 'password' : 'private_key')
        ? draft.credential_id
        : '',
    })
  }

  return (
    <div className={styles.form}>
      <section className={styles.section}>
        <div className={styles['section-heading']}>
          <strong>{t('hosts.access.ssh.connection')}</strong>
          <small>{t('hosts.access.ssh.connectionHint')}</small>
        </div>
        <div className={styles.grid}>
          <Field label={t('hosts.access.profileName')} error={nameError}>
            <Input
              value={draft.name}
              maxLength={80}
              status={nameError ? 'error' : undefined}
              disabled={disabled}
              autoFocus
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </Field>
          <Field label={t('hosts.address')} error={errorLabel(visibleErrors.address, t)}>
            <Input
              value={draft.address}
              maxLength={253}
              status={visibleErrors.address ? 'error' : undefined}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, address: event.target.value })}
            />
          </Field>
          <Field label={t('hosts.port')} error={errorLabel(visibleErrors.port, t)}>
            <InputNumber
              min={1}
              max={65535}
              value={draft.port}
              status={visibleErrors.port ? 'error' : undefined}
              disabled={disabled}
              onChange={(port) => onChange({ ...draft, port: typeof port === 'number' ? port : null })}
            />
          </Field>
          <Field label={t('hosts.username')} error={errorLabel(visibleErrors.username, t)}>
            <Input
              value={draft.username}
              maxLength={256}
              status={visibleErrors.username ? 'error' : undefined}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, username: event.target.value })}
            />
          </Field>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles['section-heading']}>
          <strong>{t('hosts.authSection')}</strong>
          <small>{t('hosts.access.ssh.authHint')}</small>
        </div>
        <Radio.Group
          className={styles['auth-methods']}
          value={draft.auth_method}
          disabled={disabled}
          onChange={(event) => changeAuthMethod(event.target.value as SSHAccessProfileDraft['auth_method'])}
        >
          <Radio.Button value="password"><KeyRound size={14} />{t('hosts.auth.password')}</Radio.Button>
          <Radio.Button value="private_key"><FileKey2 size={14} />{t('hosts.auth.private_key')}</Radio.Button>
        </Radio.Group>
        <div className={styles.grid}>
          <div className={styles.field}>
            <CustomSelect
              label={t('hosts.credential')}
              value={draft.credential_id}
              disabled={disabled}
              options={[
                { value: '', label: t('fields.none') },
                ...credentialOptions,
              ]}
              onChange={(credential_id) => onChange({ ...draft, credential_id })}
            />
            {visibleErrors.credential_id ? (
              <small className={styles.error} role="alert">{t('hosts.validation.credentialRequired')}</small>
            ) : null}
          </div>
          <div className={styles.field}>
            <CustomSelect
              label={t('hosts.proxy')}
              value={draft.proxy_id}
              disabled={disabled}
              options={[
                { value: '', label: t('hosts.noProxy') },
                ...proxies.map((proxy) => ({
                  value: proxy.id,
                  label: proxy.name,
                  description: proxy.url,
                })),
              ]}
              onChange={(proxy_id) => onChange({ ...draft, proxy_id })}
            />
          </div>
          <div className={`${styles.field} ${styles.wide}`}>
            <CustomSelect
              label={t('hosts.jumpHost')}
              value={draft.jump_ssh_profile_id}
              disabled={disabled}
              options={[
                { value: '', label: t('hosts.noJumpHost') },
                ...jumpProfiles
                  .filter((profile) => profile.id !== editingProfileId)
                  .map((profile) => ({
                    value: profile.id,
                    label: profile.name || `${profile.username}@${profile.address}`,
                    description: `${profile.username}@${profile.address}:${profile.port}`,
                  })),
              ]}
              onChange={(jump_ssh_profile_id) => onChange({ ...draft, jump_ssh_profile_id })}
            />
            {visibleErrors.jump_ssh_profile_id ? (
              <small className={styles.error} role="alert">{t('hosts.access.errors.jumpSelf')}</small>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {error ? <small className={styles.error} role="alert">{error}</small> : null}
    </label>
  )
}

function errorLabel(
  error: SSHAccessProfileValidationErrors[keyof SSHAccessProfileValidationErrors],
  t: (key: string) => string,
) {
  if (!error) return undefined
  const keys: Record<string, string> = {
    required: 'hosts.access.errors.required',
    too_long: 'hosts.access.errors.tooLong',
    range: 'hosts.validation.portRange',
    self_reference: 'hosts.access.errors.jumpSelf',
  }
  return t(keys[error] ?? 'app.error')
}

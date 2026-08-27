import { Button, Input, InputNumber, Segmented } from 'antd'
import {
  Cable,
  FileKey2,
  KeyRound,
  Route,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnectionProxy } from '#entities/connection-proxy'
import type { CredentialView } from '#entities/credential'
import type { HostGroup } from '#entities/host'
import type { HostAsset } from '#entities/host-asset'
import type {
  SSHAccessProfile,
  SSHAccessProfileDraft,
  SSHAccessProfileValidationErrors,
} from '#entities/ssh-access-profile'
import {
  CustomSelect,
  ProfileEditorField,
  ProfileEditorFieldFeedback,
  ProfileEditorSectionHeading,
  uiStyles,
} from '#shared/ui'
import { SSHJumpProfileSelect } from './SSHJumpProfileSelect.tsx'
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
  jumpHosts: HostAsset[]
  jumpGroups: HostGroup[]
  getHostIconUrl: (iconId: string) => string
  showProfileName?: boolean
  autoFocus?: boolean
  errorMessages?: {
    address?: string
    port?: string
    username?: string
    credential?: string
    proxy?: string
    jump?: string
  }
  onManageProxies?: () => void
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
  jumpHosts,
  jumpGroups,
  getHostIconUrl,
  showProfileName = true,
  autoFocus = true,
  errorMessages = {},
  onManageProxies,
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
  const connectionSectionId = useId()
  const authenticationSectionId = useId()
  const routeSectionId = useId()
  const credentialFeedbackId = useId()
  const proxyFeedbackId = useId()
  const jumpFeedbackId = useId()
  const addressError = errorMessages.address ?? errorLabel(visibleErrors.address, t)
  const portError = errorMessages.port ?? errorLabel(visibleErrors.port, t)
  const usernameError = errorMessages.username ?? errorLabel(visibleErrors.username, t)
  const credentialError = errorMessages.credential || visibleErrors.credential_id
    ? errorMessages.credential ?? t('hosts.validation.credentialRequired')
    : undefined
  const jumpError = errorMessages.jump || visibleErrors.jump_ssh_profile_id
    ? errorMessages.jump ?? t('hosts.access.errors.jumpSelf')
    : undefined

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
      <section className={styles.section} aria-labelledby={connectionSectionId}>
        <div className={styles['section-inner']}>
          <ProfileEditorSectionHeading
            classNames={styles}
            id={connectionSectionId}
            icon={<Cable size={15} />}
            title={t('hosts.access.ssh.connection')}
            hint={t('hosts.access.ssh.connectionHint')}
          />
          <div
            className={`${styles.grid} ${styles['basic-grid']}`}
            data-profile-name={showProfileName ? 'visible' : 'hidden'}
          >
            {showProfileName ? (
              <ProfileEditorField
                classNames={styles}
                className={styles['profile-name-field']}
                label={t('hosts.access.profileName')}
                error={nameError}
              >
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={draft.name}
                    maxLength={80}
                    placeholder={t('hosts.access.ssh.profileNamePlaceholder')}
                    status={nameError ? 'error' : undefined}
                    disabled={disabled}
                    autoFocus={autoFocus}
                    onChange={(event) => onChange({ ...draft, name: event.target.value })}
                  />
                )}
              </ProfileEditorField>
            ) : null}
            <ProfileEditorField
              classNames={styles}
              className={styles['address-field']}
              label={t('hosts.address')}
              error={addressError}
            >
              {(controlProps) => (
                <Input
                  {...controlProps}
                  value={draft.address}
                  maxLength={253}
                  placeholder={t('hosts.access.ssh.addressPlaceholder')}
                  status={addressError ? 'error' : undefined}
                  disabled={disabled}
                  autoFocus={autoFocus && !showProfileName}
                  onChange={(event) => onChange({ ...draft, address: event.target.value })}
                />
              )}
            </ProfileEditorField>
            <ProfileEditorField
              classNames={styles}
              className={styles['port-field']}
              label={t('hosts.port')}
              error={portError}
            >
              {(controlProps) => (
                <InputNumber
                  {...controlProps}
                  min={1}
                  max={65535}
                  value={draft.port}
                  status={portError ? 'error' : undefined}
                  disabled={disabled}
                  onChange={(port) => onChange({ ...draft, port: typeof port === 'number' ? port : null })}
                />
              )}
            </ProfileEditorField>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby={authenticationSectionId}>
        <div className={styles['section-inner']}>
          <ProfileEditorSectionHeading
            classNames={styles}
            id={authenticationSectionId}
            icon={<ShieldCheck size={15} />}
            title={t('hosts.access.ssh.authentication')}
            hint={t('hosts.access.ssh.authHint')}
          />
          <div className={`${styles.grid} ${styles['authentication-grid']}`}>
            <div className={`${styles.field} ${styles['auth-method-field']}`}>
              <span>{t('hosts.authMethod')}</span>
              <Segmented<SSHAccessProfileDraft['auth_method']>
                block
                className={styles['auth-methods']}
                value={draft.auth_method}
                disabled={disabled}
                aria-label={t('hosts.authMethod')}
                options={[
                  {
                    value: 'password',
                    label: <span className={styles['auth-option']}><KeyRound size={13} />{t('hosts.auth.password')}</span>,
                  },
                  {
                    value: 'private_key',
                    label: <span className={styles['auth-option']}><FileKey2 size={13} />{t('hosts.auth.private_key')}</span>,
                  },
                ]}
                onChange={changeAuthMethod}
              />
              <ProfileEditorFieldFeedback classNames={styles} />
            </div>
            <ProfileEditorField
              classNames={styles}
              className={styles['username-field']}
              label={t('hosts.username')}
              error={usernameError}
            >
              {(controlProps) => (
                <Input
                  {...controlProps}
                  value={draft.username}
                  maxLength={256}
                  placeholder={t('hosts.access.ssh.usernamePlaceholder')}
                  status={usernameError ? 'error' : undefined}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...draft, username: event.target.value })}
                />
              )}
            </ProfileEditorField>
            <div
              className={`${styles.field} ${styles['credential-field']}`}
              data-invalid={credentialError ? 'true' : 'false'}
            >
              <CustomSelect
                label={t('hosts.credential')}
                value={draft.credential_id}
                disabled={disabled}
                status={credentialError ? 'error' : undefined}
                aria-invalid={credentialError ? true : undefined}
                aria-describedby={credentialError ? credentialFeedbackId : undefined}
                options={[
                  { value: '', label: t('fields.none') },
                  ...credentialOptions,
                ]}
                onChange={(credential_id) => onChange({ ...draft, credential_id })}
              />
              <ProfileEditorFieldFeedback
                classNames={styles}
                id={credentialFeedbackId}
                message={credentialError}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby={routeSectionId}>
        <div className={styles['section-inner']}>
          <ProfileEditorSectionHeading
            classNames={styles}
            id={routeSectionId}
            icon={<Route size={15} />}
            title={t('hosts.access.ssh.route')}
            hint={t('hosts.access.ssh.routeHint')}
            action={onManageProxies ? (
              <Button
                type="text"
                size="small"
                className={uiStyles['inline-management-action']}
                icon={<Settings2 size={13} />}
                disabled={disabled}
                onClick={onManageProxies}
              >
                {t('proxies.manage')}
              </Button>
            ) : undefined}
          />
          <div className={`${styles.grid} ${styles['route-grid']}`}>
            <div
              className={`${styles.field} ${styles['proxy-field']}`}
              data-invalid={errorMessages.proxy ? 'true' : 'false'}
            >
              <CustomSelect
                label={t('hosts.proxy')}
                value={draft.proxy_id}
                disabled={disabled}
                status={errorMessages.proxy ? 'error' : undefined}
                aria-invalid={errorMessages.proxy ? true : undefined}
                aria-describedby={errorMessages.proxy ? proxyFeedbackId : undefined}
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
              <ProfileEditorFieldFeedback
                classNames={styles}
                id={proxyFeedbackId}
                message={errorMessages.proxy}
              />
            </div>
            <div
              className={`${styles.field} ${styles['jump-field']}`}
              data-invalid={jumpError ? 'true' : 'false'}
            >
              <SSHJumpProfileSelect
                label={t('hosts.jumpHost')}
                value={draft.jump_ssh_profile_id}
                profiles={jumpProfiles}
                hosts={jumpHosts}
                groups={jumpGroups}
                editingProfileId={editingProfileId}
                getHostIconUrl={getHostIconUrl}
                disabled={disabled}
                status={jumpError ? 'error' : undefined}
                aria-invalid={jumpError ? true : undefined}
                aria-describedby={jumpError ? jumpFeedbackId : undefined}
                onChange={(jump_ssh_profile_id) => onChange({ ...draft, jump_ssh_profile_id })}
              />
              <ProfileEditorFieldFeedback
                classNames={styles}
                id={jumpFeedbackId}
                message={jumpError}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
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

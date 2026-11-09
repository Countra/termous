import { Input, InputNumber } from 'antd'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProfileEditorField } from '#shared/ui'
import {
  changeRDPAccessProfileRoute,
  type RDPAccessProfileDraft,
  type RemoteDesktopAccessProfileDraftErrors,
} from '../../model/remoteDesktopAccessProfileDraft.ts'
import type { DesktopProfileEditorOptions } from '../../ui/profileEditorTypes.ts'
import { DesktopProfileForm } from '../../ui/DesktopProfileForm.tsx'
import { DesktopConnectionSection } from '../../ui/DesktopConnectionSection.tsx'
import { DesktopDisplaySettings } from '../../ui/DesktopDisplaySettings.tsx'
import { DesktopTargetAuthSection } from '../../ui/DesktopTargetAuthSection.tsx'
import styles from '../../ui/DesktopProfileForm.module.scss'

interface Props extends DesktopProfileEditorOptions {
  draft: RDPAccessProfileDraft
  errors: RemoteDesktopAccessProfileDraftErrors
  onChange: (draft: RDPAccessProfileDraft) => void
}

export function RDPProfileEditor({ draft, errors, submitted, disabled, sshProfiles, onChange, ...auth }: Props) {
  const { t } = useTranslation()
  const id = useId()
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const visibleErrors = submitted ? errors : Object.fromEntries(Object.entries(errors).filter(([field]) => (
    touched.has(field) || (field === 'dimensions' && (touched.has('width') || touched.has('height')))
  )))
  const update = (patch: Partial<RDPAccessProfileDraft['rdp']>) => (
    onChange({ ...draft, rdp: { ...draft.rdp, ...patch } })
  )
  const required = t('hosts.access.errors.required')
  const nameError = visibleErrors.name ? t(visibleErrors.name === 'too_long' ? 'hosts.access.errors.tooLong' : 'hosts.access.errors.required') : undefined
  const routeError = visibleErrors.ssh_profile_id ? t(visibleErrors.ssh_profile_id === 'missing' ? 'hosts.access.errors.sshMissing' : 'hosts.access.errors.sshRequired') : undefined
  const targetError = visibleErrors.target_host ? (visibleErrors.target_host === 'required' ? required : t(draft.route === 'direct' ? 'remoteDesktop.validationTargetAddress' : 'remoteDesktop.rdp.hostInvalid')) : undefined
  const serverError = visibleErrors.server_name ? t('remoteDesktop.rdp.hostInvalid') : undefined
  const usernameError = visibleErrors.username ? (visibleErrors.username === 'required' ? required : t('remoteDesktop.rdp.accountInvalid')) : undefined
  const portError = visibleErrors.port ? t('remoteDesktop.rdp.portInvalid') : undefined
  const defaultSSH = sshProfiles.find(profile => profile.is_default)?.id ?? sshProfiles[0]?.id ?? ''

  return <div onBlurCapture={event => {
    const field = event.target.getAttribute('name')
    if (field && !touched.has(field)) setTouched(previous => new Set([...previous, field]))
  }}>
    <DesktopProfileForm
      draft={draft} nameError={nameError} disabled={disabled}
      onChange={patch => onChange({ ...draft, ...patch })}
    >
      <DesktopConnectionSection
        route={draft.route} sshProfileId={draft.ssh_profile_id}
        sshProfiles={sshProfiles} routeError={routeError} disabled={disabled}
        onRouteChange={route => onChange(changeRDPAccessProfileRoute(draft, route, defaultSSH))}
        onSSHChange={ssh_profile_id => onChange({ ...draft, ssh_profile_id })}
      >
        <div className={styles['endpoint-grid']}>
          <ProfileEditorField classNames={styles} label={t(draft.route === 'direct' ? 'remoteDesktop.targetAddress' : 'remoteDesktop.rdp.target')} error={targetError}>
            {controlProps => <Input
              {...controlProps} name="target_host" disabled={disabled}
              status={targetError ? 'error' : undefined}
              value={draft.rdp.target_host} maxLength={253}
              placeholder={t(draft.route === 'direct'
                ? 'remoteDesktop.targetAddressPlaceholder'
                : 'remoteDesktop.rdp.tunnelTargetPlaceholder')}
              onChange={event => update({ target_host: event.target.value })}
            />}
          </ProfileEditorField>
          <ProfileEditorField classNames={styles} label={t('remoteDesktop.rdp.port')} error={portError}>
            {controlProps => <InputNumber
              {...controlProps} name="port" disabled={disabled}
              status={portError ? 'error' : undefined}
              value={draft.rdp.port} min={1} max={65535}
              onChange={port => update({ port })}
            />}
          </ProfileEditorField>
        </div>
        <div>
          <ProfileEditorField classNames={styles} label={t('remoteDesktop.rdp.serverName')} error={serverError}>
            {controlProps => <Input
              {...controlProps} name="server_name"
              aria-describedby={[controlProps['aria-describedby'], `${id}-server-hint`].filter(Boolean).join(' ')}
              disabled={disabled} status={serverError ? 'error' : undefined}
              placeholder={draft.rdp.target_host} value={draft.rdp.server_name} maxLength={253}
              onChange={event => update({ server_name: event.target.value })}
            />}
          </ProfileEditorField>
          <p id={`${id}-server-hint`} className={styles.hint}>{t('remoteDesktop.rdp.serverNameHint')}</p>
        </div>
      </DesktopConnectionSection>
      <DesktopTargetAuthSection
        protocol="rdp" hasSavedAuth={auth.hasSavedTargetAuth}
        draft={auth.targetAuthDraft} error={auth.targetAuthError}
        disabled={disabled} onChange={auth.onTargetAuthChange}
      >
        <div className={styles['account-grid']}>
          <ProfileEditorField classNames={styles} label={t('remoteDesktop.rdp.username')} error={usernameError}>
            {controlProps => <Input
              {...controlProps} name="username" disabled={disabled}
              status={usernameError ? 'error' : undefined} autoComplete="off"
              value={draft.rdp.username} maxLength={256}
              onChange={event => update({ username: event.target.value })}
            />}
          </ProfileEditorField>
          <ProfileEditorField classNames={styles} label={t('remoteDesktop.rdp.domain')} error={visibleErrors.domain ? t('remoteDesktop.rdp.accountInvalid') : undefined}>
            {controlProps => <Input
              {...controlProps} name="domain" disabled={disabled}
              status={visibleErrors.domain ? 'error' : undefined}
              value={draft.rdp.domain} maxLength={256}
              onChange={event => update({ domain: event.target.value })}
            />}
          </ProfileEditorField>
        </div>
      </DesktopTargetAuthSection>
      <DesktopDisplaySettings
        mode={draft.rdp.default_display_mode} hint={t('remoteDesktop.rdp.displayHint')}
        disabled={disabled} onChange={default_display_mode => update({ default_display_mode })}
        toggles={[
          {
            key: 'audio', title: t('remoteDesktop.rdp.audio'), hint: t('remoteDesktop.rdp.audioHint'),
            checked: draft.rdp.audio, onChange: audio => update({ audio }),
          },
          {
            key: 'view-only', title: t('remoteDesktop.rdp.viewOnly'), hint: t('remoteDesktop.rdp.viewOnlyHint'),
            checked: draft.rdp.default_view_only, onChange: default_view_only => update({ default_view_only }),
          },
        ]}
      >
        <div className={styles['size-grid']}>
          {(['width', 'height'] as const).map(dimension => (
            <ProfileEditorField
              key={dimension} classNames={styles} label={t(`remoteDesktop.rdp.${dimension}`)}
              error={visibleErrors[dimension] || visibleErrors.dimensions ? t('remoteDesktop.rdp.sizeInvalid') : undefined}
            >
              {controlProps => <InputNumber
                {...controlProps} name={dimension} disabled={disabled}
                status={visibleErrors[dimension] || visibleErrors.dimensions ? 'error' : undefined}
                min={200} max={8192} step={2} value={draft.rdp[dimension]}
                onChange={value => update({ [dimension]: value })}
              />}
            </ProfileEditorField>
          ))}
        </div>
      </DesktopDisplaySettings>
    </DesktopProfileForm>
  </div>
}

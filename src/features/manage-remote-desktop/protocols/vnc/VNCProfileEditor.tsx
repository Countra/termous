import { Input, InputNumber } from 'antd'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { remoteDesktopTargetHostMaxLength } from '#entities/remote-desktop'
import { CustomSelect, ProfileEditorField, ProfileEditorFieldFeedback } from '#shared/ui'
import type { VNCAccessProfileDraft, VNCAccessProfileDraftErrors } from '../../model/vncAccessProfileDraft.ts'
import { changeVNCAccessProfileRoute } from '../../model/vncAccessProfileDraft.ts'
import type { DesktopProfileEditorOptions } from '../../ui/profileEditorTypes.ts'
import { DesktopProfileForm } from '../../ui/DesktopProfileForm.tsx'
import { DesktopConnectionSection } from '../../ui/DesktopConnectionSection.tsx'
import { DesktopDisplaySettings } from '../../ui/DesktopDisplaySettings.tsx'
import { DesktopTargetAuthSection } from '../../ui/DesktopTargetAuthSection.tsx'
import styles from '../../ui/DesktopProfileForm.module.scss'

interface Props extends DesktopProfileEditorOptions {
  draft: VNCAccessProfileDraft
  errors: VNCAccessProfileDraftErrors
  onChange: (draft: VNCAccessProfileDraft) => void
}

export function VNCProfileEditor({ draft, errors, submitted, disabled, sshProfiles, onChange, ...auth }: Props) {
  const { t } = useTranslation()
  const id = useId()
  const visibleErrors = submitted ? errors : {}
  const nameError = visibleErrors.name ? t(visibleErrors.name === 'too_long' ? 'hosts.access.errors.tooLong' : 'hosts.access.errors.required') : undefined
  const routeError = visibleErrors.ssh_profile_id ? t(visibleErrors.ssh_profile_id === 'missing' ? 'hosts.access.errors.sshMissing' : 'hosts.access.errors.sshRequired') : undefined
  const portError = visibleErrors.port ? t('remoteDesktop.validationPort') : undefined
  const targetError = visibleErrors.target_host ? t(visibleErrors.target_host === 'invalid' ? 'remoteDesktop.validationTargetAddress' : visibleErrors.target_host === 'loopback' ? 'remoteDesktop.validationLoopbackAddress' : 'hosts.access.errors.required') : undefined
  const defaultSSH = sshProfiles.find(profile => profile.is_default)?.id ?? sshProfiles[0]?.id ?? ''
  const update = (patch: Partial<VNCAccessProfileDraft['vnc']>) => (
    onChange({ ...draft, vnc: { ...draft.vnc, ...patch } })
  )

  return <DesktopProfileForm
    draft={draft} nameError={nameError} disabled={disabled}
    onChange={patch => onChange({ ...draft, ...patch })}
  >
    <DesktopConnectionSection
      route={draft.route} sshProfileId={draft.ssh_profile_id}
      sshProfiles={sshProfiles} routeError={routeError} disabled={disabled}
      onRouteChange={route => onChange(changeVNCAccessProfileRoute(draft, route, defaultSSH))}
      onSSHChange={ssh_profile_id => onChange({ ...draft, ssh_profile_id })}
    >
      <div className={styles['endpoint-grid']}>
        {draft.route === 'ssh_tunnel' ? <div className={styles.field} data-invalid={targetError ? 'true' : 'false'}>
          <CustomSelect
            label={t('remoteDesktop.loopbackHost')} value={draft.vnc.target_host}
            disabled={disabled} status={targetError ? 'error' : undefined}
            aria-invalid={targetError ? true : undefined}
            aria-describedby={targetError ? `${id}-target-error` : undefined}
            options={[
              { value: '127.0.0.1', label: '127.0.0.1', description: t('remoteDesktop.ipv4Loopback') },
              { value: '::1', label: '::1', description: t('remoteDesktop.ipv6Loopback') },
            ]}
            onChange={target_host => update({ target_host })}
          />
          <ProfileEditorFieldFeedback classNames={styles} id={`${id}-target-error`} message={targetError} />
        </div> : <ProfileEditorField classNames={styles} label={t('remoteDesktop.targetAddress')} error={targetError}>
          {controlProps => <Input
            {...controlProps} name="target_host" disabled={disabled}
            status={targetError ? 'error' : undefined}
            value={draft.vnc.target_host} maxLength={remoteDesktopTargetHostMaxLength}
            placeholder={t('remoteDesktop.targetAddressPlaceholder')}
            onChange={event => update({ target_host: event.target.value })}
          />}
        </ProfileEditorField>}
        <ProfileEditorField classNames={styles} label={t('remoteDesktop.port')} error={portError}>
          {controlProps => <InputNumber
            {...controlProps} name="port" min={1} max={65535} disabled={disabled}
            status={portError ? 'error' : undefined} value={draft.vnc.port}
            onChange={port => update({ port: typeof port === 'number' ? port : null })}
          />}
        </ProfileEditorField>
      </div>
    </DesktopConnectionSection>
    <DesktopTargetAuthSection
      hasSavedAuth={auth.hasSavedTargetAuth} draft={auth.targetAuthDraft}
      error={auth.targetAuthError} disabled={disabled} onChange={auth.onTargetAuthChange}
    />
    <DesktopDisplaySettings
      mode={draft.vnc.default_display_mode} hint={t('remoteDesktop.displayModeHint')}
      disabled={disabled} onChange={default_display_mode => update({ default_display_mode })}
      toggles={[
        {
          key: 'shared', title: t('remoteDesktop.shared'), hint: t('remoteDesktop.sharedHint'),
          checked: draft.vnc.shared, onChange: shared => update({ shared }),
        },
        {
          key: 'view-only', title: t('remoteDesktop.viewOnly'), hint: t('remoteDesktop.viewOnlyHint'),
          checked: draft.vnc.default_view_only, onChange: default_view_only => update({ default_view_only }),
        },
      ]}
    />
  </DesktopProfileForm>
}

import { Input, InputNumber, Segmented, Switch } from 'antd'
import { FileText, LockKeyhole, Maximize2, MonitorCog, Network, Route, Scaling, Scan } from 'lucide-react'
import { useId, useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopDisplayMode, RemoteDesktopRoute } from '#entities/remote-desktop'
import { CustomSelect, ProfileEditorField, ProfileEditorFieldFeedback, ProfileEditorSectionHeading } from '#shared/ui'
import { changeRDPAccessProfileRoute, type RDPAccessProfileDraft, type RemoteDesktopAccessProfileDraftErrors } from '../../model/remoteDesktopAccessProfileDraft.ts'
import type { VNCProfileEditor } from '../vnc/VNCProfileEditor.tsx'
import { VNCTargetAuthSection } from '../vnc/VNCTargetAuthSection.tsx'
import styles from '../vnc/VNCProfileEditor.module.scss'
import segmentedStyles from '../vnc/VNCProfileSegmented.module.scss'
import rdpStyles from './RDPProfileEditor.module.scss'

type Props = Omit<ComponentProps<typeof VNCProfileEditor>, 'draft' | 'onChange' | 'errors'> & {
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
  const update = (patch: Partial<RDPAccessProfileDraft['rdp']>) => onChange({ ...draft, rdp: { ...draft.rdp, ...patch } })
  const required = t('hosts.access.errors.required')
  const nameError = visibleErrors.name ? t(visibleErrors.name === 'too_long' ? 'hosts.access.errors.tooLong' : 'hosts.access.errors.required') : undefined
  const routeError = visibleErrors.ssh_profile_id ? t(visibleErrors.ssh_profile_id === 'missing' ? 'hosts.access.errors.sshMissing' : 'hosts.access.errors.sshRequired') : undefined
  const targetError = visibleErrors.target_host ? (visibleErrors.target_host === 'required' ? required : t(draft.route === 'direct' ? 'remoteDesktop.validationTargetAddress' : 'remoteDesktop.rdp.hostInvalid')) : undefined
  const serverError = visibleErrors.server_name ? t('remoteDesktop.rdp.hostInvalid') : undefined
  const usernameError = visibleErrors.username ? (visibleErrors.username === 'required' ? required : t('remoteDesktop.rdp.accountInvalid')) : undefined
  const portError = visibleErrors.port ? t('remoteDesktop.rdp.portInvalid') : undefined
  const defaultSSH = sshProfiles.find((profile) => profile.is_default)?.id ?? sshProfiles[0]?.id ?? ''

  return (
    <div className={`${styles.form} ${rdpStyles.form}`} onBlurCapture={(event) => {
      const field = event.target.getAttribute('name')
      if (field && !touched.has(field)) setTouched((previous) => new Set([...previous, field]))
    }}>
      <section className={styles.section} aria-labelledby={`${id}-basic`}>
        <div className={styles['section-inner']}>
          <ProfileEditorSectionHeading classNames={styles} id={`${id}-basic`} icon={<FileText size={15} />} title={t('remoteDesktop.basicSection')} />
          <div className={`${styles.grid} ${styles['identity-grid']}`}>
            <ProfileEditorField classNames={styles} className={styles['profile-name-field']} label={t('hosts.access.profileName')} error={nameError}>
              {(p) => <Input {...p} name="name" autoFocus disabled={disabled} status={nameError ? 'error' : undefined} maxLength={80} placeholder={t('remoteDesktop.profileNamePlaceholder')} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />}
            </ProfileEditorField>
            <ProfileEditorField classNames={styles} className={styles['description-field']} label={t('remoteDesktop.description')}>
              {(p) => <Input.TextArea {...p} rows={2} disabled={disabled} maxLength={240} value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} />}
            </ProfileEditorField>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby={`${id}-connection`}>
        <div className={styles['section-inner']}>
          <ProfileEditorSectionHeading classNames={styles} id={`${id}-connection`} icon={<Route size={15} />} title={t('remoteDesktop.connectionSection')} />
          <div className={styles['route-setting']}>
            <span id={`${id}-route`} className={styles['route-label']}>{t('remoteDesktop.route.label')}</span>
            <Segmented<RemoteDesktopRoute>
              block className={segmentedStyles.control} value={draft.route} disabled={disabled}
              aria-labelledby={`${id}-route`} aria-controls={`${id}-connection-fields`}
              options={[
                { value: 'ssh_tunnel', label: t('remoteDesktop.route.sshTunnel'), icon: <LockKeyhole size={13} />, disabled: sshProfiles.length === 0 && draft.route !== 'ssh_tunnel' },
                { value: 'direct', label: t('remoteDesktop.route.direct'), icon: <Network size={13} /> },
              ]}
              onChange={(route) => onChange(changeRDPAccessProfileRoute(draft, route, defaultSSH))}
            />
          </div>
          {sshProfiles.length === 0 ? <p className={rdpStyles.hint}>{t('remoteDesktop.rdp.noSSH')}</p> : null}
          <div className={styles['connection-details']}>
            <div id={`${id}-connection-fields`} className={`${styles.grid} ${rdpStyles['connection-grid']}`}>
              {draft.route === 'ssh_tunnel' ? (
                <div className={`${styles.field} ${rdpStyles['full-field']}`} data-invalid={routeError ? 'true' : 'false'}>
                  <CustomSelect
                    label={t('hosts.access.desktop.sshRoute')} value={draft.ssh_profile_id}
                    disabled={disabled || sshProfiles.length === 0} status={routeError ? 'error' : undefined}
                    aria-invalid={routeError ? true : undefined} aria-describedby={routeError ? `${id}-route-error` : undefined}
                    options={sshProfiles.map((profile) => ({ value: profile.id, label: profile.name || `${profile.username}@${profile.address}`, description: `${profile.username}@${profile.address}:${profile.port}` }))}
                    onChange={(ssh_profile_id) => onChange({ ...draft, ssh_profile_id })}
                  />
                  <ProfileEditorFieldFeedback classNames={styles} id={`${id}-route-error`} message={routeError} />
                </div>
              ) : null}
              <ProfileEditorField classNames={styles} className={rdpStyles['target-field']} label={t(draft.route === 'direct' ? 'remoteDesktop.targetAddress' : 'remoteDesktop.rdp.target')} error={targetError}>
                {(p) => <Input {...p} name="target_host" disabled={disabled} status={targetError ? 'error' : undefined} value={draft.rdp.target_host} maxLength={253} placeholder={t(draft.route === 'direct' ? 'remoteDesktop.targetAddressPlaceholder' : 'remoteDesktop.rdp.tunnelTargetPlaceholder')} onChange={(e) => update({ target_host: e.target.value })} />}
              </ProfileEditorField>
              <ProfileEditorField classNames={styles} className={rdpStyles['port-field']} label={t('remoteDesktop.rdp.port')} error={portError}>
                {(p) => <InputNumber {...p} name="port" disabled={disabled} status={portError ? 'error' : undefined} value={draft.rdp.port} min={1} max={65535} onChange={(port) => update({ port })} />}
              </ProfileEditorField>
              <div className={rdpStyles['full-field']}>
                <ProfileEditorField classNames={styles} label={t('remoteDesktop.rdp.serverName')} error={serverError}>
                  {(p) => <Input {...p} name="server_name" aria-describedby={[p['aria-describedby'], `${id}-server-hint`].filter(Boolean).join(' ')} disabled={disabled} status={serverError ? 'error' : undefined} placeholder={draft.rdp.target_host} value={draft.rdp.server_name} maxLength={253} onChange={(e) => update({ server_name: e.target.value })} />}
                </ProfileEditorField>
                <p id={`${id}-server-hint`} className={rdpStyles.hint}>{t('remoteDesktop.rdp.serverNameHint')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <VNCTargetAuthSection protocol="rdp" hasSavedAuth={auth.hasSavedTargetAuth} draft={auth.targetAuthDraft} error={auth.targetAuthError} disabled={disabled} onChange={auth.onTargetAuthChange}>
        <div className={`${styles.grid} ${rdpStyles['account-grid']}`}>
          <ProfileEditorField classNames={styles} label={t('remoteDesktop.rdp.username')} error={usernameError}>
            {(p) => <Input {...p} name="username" disabled={disabled} status={usernameError ? 'error' : undefined} autoComplete="off" value={draft.rdp.username} maxLength={256} onChange={(e) => update({ username: e.target.value })} />}
          </ProfileEditorField>
          <ProfileEditorField classNames={styles} label={t('remoteDesktop.rdp.domain')} error={visibleErrors.domain ? t('remoteDesktop.rdp.accountInvalid') : undefined}>
            {(p) => <Input {...p} name="domain" disabled={disabled} status={visibleErrors.domain ? 'error' : undefined} value={draft.rdp.domain} maxLength={256} onChange={(e) => update({ domain: e.target.value })} />}
          </ProfileEditorField>
        </div>
      </VNCTargetAuthSection>

      <section className={styles.section} aria-labelledby={`${id}-viewer`}>
        <div className={styles['section-inner']}>
          <ProfileEditorSectionHeading classNames={styles} id={`${id}-viewer`} icon={<MonitorCog size={15} />} title={t('remoteDesktop.viewerSection')} />
          <div className={styles['viewer-layout']}>
            <div className={styles['mode-setting']}>
              <span className={styles['setting-copy']}><strong>{t('remoteDesktop.displayMode')}</strong><small id={`${id}-display-hint`}>{t('remoteDesktop.rdp.displayHint')}</small></span>
              <Segmented<RemoteDesktopDisplayMode>
                block className={`${segmentedStyles.control} ${styles['display-options']}`} value={draft.rdp.default_display_mode} disabled={disabled}
                aria-label={t('remoteDesktop.displayMode')} aria-describedby={`${id}-display-hint`}
                options={[
                  { value: 'fit', label: t('remoteDesktop.display.fit'), icon: <Scaling size={13} /> },
                  { value: 'resize', label: t('remoteDesktop.display.resize'), icon: <Scan size={13} /> },
                  { value: 'actual', label: t('remoteDesktop.display.actual'), icon: <Maximize2 size={13} /> },
                ]}
                onChange={(default_display_mode) => update({ default_display_mode })}
              />
              <div className={`${styles.grid} ${rdpStyles['size-grid']}`}>
                {(['width', 'height'] as const).map((dimension) => (
                  <ProfileEditorField key={dimension} classNames={styles} label={t(`remoteDesktop.rdp.${dimension}`)} error={visibleErrors[dimension] || visibleErrors.dimensions ? t('remoteDesktop.rdp.sizeInvalid') : undefined}>
                    {(p) => <InputNumber {...p} name={dimension} disabled={disabled} status={visibleErrors[dimension] || visibleErrors.dimensions ? 'error' : undefined} min={200} max={8192} step={2} value={draft.rdp[dimension]} onChange={(value) => update({ [dimension]: value })} />}
                  </ProfileEditorField>
                ))}
              </div>
            </div>
            <div className={styles['behavior-settings']}>
              {(['audio', 'default_view_only'] as const).map((setting) => {
                const title = t(setting === 'audio' ? 'remoteDesktop.rdp.audio' : 'remoteDesktop.rdp.viewOnly')
                return <label key={setting} className={styles['switch-setting']}>
                  <span><strong>{title}</strong><small id={`${id}-${setting}`}>{t(setting === 'audio' ? 'remoteDesktop.rdp.audioHint' : 'remoteDesktop.rdp.viewOnlyHint')}</small></span>
                  <Switch checked={draft.rdp[setting]} disabled={disabled} aria-label={title} aria-describedby={`${id}-${setting}`} onChange={(value) => update({ [setting]: value })} />
                </label>
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

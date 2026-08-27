import { Input, InputNumber, Segmented, Switch } from 'antd'
import {
  FileText,
  LockKeyhole,
  Maximize2,
  MonitorCog,
  Network,
  Route,
  Scaling,
  Scan,
} from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  remoteDesktopTargetHostMaxLength,
  type RemoteDesktopDisplayMode,
  type RemoteDesktopRoute,
} from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import {
  CustomSelect,
  ProfileEditorField,
  ProfileEditorFieldFeedback,
  ProfileEditorSectionHeading,
} from '#shared/ui'
import type {
  VNCAccessProfileDraft,
  VNCAccessProfileDraftErrors,
} from '../../model/vncAccessProfileDraft.ts'
import { changeVNCAccessProfileRoute } from '../../model/vncAccessProfileDraft.ts'
import type {
  VNCTargetAuthDraft,
  VNCTargetAuthDraftError,
} from '../../model/vncTargetAuthDraft.ts'
import { VNCTargetAuthSection } from './VNCTargetAuthSection.tsx'
import styles from './VNCProfileEditor.module.scss'
import segmentedStyles from './VNCProfileSegmented.module.scss'

interface VNCProfileEditorProps {
  draft: VNCAccessProfileDraft
  errors: VNCAccessProfileDraftErrors
  submitted: boolean
  disabled: boolean
  sshProfiles: SSHAccessProfile[]
  hasSavedTargetAuth: boolean
  targetAuthDraft: VNCTargetAuthDraft
  targetAuthError?: VNCTargetAuthDraftError
  onChange: (draft: VNCAccessProfileDraft) => void
  onTargetAuthChange: (draft: VNCTargetAuthDraft) => void
}

export function VNCProfileEditor({
  draft,
  errors,
  submitted,
  disabled,
  sshProfiles,
  hasSavedTargetAuth,
  targetAuthDraft,
  targetAuthError,
  onChange,
  onTargetAuthChange,
}: VNCProfileEditorProps) {
  const { t } = useTranslation()
  const visibleErrors = submitted ? errors : {}
  const basicSectionId = useId()
  const connectionSectionId = useId()
  const connectionFieldsId = useId()
  const routeModeLabelId = useId()
  const viewerSectionId = useId()
  const displayModeHintId = useId()
  const sharedHintId = useId()
  const viewOnlyHintId = useId()
  const routeFeedbackId = useId()
  const loopbackFeedbackId = useId()
  const nameError = profileError(visibleErrors.name, t)
  const routeError = visibleErrors.ssh_profile_id
    ? t(visibleErrors.ssh_profile_id === 'missing'
      ? 'hosts.access.errors.sshMissing'
      : 'hosts.access.errors.sshRequired')
    : undefined
  const portError = profileError(visibleErrors.port, t)
  const targetHostError = visibleErrors.target_host
    ? t(visibleErrors.target_host === 'invalid'
      ? 'remoteDesktop.validationTargetAddress'
      : visibleErrors.target_host === 'loopback'
        ? 'remoteDesktop.validationLoopbackAddress'
        : 'hosts.access.errors.required')
    : undefined
  const defaultSSHProfileId = sshProfiles.find((profile) => profile.is_default)?.id
    ?? sshProfiles[0]?.id
    ?? ''

  return (
    <div className={styles.form}>
      <section className={styles.section} aria-labelledby={basicSectionId}>
        <div className={styles['section-inner']}>
          <ProfileEditorSectionHeading
            classNames={styles}
            id={basicSectionId}
            icon={<FileText size={15} />}
            title={t('remoteDesktop.basicSection')}
          />
          <div className={`${styles.grid} ${styles['identity-grid']}`}>
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
                  autoFocus
                  placeholder={t('remoteDesktop.profileNamePlaceholder')}
                  status={nameError ? 'error' : undefined}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...draft, name: event.target.value })}
                />
              )}
            </ProfileEditorField>
            <ProfileEditorField
              classNames={styles}
              className={styles['description-field']}
              label={t('remoteDesktop.description')}
            >
              {(controlProps) => (
                <Input.TextArea
                  {...controlProps}
                  value={draft.description}
                  maxLength={240}
                  rows={2}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...draft, description: event.target.value })}
                />
              )}
            </ProfileEditorField>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby={connectionSectionId}>
        <div className={styles['section-inner']}>
          <ProfileEditorSectionHeading
            classNames={styles}
            id={connectionSectionId}
            icon={<Route size={15} />}
            title={t('remoteDesktop.connectionSection')}
          />
          <div className={styles['route-setting']}>
            <span id={routeModeLabelId} className={styles['route-label']}>
              {t('remoteDesktop.route.label')}
            </span>
            <Segmented<RemoteDesktopRoute>
              block
              className={`${segmentedStyles.control} ${styles['route-options']}`}
              value={draft.route}
              disabled={disabled}
              aria-labelledby={routeModeLabelId}
              aria-controls={connectionFieldsId}
              options={[
                {
                  value: 'ssh_tunnel',
                  icon: <LockKeyhole size={13} aria-hidden="true" />,
                  label: t('remoteDesktop.route.sshTunnel'),
                  disabled: sshProfiles.length === 0 && draft.route !== 'ssh_tunnel',
                },
                {
                  value: 'direct',
                  icon: <Network size={13} aria-hidden="true" />,
                  label: t('remoteDesktop.route.direct'),
                },
              ]}
              onChange={(route) => onChange(changeVNCAccessProfileRoute(
                draft,
                route,
                defaultSSHProfileId,
              ))}
            />
          </div>
          <div className={styles['connection-details']}>
            <div
              id={connectionFieldsId}
              className={`${styles.grid} ${styles['connection-grid']}`}
              data-route={draft.route}
            >
              {draft.route === 'ssh_tunnel' ? (
                <div
                  className={`${styles.field} ${styles['ssh-route-field']}`}
                  data-invalid={routeError ? 'true' : 'false'}
                >
                  <CustomSelect
                    label={t('hosts.access.desktop.sshRoute')}
                    value={draft.ssh_profile_id}
                    disabled={disabled || sshProfiles.length === 0}
                    status={routeError ? 'error' : undefined}
                    aria-invalid={routeError ? true : undefined}
                    aria-describedby={routeError ? routeFeedbackId : undefined}
                    options={sshProfiles.map((profile) => ({
                      value: profile.id,
                      label: profile.name || `${profile.username}@${profile.address}`,
                      description: `${profile.username}@${profile.address}:${profile.port}`,
                    }))}
                    onChange={(ssh_profile_id) => onChange({ ...draft, ssh_profile_id })}
                  />
                  <ProfileEditorFieldFeedback
                    classNames={styles}
                    id={routeFeedbackId}
                    message={routeError}
                  />
                </div>
              ) : null}
              {draft.route === 'ssh_tunnel' ? (
                <div
                  className={`${styles.field} ${styles['target-field']}`}
                  data-invalid={targetHostError ? 'true' : 'false'}
                >
                  <CustomSelect
                    label={t('remoteDesktop.loopbackHost')}
                    value={draft.vnc.target_host}
                    disabled={disabled}
                    status={targetHostError ? 'error' : undefined}
                    aria-invalid={targetHostError ? true : undefined}
                    aria-describedby={targetHostError ? loopbackFeedbackId : undefined}
                    options={[
                      { value: '127.0.0.1', label: '127.0.0.1', description: t('remoteDesktop.ipv4Loopback') },
                      { value: '::1', label: '::1', description: t('remoteDesktop.ipv6Loopback') },
                    ]}
                    onChange={(target_host) => onChange({
                      ...draft,
                      vnc: { ...draft.vnc, target_host },
                    })}
                  />
                  <ProfileEditorFieldFeedback
                    classNames={styles}
                    id={loopbackFeedbackId}
                    message={targetHostError}
                  />
                </div>
              ) : (
                <ProfileEditorField
                  classNames={styles}
                  className={styles['target-field']}
                  label={t('remoteDesktop.targetAddress')}
                  error={targetHostError}
                >
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      value={draft.vnc.target_host}
                      maxLength={remoteDesktopTargetHostMaxLength}
                      placeholder={t('remoteDesktop.targetAddressPlaceholder')}
                      status={targetHostError ? 'error' : undefined}
                      disabled={disabled}
                      onChange={(event) => onChange({
                        ...draft,
                        vnc: { ...draft.vnc, target_host: event.target.value },
                      })}
                    />
                  )}
                </ProfileEditorField>
              )}
              <ProfileEditorField
                classNames={styles}
                className={styles['port-field']}
                label={t('remoteDesktop.port')}
                error={portError}
              >
                {(controlProps) => (
                  <InputNumber
                    {...controlProps}
                    min={1}
                    max={65535}
                    value={draft.vnc.port}
                    aria-label={t('remoteDesktop.port')}
                    status={portError ? 'error' : undefined}
                    disabled={disabled}
                    onChange={(port) => onChange({
                      ...draft,
                      vnc: { ...draft.vnc, port: typeof port === 'number' ? port : null },
                    })}
                  />
                )}
              </ProfileEditorField>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby={viewerSectionId}>
        <div className={styles['section-inner']}>
          <ProfileEditorSectionHeading
            classNames={styles}
            id={viewerSectionId}
            icon={<MonitorCog size={15} />}
            title={t('remoteDesktop.viewerSection')}
          />
          <div className={styles['viewer-layout']}>
            <div className={styles['mode-setting']}>
              <span className={styles['setting-copy']}>
                <strong>{t('remoteDesktop.displayMode')}</strong>
                <small id={displayModeHintId}>{t('remoteDesktop.displayModeHint')}</small>
              </span>
              <Segmented<RemoteDesktopDisplayMode>
                block
                className={`${segmentedStyles.control} ${styles['display-options']}`}
                value={draft.vnc.default_display_mode}
                disabled={disabled}
                aria-label={t('remoteDesktop.displayMode')}
                aria-describedby={displayModeHintId}
                options={[
                  {
                    value: 'fit',
                    icon: <Scaling size={13} aria-hidden="true" />,
                    label: t('remoteDesktop.display.fit'),
                  },
                  {
                    value: 'resize',
                    icon: <Scan size={13} aria-hidden="true" />,
                    label: t('remoteDesktop.display.resize'),
                  },
                  {
                    value: 'actual',
                    icon: <Maximize2 size={13} aria-hidden="true" />,
                    label: t('remoteDesktop.display.actual'),
                  },
                ]}
                onChange={(default_display_mode) => onChange({
                  ...draft,
                  vnc: { ...draft.vnc, default_display_mode },
                })}
              />
            </div>
            <div className={styles['behavior-settings']}>
              <SwitchSetting
                title={t('remoteDesktop.shared')}
                hint={t('remoteDesktop.sharedHint')}
                hintId={sharedHintId}
                checked={draft.vnc.shared}
                disabled={disabled}
                onChange={(shared) => onChange({ ...draft, vnc: { ...draft.vnc, shared } })}
              />
              <SwitchSetting
                title={t('remoteDesktop.viewOnly')}
                hint={t('remoteDesktop.viewOnlyHint')}
                hintId={viewOnlyHintId}
                checked={draft.vnc.default_view_only}
                disabled={disabled}
                onChange={(default_view_only) => onChange({
                  ...draft,
                  vnc: { ...draft.vnc, default_view_only },
                })}
              />
            </div>
          </div>
        </div>
      </section>

      <VNCTargetAuthSection
        hasSavedAuth={hasSavedTargetAuth}
        draft={targetAuthDraft}
        error={targetAuthError}
        disabled={disabled}
        onChange={onTargetAuthChange}
      />
    </div>
  )
}

function SwitchSetting({
  title,
  hint,
  hintId,
  checked,
  disabled,
  onChange,
}: {
  title: string
  hint: string
  hintId: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={styles['switch-setting']}>
      <span>
        <strong>{title}</strong>
        <small id={hintId}>{hint}</small>
      </span>
      <Switch
        checked={checked}
        disabled={disabled}
        aria-label={title}
        aria-describedby={hintId}
        onChange={onChange}
      />
    </label>
  )
}

function profileError(
  error: VNCAccessProfileDraftErrors[keyof VNCAccessProfileDraftErrors],
  t: (key: string) => string,
) {
  if (!error) return undefined
  if (error === 'range') return t('remoteDesktop.validationPort')
  if (error === 'too_long') return t('hosts.access.errors.tooLong')
  return t('hosts.access.errors.required')
}

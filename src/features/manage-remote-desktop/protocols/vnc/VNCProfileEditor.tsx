import { Input, InputNumber, Segmented, Switch } from 'antd'
import { Maximize2, Scaling, Scan } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopDisplayMode } from '#entities/remote-desktop'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import { CustomSelect } from '#shared/ui'
import type {
  VNCAccessProfileDraft,
  VNCAccessProfileDraftErrors,
} from '../../model/vncAccessProfileDraft.ts'
import type {
  VNCTargetAuthDraft,
  VNCTargetAuthDraftError,
} from '../../model/vncTargetAuthDraft.ts'
import { VNCTargetAuthSection } from './VNCTargetAuthSection.tsx'
import styles from './VNCProfileEditor.module.scss'

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

  return (
    <div className={styles.form}>
      <section className={styles.section}>
        <div className={styles['section-heading']}>
          <strong>{t('remoteDesktop.connectionSection')}</strong>
          <small>{t('hosts.access.desktop.routeHint')}</small>
        </div>
        <div className={styles.grid}>
          <Field label={t('hosts.access.profileName')} error={profileError(visibleErrors.name, t)}>
            <Input
              value={draft.name}
              maxLength={80}
              autoFocus
              status={visibleErrors.name ? 'error' : undefined}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
          </Field>
          <div className={styles.field}>
            <CustomSelect
              label={t('hosts.access.desktop.sshRoute')}
              value={draft.ssh_profile_id}
              disabled={disabled || sshProfiles.length === 0}
              options={sshProfiles.map((profile) => ({
                value: profile.id,
                label: profile.name || `${profile.username}@${profile.address}`,
                description: `${profile.username}@${profile.address}:${profile.port}`,
              }))}
              onChange={(ssh_profile_id) => onChange({ ...draft, ssh_profile_id })}
            />
            {visibleErrors.ssh_profile_id ? (
              <small className={styles.error} role="alert">
                {t(visibleErrors.ssh_profile_id === 'missing'
                  ? 'hosts.access.errors.sshMissing'
                  : 'hosts.access.errors.sshRequired')}
              </small>
            ) : null}
          </div>
          <label className={`${styles.field} ${styles.wide}`}>
            <span>{t('remoteDesktop.description')}</span>
            <Input.TextArea
              value={draft.description}
              maxLength={240}
              autoSize={{ minRows: 2, maxRows: 4 }}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, description: event.target.value })}
            />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles['section-heading']}>
          <strong>{t('remoteDesktop.endpointSection')}</strong>
          <small>{t('hosts.access.desktop.endpointHint')}</small>
        </div>
        <div className={styles.grid}>
          <div className={styles.field}>
            <CustomSelect
              label={t('remoteDesktop.loopbackHost')}
              value={draft.vnc.loopback_host}
              disabled={disabled}
              options={[
                { value: '127.0.0.1', label: '127.0.0.1', description: t('remoteDesktop.ipv4Loopback') },
                { value: '::1', label: '::1', description: t('remoteDesktop.ipv6Loopback') },
              ]}
              onChange={(loopback_host) => onChange({
                ...draft,
                vnc: { ...draft.vnc, loopback_host: loopback_host as '127.0.0.1' | '::1' },
              })}
            />
          </div>
          <Field label={t('remoteDesktop.port')} error={profileError(visibleErrors.port, t)}>
            <InputNumber
              min={1}
              max={65535}
              value={draft.vnc.port}
              status={visibleErrors.port ? 'error' : undefined}
              disabled={disabled}
              onChange={(port) => onChange({
                ...draft,
                vnc: { ...draft.vnc, port: typeof port === 'number' ? port : null },
              })}
            />
          </Field>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles['section-heading']}>
          <strong>{t('remoteDesktop.viewerSection')}</strong>
          <small>{t('remoteDesktop.displayModeHint')}</small>
        </div>
        <div className={styles['display-mode']}>
          <span>{t('remoteDesktop.displayMode')}</span>
          <Segmented<RemoteDesktopDisplayMode>
            block
            size="small"
            value={draft.vnc.default_display_mode}
            disabled={disabled}
            options={[
              { value: 'fit', label: <span><Scaling size={13} />{t('remoteDesktop.display.fit')}</span> },
              { value: 'resize', label: <span><Scan size={13} />{t('remoteDesktop.display.resize')}</span> },
              { value: 'actual', label: <span><Maximize2 size={13} />{t('remoteDesktop.display.actual')}</span> },
            ]}
            onChange={(default_display_mode) => onChange({
              ...draft,
              vnc: { ...draft.vnc, default_display_mode },
            })}
          />
        </div>
        <div className={styles.switches}>
          <label>
            <span><strong>{t('remoteDesktop.shared')}</strong><small>{t('remoteDesktop.sharedHint')}</small></span>
            <Switch
              checked={draft.vnc.shared}
              disabled={disabled}
              onChange={(shared) => onChange({ ...draft, vnc: { ...draft.vnc, shared } })}
            />
          </label>
          <label>
            <span><strong>{t('remoteDesktop.viewOnly')}</strong><small>{t('remoteDesktop.viewOnlyHint')}</small></span>
            <Switch
              checked={draft.vnc.default_view_only}
              disabled={disabled}
              onChange={(default_view_only) => onChange({
                ...draft,
                vnc: { ...draft.vnc, default_view_only },
              })}
            />
          </label>
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

function profileError(
  error: VNCAccessProfileDraftErrors[keyof VNCAccessProfileDraftErrors],
  t: (key: string) => string,
) {
  if (!error) return undefined
  if (error === 'range') return t('remoteDesktop.validationPort')
  if (error === 'too_long') return t('hosts.access.errors.tooLong')
  return t('hosts.access.errors.required')
}

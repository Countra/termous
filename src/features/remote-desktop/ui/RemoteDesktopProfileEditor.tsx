import { Button, Input, InputNumber, Popconfirm, Segmented, Switch } from 'antd'
import {
  Cable,
  Maximize2,
  MonitorPlay,
  Network,
  Save,
  Scaling,
  Scan,
  Server,
  Settings2,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopDisplayMode } from '#entities/remote-desktop'
import type { Host } from '#entities/host'
import type { SSHAccessProfile } from '#entities/ssh-access-profile'
import {
  VNCTargetAuthSection,
  type VNCTargetAuthDraft,
  type VNCTargetAuthDraftError,
} from '#features/manage-remote-desktop'
import {
  ConnectionActionButton,
  CustomSelect,
  EditorModeContext,
  termousPopconfirmProps,
  uiStyles,
} from '#shared/ui'
import type {
  RemoteDesktopProfileDraft,
  RemoteDesktopProfileDraftErrors,
} from '../model/remoteDesktopProfileDraft'
import styles from './RemoteDesktopLauncher.module.scss'

interface RemoteDesktopProfileEditorProps {
  mode: 'create' | 'edit'
  profileName?: string
  draft: RemoteDesktopProfileDraft
  errors: RemoteDesktopProfileDraftErrors
  submitted: boolean
  hosts: Host[]
  sshProfiles: SSHAccessProfile[]
  hasSavedTargetAuth: boolean
  targetAuthDraft: VNCTargetAuthDraft
  targetAuthError?: VNCTargetAuthDraftError
  disabled: boolean
  saving: boolean
  savingAndConnecting: boolean
  deleting: boolean
  onChange: (next: RemoteDesktopProfileDraft) => void
  onTargetAuthChange: (draft: VNCTargetAuthDraft) => void
  onCancel: () => void
  onSave: () => void
  onSaveAndConnect: () => void
  onDelete?: () => Promise<void>
}

export function RemoteDesktopProfileEditor({
  mode,
  profileName,
  draft,
  errors,
  submitted,
  hosts,
  sshProfiles,
  hasSavedTargetAuth,
  targetAuthDraft,
  targetAuthError,
  disabled,
  saving,
  savingAndConnecting,
  deleting,
  onChange,
  onTargetAuthChange,
  onCancel,
  onSave,
  onSaveAndConnect,
  onDelete,
}: RemoteDesktopProfileEditorProps) {
  const { t } = useTranslation()
  const nameError = submitted ? errors.name : undefined
  const hostError = submitted ? errors.host_id : undefined
  const sshProfileError = submitted ? errors.ssh_profile_id : undefined
  const portError = submitted ? errors.port : undefined
  const title = draft.name.trim()
    || profileName
    || t(mode === 'create' ? 'remoteDesktop.newProfile' : 'remoteDesktop.editProfile')

  return (
    <main className={styles.editor} data-profile-view={mode}>
      <header className={styles['editor-heading']}>
        <span className={styles['editor-heading-icon']} aria-hidden="true">
          <MonitorPlay size={20} />
        </span>
        <div className={styles['editor-heading-copy']}>
          <EditorModeContext
            mode={mode}
            label={t(mode === 'create' ? 'app.add' : 'app.edit')}
            title={<h2>{title}</h2>}
          />
          <p>{t('remoteDesktop.vncOverSsh')}</p>
        </div>
      </header>

      <div className={styles.form}>
        <ProfileEditorSection icon={<Server size={16} />} title={t('remoteDesktop.connectionSection')}>
          <div className={styles['form-grid']}>
            <label className={styles.field}>
              <span className={styles['field-label']}>{t('remoteDesktop.profileName')}</span>
              <Input
                id="remote-desktop-profile-name"
                name="remote-desktop-profile-name"
                autoFocus={mode === 'create'}
                value={draft.name}
                maxLength={80}
                status={nameError ? 'error' : undefined}
                disabled={disabled}
                onChange={(event) => onChange({ ...draft, name: event.target.value })}
              />
              {nameError ? <small className={styles['field-error']} role="alert">{t(`remoteDesktop.${nameError}`)}</small> : null}
            </label>
            <div className={`${styles.field} ${hostError ? styles['is-error'] : ''}`}>
              <CustomSelect
                label={t('remoteDesktop.sshHost')}
                value={draft.host_id}
                disabled={disabled || hosts.length === 0}
                options={hosts.map((host) => ({
                  value: host.id,
                  label: host.name,
                  description: `${host.username}@${host.address}:${host.port}`,
                }))}
                onChange={(host_id) => onChange({ ...draft, host_id, ssh_profile_id: '' })}
              />
              {hostError ? <small className={styles['field-error']} role="alert">{t(`remoteDesktop.${hostError}`)}</small> : null}
            </div>
            <div className={`${styles.field} ${sshProfileError ? styles['is-error'] : ''}`}>
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
              {sshProfileError ? <small className={styles['field-error']} role="alert">{t('remoteDesktop.validationHost')}</small> : null}
            </div>
            <label className={`${styles.field} ${styles['is-wide']}`}>
              <span className={styles['field-label']}>{t('remoteDesktop.description')}</span>
              <Input.TextArea
                id="remote-desktop-profile-description"
                name="remote-desktop-profile-description"
                value={draft.description}
                maxLength={240}
                autoSize={{ minRows: 2, maxRows: 4 }}
                disabled={disabled}
                onChange={(event) => onChange({ ...draft, description: event.target.value })}
              />
            </label>
          </div>
        </ProfileEditorSection>

        <ProfileEditorSection icon={<Network size={16} />} title={t('remoteDesktop.endpointSection')}>
          <div className={styles['form-grid']}>
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
                  vnc: {
                    ...draft.vnc,
                    loopback_host: loopback_host as '127.0.0.1' | '::1',
                  },
                })}
              />
            </div>
            <label className={styles.field}>
              <span className={styles['field-label']}>{t('remoteDesktop.port')}</span>
              <InputNumber
                id="remote-desktop-vnc-port"
                min={1}
                max={65535}
                value={draft.vnc.port}
                status={portError ? 'error' : undefined}
                disabled={disabled}
                onChange={(port) => onChange({
                  ...draft,
                  vnc: { ...draft.vnc, port: typeof port === 'number' ? port : null },
                })}
              />
              {portError ? <small className={styles['field-error']} role="alert">{t(`remoteDesktop.${portError}`)}</small> : null}
            </label>
          </div>
        </ProfileEditorSection>

        <ProfileEditorSection icon={<Settings2 size={16} />} title={t('remoteDesktop.viewerSection')}>
          <div className={styles['viewer-options']}>
            <div className={styles['display-option']}>
              <span className={styles['option-copy']}>
                <strong>{t('remoteDesktop.displayMode')}</strong>
                <small>{t('remoteDesktop.displayModeHint')}</small>
              </span>
              <Segmented<RemoteDesktopDisplayMode>
                block
                size="small"
                aria-label={t('remoteDesktop.displayMode')}
                value={draft.vnc.default_display_mode}
                disabled={disabled}
                options={[
                  { value: 'fit', label: <span className={styles['mode-option']}><Scaling size={13} />{t('remoteDesktop.display.fit')}</span> },
                  { value: 'resize', label: <span className={styles['mode-option']}><Scan size={13} />{t('remoteDesktop.display.resize')}</span> },
                  { value: 'actual', label: <span className={styles['mode-option']}><Maximize2 size={13} />{t('remoteDesktop.display.actual')}</span> },
                ]}
                onChange={(default_display_mode) => onChange({
                  ...draft,
                  vnc: { ...draft.vnc, default_display_mode },
                })}
              />
            </div>
            <div className={styles['switch-options']}>
              <label className={styles['switch-option']}>
                <span className={styles['option-copy']}>
                  <strong>{t('remoteDesktop.shared')}</strong>
                  <small>{t('remoteDesktop.sharedHint')}</small>
                </span>
                <Switch
                  checked={draft.vnc.shared}
                  disabled={disabled}
                  onChange={(shared) => onChange({ ...draft, vnc: { ...draft.vnc, shared } })}
                />
              </label>
              <label className={styles['switch-option']}>
                <span className={styles['option-copy']}>
                  <strong>{t('remoteDesktop.viewOnly')}</strong>
                  <small>{t('remoteDesktop.viewOnlyHint')}</small>
                </span>
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
          </div>
        </ProfileEditorSection>

        <VNCTargetAuthSection
          hasSavedAuth={hasSavedTargetAuth}
          draft={targetAuthDraft}
          error={targetAuthError}
          disabled={disabled}
          onChange={onTargetAuthChange}
        />
      </div>

      <footer className={styles.footer}>
        {mode === 'edit' && onDelete ? (
          <Popconfirm
            {...termousPopconfirmProps}
            title={t('remoteDesktop.deleteProfileTitle')}
            description={t('remoteDesktop.deleteProfileDescription', { name: profileName ?? draft.name })}
            okText={t('app.delete')}
            cancelText={t('app.cancel')}
            okButtonProps={{ danger: true }}
            disabled={disabled}
            onConfirm={onDelete}
          >
            <Button
              danger
              type="text"
              icon={<Trash2 size={15} />}
              loading={deleting}
              disabled={disabled}
            >
              {t('app.delete')}
            </Button>
          </Popconfirm>
        ) : <span />}
        <div className={styles['footer-actions']}>
          <Button disabled={disabled} onClick={onCancel}>{t('app.cancel')}</Button>
          <Button
            className={uiStyles['secondary-button']}
            icon={<Save size={15} />}
            loading={saving}
            disabled={disabled}
            onClick={onSave}
          >
            {t('app.save')}
          </Button>
          <ConnectionActionButton
            icon={<Cable size={16} />}
            loading={savingAndConnecting}
            disabled={disabled}
            onClick={onSaveAndConnect}
          >
            {t('remoteDesktop.saveAndConnect')}
          </ConnectionActionButton>
        </div>
      </footer>
    </main>
  )
}

function ProfileEditorSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <section className={styles['form-section']}>
      <header className={styles['section-heading']}>
        <span aria-hidden="true">{icon}</span>
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  )
}

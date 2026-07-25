import {
  CircleAlert,
  Download,
  ExternalLink,
  Info,
  Package,
  RefreshCw,
  Settings2,
} from 'lucide-react'
import { Button, Select, Switch } from 'antd'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import type {
  UpdateCheckInterval,
  UpdatePhase,
  UpdatePreferences,
  UpdateSnapshot,
} from '../../../electron/updateTypes'
import type { AppBuildInfo } from '../../types/domain'
import {
  RELEASES_URL,
  formatDateTime,
  formatPlatform,
  formatVersion,
  isPreferencePending,
  updateErrorLabel,
  updateStatusPresentation,
  type PendingPreferenceValues,
  type UpdatePreferenceKey,
  type UpdateWindowIntent,
} from './aboutSettingsHelpers'

type SavePreference = <Key extends UpdatePreferenceKey>(
  key: Key,
  value: UpdatePreferences[Key],
) => void

interface AboutSettingsViewProps {
  t: TFunction
  locale: string
  productName: string
  version: string
  buildInfo: AppBuildInfo | null
  snapshot: UpdateSnapshot | null
  preferences: UpdatePreferences | null
  phase: UpdatePhase
  updateSupported: boolean
  checking: boolean
  openingIntent: UpdateWindowIntent | null
  openingReleasePage: boolean
  pendingPreferenceValues: PendingPreferenceValues
  onCheck: () => void
  onOpenUpdate: (intent: UpdateWindowIntent) => void
  onOpenReleasePage: () => void
  onSavePreference: SavePreference
}

export function AboutSettingsView({
  t,
  locale,
  productName,
  version,
  buildInfo,
  snapshot,
  preferences,
  phase,
  updateSupported,
  checking,
  openingIntent,
  openingReleasePage,
  pendingPreferenceValues,
  onCheck,
  onOpenUpdate,
  onOpenReleasePage,
  onSavePreference,
}: AboutSettingsViewProps) {
  const status = updateStatusPresentation(phase, t)
  const preferencesReady = Boolean(preferences)
  const lastCheckedAt = snapshot?.checked_at ?? preferences?.last_checked_at ?? null
  const nextCheckAt = snapshot?.next_automatic_check_at ?? null
  const checkBusy = checking || phase === 'checking'
  const checkDisabled = (
    !updateSupported
    || checkBusy
    || phase === 'downloading'
    || phase === 'downloaded'
    || phase === 'preparing_install'
    || phase === 'installing'
  )
  const showStartUpdate = phase === 'available'
  const showInspectUpdate = (
    phase === 'downloading'
    || phase === 'downloaded'
    || phase === 'preparing_install'
    || phase === 'installing'
    || (phase === 'error' && Boolean(snapshot?.available_version))
  )

  return (
    <div className="settings-section about-settings-surface">
      <header className="about-settings-identity">
        <span className="about-settings-product-mark" aria-hidden="true">
          <img src="./termous-icon.png" alt="" />
        </span>
        <div className="about-settings-product-copy">
          <h2>{productName}</h2>
          <p>{t('settings.about.productDescription')}</p>
        </div>
        <span className="about-settings-version">{formatVersion(version)}</span>
      </header>

      <AboutSection
        id="about-software-information"
        icon={<Package size={17} aria-hidden="true" />}
        title={t('settings.about.softwareInfo')}
      >
        <dl className="about-settings-list">
          <DefinitionRow label={t('settings.about.productName')} value={productName} />
          <DefinitionRow label={t('settings.about.appVersion')} value={formatVersion(version)} numeric />
          <DefinitionRow
            label={t('settings.about.coreVersion')}
            value={buildInfo?.core_version ? formatVersion(buildInfo.core_version) : t('settings.about.unavailable')}
            numeric
          />
          <DefinitionRow
            label={t('settings.about.platform')}
            value={buildInfo ? `${formatPlatform(buildInfo.platform)} · ${buildInfo.arch}` : t('settings.about.unavailable')}
          />
          <DefinitionRow
            label={t('settings.about.updateChannel')}
            value={buildInfo ? t('settings.about.channelStable') : t('settings.about.unavailable')}
          />
          <DefinitionRow
            label={t('settings.about.updateSource')}
            value={(
              <a className="about-settings-link" href={RELEASES_URL} target="_blank" rel="noreferrer">
                {t('settings.about.githubReleases')}
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            )}
          />
        </dl>
      </AboutSection>

      <AboutSection
        id="about-update-status"
        icon={<Info size={17} aria-hidden="true" />}
        title={t('settings.about.updateStatusSection')}
      >
        <dl className="about-settings-list">
          <DefinitionRow
            label={t('settings.about.currentStatus')}
            value={(
              <span
                className={`about-update-status is-${status.tone}`}
                role="status"
                aria-live="polite"
              >
                {status.icon}
                {status.label}
              </span>
            )}
          />
          <DefinitionRow
            label={t('settings.about.availableVersion')}
            value={snapshot?.available_version ? formatVersion(snapshot.available_version) : t('settings.about.unavailable')}
            numeric
          />
          <DefinitionRow
            label={t('settings.about.lastChecked')}
            value={formatDateTime(lastCheckedAt, locale, t('settings.about.never'))}
          />
          <DefinitionRow
            label={t('settings.about.nextCheck')}
            value={formatDateTime(nextCheckAt, locale, t('settings.about.notScheduled'))}
          />
        </dl>

        {phase === 'unsupported' ? (
          <p className="about-update-message is-muted">{t('settings.about.updateUnsupportedHint')}</p>
        ) : null}
        {phase === 'error' ? (
          <p className="about-update-message is-error" role="alert">
            <CircleAlert size={15} aria-hidden="true" />
            {updateErrorLabel(snapshot?.error_code ?? null, t)}
          </p>
        ) : null}

        <div className="about-update-actions">
          <Button
            icon={<RefreshCw size={15} aria-hidden="true" />}
            loading={checkBusy}
            disabled={checkDisabled}
            onClick={onCheck}
          >
            {t('settings.about.checkForUpdates')}
          </Button>
          {showStartUpdate ? (
            <Button
              type="primary"
              icon={<Download size={15} aria-hidden="true" />}
              loading={openingIntent === 'start_download'}
              disabled={Boolean(openingIntent)}
              onClick={() => onOpenUpdate('start_download')}
            >
              {t('settings.about.updateNow')}
            </Button>
          ) : null}
          {showInspectUpdate ? (
            <Button
              type="primary"
              icon={<Info size={15} aria-hidden="true" />}
              loading={openingIntent === 'inspect'}
              disabled={Boolean(openingIntent)}
              onClick={() => onOpenUpdate('inspect')}
            >
              {t('settings.about.viewUpdate')}
            </Button>
          ) : null}
          <Button
            type="text"
            icon={<ExternalLink size={14} aria-hidden="true" />}
            loading={openingReleasePage}
            onClick={onOpenReleasePage}
          >
            {t('settings.about.openReleases')}
          </Button>
        </div>
      </AboutSection>

      <AboutSection
        id="about-update-preferences"
        icon={<Settings2 size={17} aria-hidden="true" />}
        title={t('settings.about.updatePreferencesSection')}
      >
        <div className="about-preference-list">
          <PreferenceRow
            label={t('settings.about.automaticCheck')}
            hint={t('settings.about.automaticCheckHint')}
            control={(
              <Switch
                checked={preferences?.automatic_check ?? false}
                loading={(
                  updateSupported
                  && (
                    !preferencesReady
                    || isPreferencePending(pendingPreferenceValues, 'automatic_check')
                  )
                )}
                disabled={!updateSupported || !preferencesReady}
                aria-label={t('settings.about.automaticCheck')}
                onChange={(checked) => onSavePreference('automatic_check', checked)}
              />
            )}
          />
          <PreferenceRow
            label={t('settings.about.checkInterval')}
            hint={t('settings.about.checkIntervalHint')}
            control={(
              <Select<UpdateCheckInterval>
                className="about-preference-select"
                value={preferences?.check_interval}
                loading={(
                  updateSupported
                  && (
                    !preferencesReady
                    || isPreferencePending(pendingPreferenceValues, 'check_interval')
                  )
                )}
                disabled={(
                  !updateSupported
                  || !preferencesReady
                  || !preferences?.automatic_check
                  || isPreferencePending(pendingPreferenceValues, 'automatic_check')
                )}
                aria-label={t('settings.about.checkInterval')}
                options={[
                  { value: 'startup', label: t('settings.about.intervalStartup') },
                  { value: 'daily', label: t('settings.about.intervalDaily') },
                  { value: 'weekly', label: t('settings.about.intervalWeekly') },
                ]}
                onChange={(value) => onSavePreference('check_interval', value)}
              />
            )}
          />
          <PreferenceRow
            label={t('settings.about.automaticDownload')}
            hint={t('settings.about.automaticDownloadHint')}
            control={(
              <Switch
                checked={preferences?.automatic_download ?? false}
                loading={(
                  updateSupported
                  && (
                    !preferencesReady
                    || isPreferencePending(pendingPreferenceValues, 'automatic_download')
                  )
                )}
                disabled={!updateSupported || !preferencesReady}
                aria-label={t('settings.about.automaticDownload')}
                onChange={(checked) => onSavePreference('automatic_download', checked)}
              />
            )}
          />
        </div>
      </AboutSection>
    </div>
  )
}

function AboutSection({
  id,
  icon,
  title,
  children,
}: {
  id: string
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <section className="about-settings-group" aria-labelledby={id}>
      <div className="about-settings-group-heading">
        <span className="about-settings-group-icon">{icon}</span>
        <h2 id={id}>{title}</h2>
      </div>
      {children}
    </section>
  )
}

function DefinitionRow({
  label,
  value,
  numeric = false,
}: {
  label: string
  value: ReactNode
  numeric?: boolean
}) {
  return (
    <div className="about-settings-definition">
      <dt>{label}</dt>
      <dd className={numeric ? 'is-numeric' : undefined}>{value}</dd>
    </div>
  )
}

function PreferenceRow({
  label,
  hint,
  control,
}: {
  label: string
  hint: string
  control: ReactNode
}) {
  return (
    <div className="about-preference-row">
      <div>
        <strong>{label}</strong>
        <p>{hint}</p>
      </div>
      <div className="about-preference-control">{control}</div>
    </div>
  )
}

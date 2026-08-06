import { Check, RefreshCw } from 'lucide-react'
import { Alert, Button, Select, Switch } from 'antd'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import type {
  UpdateCheckInterval,
  UpdatePreferences,
} from '#common/contracts'
import {
  isPreferencePending,
  type PendingPreferenceValues,
  type UpdatePreferenceKey,
} from '../../model/updateSettings'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './UpdateSettings.module.scss'

type SavePreference = <Key extends UpdatePreferenceKey>(
  key: Key,
  value: UpdatePreferences[Key],
) => void

interface UpdateSettingsViewProps {
  t: TFunction
  runtimeAvailable: boolean
  runtimeFailed: boolean
  retrying: boolean
  preferences: UpdatePreferences | null
  pendingPreferenceValues: PendingPreferenceValues
  onRetry: () => void
  onSavePreference: SavePreference
}

export function UpdateSettingsView({
  t,
  runtimeAvailable,
  runtimeFailed,
  retrying,
  preferences,
  pendingPreferenceValues,
  onRetry,
  onSavePreference,
}: UpdateSettingsViewProps) {
  const preferencesReady = Boolean(preferences)
  const preferencesLoading = (
    runtimeAvailable
    && !runtimeFailed
    && !preferencesReady
  )

  return (
    <div className={`${surfaceStyles.surface} ${styles['update-settings-surface']}`}>
      <header className={styles['update-settings-heading']}>
        <span className={styles['update-settings-heading-icon']} aria-hidden="true">
          <RefreshCw size={18} />
        </span>
        <div>
          <h2>{t('settings.update.title')}</h2>
          <p>{t('settings.update.description')}</p>
        </div>
      </header>
      {!runtimeAvailable || runtimeFailed ? (
        <Alert
          className="update-settings-unavailable"
          type="warning"
          showIcon
          title={t('settings.update.unavailableTitle')}
          description={t('settings.update.unavailableHint')}
          action={runtimeAvailable ? (
            <Button
              type="text"
              size="small"
              loading={retrying}
              onClick={onRetry}
            >
              {t('settings.update.retryLoading')}
            </Button>
          ) : undefined}
        />
      ) : null}
      <section aria-label={t('settings.update.title')}>
        <div className={styles['update-preference-list']}>
          <PreferenceRow
            label={t('settings.update.automaticCheck')}
            hint={t('settings.update.automaticCheckHint')}
            hintId="update-settings-automatic-check-hint"
            control={(
              <Switch
                checked={preferences?.automatic_check ?? false}
                loading={(
                  preferencesLoading
                  || isPreferencePending(pendingPreferenceValues, 'automatic_check')
                )}
                disabled={!preferencesReady}
                aria-label={t('settings.update.automaticCheck')}
                aria-describedby="update-settings-automatic-check-hint"
                onChange={(checked) => onSavePreference('automatic_check', checked)}
              />
            )}
          />
          <PreferenceRow
            label={t('settings.update.checkInterval')}
            hint={t('settings.update.checkIntervalHint')}
            hintId="update-settings-check-interval-hint"
            control={(
              <Select<UpdateCheckInterval>
                className={`termous-select ${styles['update-preference-select']}`}
                classNames={{
                  popup: {
                    root: `termous-select-popup ${styles['update-check-interval-popup']}`,
                  },
                }}
                value={preferences?.check_interval}
                loading={(
                  preferencesLoading
                  || isPreferencePending(pendingPreferenceValues, 'check_interval')
                )}
                disabled={(
                  !preferencesReady
                  || !preferences?.automatic_check
                  || isPreferencePending(pendingPreferenceValues, 'automatic_check')
                  || isPreferencePending(pendingPreferenceValues, 'check_interval')
                )}
                aria-label={t('settings.update.checkInterval')}
                aria-describedby="update-settings-check-interval-hint"
                options={[
                  { value: 'startup', label: t('settings.update.intervalStartup') },
                  { value: 'daily', label: t('settings.update.intervalDaily') },
                  { value: 'weekly', label: t('settings.update.intervalWeekly') },
                ]}
                menuItemSelectedIcon={<Check size={14} strokeWidth={2.2} />}
                onChange={(value) => onSavePreference('check_interval', value)}
              />
            )}
          />
          <PreferenceRow
            label={t('settings.update.automaticDownload')}
            hint={t('settings.update.automaticDownloadHint')}
            hintId="update-settings-automatic-download-hint"
            control={(
              <Switch
                checked={preferences?.automatic_download ?? false}
                loading={(
                  preferencesLoading
                  || isPreferencePending(pendingPreferenceValues, 'automatic_download')
                )}
                disabled={!preferencesReady}
                aria-label={t('settings.update.automaticDownload')}
                aria-describedby="update-settings-automatic-download-hint"
                onChange={(checked) => onSavePreference('automatic_download', checked)}
              />
            )}
          />
        </div>
      </section>
    </div>
  )
}

function PreferenceRow({
  label,
  hint,
  hintId,
  control,
}: {
  label: string
  hint: string
  hintId: string
  control: ReactNode
}) {
  return (
    <div className={styles['update-preference-row']}>
      <div>
        <strong>{label}</strong>
        <p id={hintId}>{hint}</p>
      </div>
      <div className={styles['update-preference-control']}>{control}</div>
    </div>
  )
}

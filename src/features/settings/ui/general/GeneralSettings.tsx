import { Segmented } from 'antd'
import { Moon, Settings2, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  AppLanguage,
  AppearanceSettings,
  WindowSettings,
} from '#common/contracts'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './GeneralSettings.module.scss'

interface GeneralSettingsProps {
  language: AppLanguage
  appearanceSettings: AppearanceSettings
  windowSettings: WindowSettings
  disabled: boolean
  onLanguageChange: (language: AppLanguage) => Promise<void>
  onAppearanceSettingsChange: (settings: AppearanceSettings) => Promise<void>
  onWindowSettingsChange: (settings: WindowSettings) => Promise<void>
}

export function GeneralSettings({
  language,
  appearanceSettings,
  windowSettings,
  disabled,
  onLanguageChange,
  onAppearanceSettingsChange,
  onWindowSettingsChange,
}: GeneralSettingsProps) {
  const { t } = useTranslation()

  return (
    <div className={surfaceStyles.surface}>
      <div className={surfaceStyles.header}>
        <Settings2 size={18} aria-hidden="true" />
        <h2>{t('settings.generalSection')}</h2>
      </div>
      <div className={surfaceStyles.row}>
        <div>
          <strong>{t('settings.appearanceTheme')}</strong>
        </div>
        <Segmented
          block
          className={surfaceStyles.segmented}
          value={appearanceSettings.theme}
          disabled={disabled}
          options={[
            {
              value: 'dark',
              label: (
                <span className={styles['segment-label']}>
                  <Moon size={14} aria-hidden="true" />
                  {t('settings.themeDark')}
                </span>
              ),
            },
            {
              value: 'light',
              label: (
                <span className={styles['segment-label']}>
                  <Sun size={14} aria-hidden="true" />
                  {t('settings.themeLight')}
                </span>
              ),
            },
          ]}
          onChange={(value) =>
            void onAppearanceSettingsChange({ theme: value as AppearanceSettings['theme'] })
          }
        />
      </div>
      <div className={surfaceStyles.row}>
        <div>
          <strong>{t('settings.interfaceLanguage')}</strong>
        </div>
        <Segmented
          block
          className={styles['language-switch']}
          value={language}
          disabled={disabled}
          options={[
            { value: 'zh-CN', label: t('settings.chinese') },
            { value: 'en-US', label: t('settings.english') },
          ]}
          onChange={(value) => void onLanguageChange(value as AppLanguage)}
        />
      </div>
      <div className={surfaceStyles.row}>
        <div>
          <strong>{t('settings.closeBehavior')}</strong>
          <p className={surfaceStyles.hint}>{t('settings.closeBehaviorHint')}</p>
        </div>
        <Segmented
          block
          className={surfaceStyles.segmented}
          value={windowSettings.close_behavior}
          disabled={disabled}
          options={[
            { value: 'exit', label: t('settings.closeBehaviorExit') },
            { value: 'minimize_to_tray', label: t('settings.closeBehaviorMinimizeToTray') },
          ]}
          onChange={(value) =>
            void onWindowSettingsChange({ close_behavior: value as WindowSettings['close_behavior'] })
          }
        />
      </div>
    </div>
  )
}

import { DatabaseBackup, Keyboard, RefreshCw, Settings2, SquareTerminal } from 'lucide-react'
import { Tabs } from 'antd'
import { useTranslation } from 'react-i18next'
import type {
  AppLanguage,
  AppearanceSettings,
  CompletionSettings,
  ShortcutSettings,
  ShortcutSettingsPatch,
  TerminalFont,
  TerminalSettings,
  WindowSettings,
} from '#common/contracts'
import { useShortcutRuntime } from '#entities/shortcuts'
import {
  DataPortabilitySettings,
  GeneralSettings,
  ShortcutSettingsPanel,
  TerminalCompletionSettings,
  TerminalStyleSettings,
  UpdateSettings,
  type UpdatePreferencesRuntime,
} from '#features/settings'
import styles from './SettingsPage.module.scss'

export interface SettingsPageProps {
  language: AppLanguage
  appearanceSettings: AppearanceSettings
  terminalSettings: TerminalSettings
  completionSettings: CompletionSettings
  shortcutSettings: ShortcutSettings
  windowSettings: WindowSettings
  terminalFonts: TerminalFont[]
  appVersion: string
  updatePreferencesRuntime?: UpdatePreferencesRuntime | null
  actionBusy: boolean
  onLanguageChange: (language: AppLanguage) => Promise<void>
  onAppearanceSettingsChange: (settings: AppearanceSettings) => Promise<void>
  onTerminalSettingsChange: (settings: TerminalSettings) => Promise<void>
  onCompletionSettingsChange: (settings: CompletionSettings) => Promise<void>
  onShortcutSettingsChange: (patch: ShortcutSettingsPatch) => Promise<void>
  onWindowSettingsChange: (settings: WindowSettings) => Promise<void>
  onUploadTerminalFont: (file: File) => Promise<TerminalFont>
  onDeleteTerminalFont: (id: string) => Promise<void>
}

export function SettingsPage({
  language,
  appearanceSettings,
  terminalSettings,
  completionSettings,
  shortcutSettings,
  windowSettings,
  terminalFonts,
  appVersion,
  updatePreferencesRuntime = null,
  actionBusy,
  onLanguageChange,
  onAppearanceSettingsChange,
  onTerminalSettingsChange,
  onCompletionSettingsChange,
  onShortcutSettingsChange,
  onWindowSettingsChange,
  onUploadTerminalFont,
  onDeleteTerminalFont,
}: SettingsPageProps) {
  const { t } = useTranslation()
  const { platform } = useShortcutRuntime()

  return (
    <section className={styles.page}>
      <div className="page-title-row">
        <div>
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.subtitle')}</p>
        </div>
      </div>
      <Tabs
        className={styles.tabs}
        items={[
          {
            key: 'general',
            label: (
              <span className={styles['tab-label']}>
                <Settings2 size={15} aria-hidden="true" />
                {t('settings.tabGeneral')}
              </span>
            ),
            children: (
              <div className={styles['tab-scroll']}>
                <GeneralSettings
                  language={language}
                  appearanceSettings={appearanceSettings}
                  windowSettings={windowSettings}
                  disabled={actionBusy}
                  onLanguageChange={onLanguageChange}
                  onAppearanceSettingsChange={onAppearanceSettingsChange}
                  onWindowSettingsChange={onWindowSettingsChange}
                />
              </div>
            ),
          },
          {
            key: 'terminal',
            label: (
              <span className={styles['tab-label']}>
                <SquareTerminal size={15} aria-hidden="true" />
                {t('settings.tabTerminal')}
              </span>
            ),
            children: (
              <div className={styles['tab-scroll']}>
                <div className={styles['terminal-stack']}>
                  <TerminalStyleSettings
                    value={terminalSettings}
                    fonts={terminalFonts}
                    disabled={actionBusy}
                    onChange={onTerminalSettingsChange}
                    onUploadFont={onUploadTerminalFont}
                    onDeleteFont={onDeleteTerminalFont}
                  />
                  <TerminalCompletionSettings
                    value={completionSettings}
                    disabled={actionBusy}
                    onChange={onCompletionSettingsChange}
                  />
                </div>
              </div>
            ),
          },
          {
            key: 'shortcuts',
            label: (
              <span className={styles['tab-label']}>
                <Keyboard size={15} aria-hidden="true" />
                {t('settings.tabShortcuts')}
              </span>
            ),
            children: (
              <div className={styles['tab-scroll']}>
                <ShortcutSettingsPanel
                  value={shortcutSettings}
                  platform={platform}
                  onPatchChanges={(changes) => onShortcutSettingsChange({ changes })}
                  onResetAll={() => onShortcutSettingsChange({ reset_all: true })}
                />
              </div>
            ),
          },
          {
            key: 'data',
            label: (
              <span className={styles['tab-label']}>
                <DatabaseBackup size={15} aria-hidden="true" />
                {t('settings.tabData')}
              </span>
            ),
            children: (
              <div className={styles['tab-scroll']}>
                <DataPortabilitySettings appVersion={appVersion} />
              </div>
            ),
          },
          {
            key: 'updates',
            label: (
              <span className={styles['tab-label']}>
                <RefreshCw size={15} aria-hidden="true" />
                {t('settings.tabUpdates')}
              </span>
            ),
            children: (
              <div className={styles['tab-scroll']}>
                <UpdateSettings updateRuntime={updatePreferencesRuntime} />
              </div>
            ),
          },
        ]}
      />
    </section>
  )
}

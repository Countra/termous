import { DatabaseBackup, Moon, RefreshCw, Settings2, SquareTerminal, Sun } from 'lucide-react'
import { Segmented, Tabs } from 'antd'
import { useTranslation } from 'react-i18next'
import type {
  AppearanceSettings,
  CompletionSettings,
  Language,
  TerminalFont,
  TerminalSettings,
  WindowSettings,
} from '../../types/domain'
import { UpdateSettings, type UpdatePreferencesRuntime } from './UpdateSettings'
import { TerminalStyleSettings } from './TerminalStyleSettings'
import { TerminalCompletionSettings } from './TerminalCompletionSettings'
import { DataPortabilitySettings } from './DataPortabilitySettings'

export interface SettingsPageProps {
  language: Language
  appearanceSettings: AppearanceSettings
  terminalSettings: TerminalSettings
  completionSettings: CompletionSettings
  windowSettings: WindowSettings
  terminalFonts: TerminalFont[]
  appVersion: string
  updatePreferencesRuntime?: UpdatePreferencesRuntime | null
  actionBusy: boolean
  onLanguageChange: (language: Language) => Promise<void>
  onAppearanceSettingsChange: (settings: AppearanceSettings) => Promise<void>
  onTerminalSettingsChange: (settings: TerminalSettings) => Promise<void>
  onCompletionSettingsChange: (settings: CompletionSettings) => Promise<void>
  onWindowSettingsChange: (settings: WindowSettings) => Promise<void>
  onUploadTerminalFont: (file: File) => Promise<TerminalFont>
  onDeleteTerminalFont: (id: string) => Promise<void>
}

export function SettingsPage({
  language,
  appearanceSettings,
  terminalSettings,
  completionSettings,
  windowSettings,
  terminalFonts,
  appVersion,
  updatePreferencesRuntime = null,
  actionBusy,
  onLanguageChange,
  onAppearanceSettingsChange,
  onTerminalSettingsChange,
  onCompletionSettingsChange,
  onWindowSettingsChange,
  onUploadTerminalFont,
  onDeleteTerminalFont,
}: SettingsPageProps) {
  const { t } = useTranslation()

  return (
    <section className="settings-page">
      <div className="page-title-row">
        <div>
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.subtitle')}</p>
        </div>
      </div>
      <Tabs
        className="settings-tabs"
        items={[
          {
            key: 'general',
            label: (
              <span className="settings-tab-label">
                <Settings2 size={15} aria-hidden="true" />
                {t('settings.tabGeneral')}
              </span>
            ),
            children: (
              <div className="settings-tab-scroll">
                <div className="settings-section">
                  <div className="settings-section-header">
                    <Settings2 size={18} aria-hidden="true" />
                    <h2>{t('settings.generalSection')}</h2>
                  </div>
                  <div className="settings-row">
                    <div>
                      <strong>{t('settings.appearanceTheme')}</strong>
                    </div>
                    <Segmented
                      block
                      className="settings-control-segmented"
                      value={appearanceSettings.theme}
                      disabled={actionBusy}
                      options={[
                        {
                          value: 'dark',
                          label: (
                            <span className="settings-segment-label">
                              <Moon size={14} aria-hidden="true" />
                              {t('settings.themeDark')}
                            </span>
                          ),
                        },
                        {
                          value: 'light',
                          label: (
                            <span className="settings-segment-label">
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
                  <div className="settings-row">
                    <div>
                      <strong>{t('settings.interfaceLanguage')}</strong>
                    </div>
                    <Segmented
                      block
                      className="settings-language-switch"
                      value={language}
                      disabled={actionBusy}
                      options={[
                        { value: 'zh-CN', label: t('settings.chinese') },
                        { value: 'en-US', label: t('settings.english') },
                      ]}
                      onChange={(value) => void onLanguageChange(value as Language)}
                    />
                  </div>
                  <div className="settings-row">
                    <div>
                      <strong>{t('settings.closeBehavior')}</strong>
                      <p className="settings-row-hint">{t('settings.closeBehaviorHint')}</p>
                    </div>
                    <Segmented
                      block
                      className="settings-control-segmented"
                      value={windowSettings.close_behavior}
                      disabled={actionBusy}
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
              </div>
            ),
          },
          {
            key: 'terminal',
            label: (
              <span className="settings-tab-label">
                <SquareTerminal size={15} aria-hidden="true" />
                {t('settings.tabTerminal')}
              </span>
            ),
            children: (
              <div className="settings-tab-scroll">
                <div className="terminal-settings-stack">
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
            key: 'data',
            label: (
              <span className="settings-tab-label">
                <DatabaseBackup size={15} aria-hidden="true" />
                {t('settings.tabData')}
              </span>
            ),
            children: (
              <div className="settings-tab-scroll">
                <DataPortabilitySettings appVersion={appVersion} />
              </div>
            ),
          },
          {
            key: 'updates',
            label: (
              <span className="settings-tab-label">
                <RefreshCw size={15} aria-hidden="true" />
                {t('settings.tabUpdates')}
              </span>
            ),
            children: (
              <div className="settings-tab-scroll">
                <UpdateSettings updateRuntime={updatePreferencesRuntime} />
              </div>
            ),
          },
        ]}
      />
    </section>
  )
}

import { Languages, SquareTerminal } from 'lucide-react'
import { Segmented, Tabs } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Language, TerminalFont, TerminalSettings } from '../../types/domain'
import { TerminalStyleSettings } from './TerminalStyleSettings'

interface SettingsPageProps {
  language: Language
  terminalSettings: TerminalSettings
  terminalFonts: TerminalFont[]
  actionBusy: boolean
  onLanguageChange: (language: Language) => Promise<void>
  onTerminalSettingsChange: (settings: TerminalSettings) => Promise<void>
  onUploadTerminalFont: (file: File) => Promise<TerminalFont>
  onDeleteTerminalFont: (id: string) => Promise<void>
}

export function SettingsPage({
  language,
  terminalSettings,
  terminalFonts,
  actionBusy,
  onLanguageChange,
  onTerminalSettingsChange,
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
            key: 'language',
            label: (
              <span className="settings-tab-label">
                <Languages size={15} aria-hidden="true" />
                {t('settings.tabLanguage')}
              </span>
            ),
            children: (
              <div className="settings-section">
                <div className="settings-section-header">
                  <Languages size={18} aria-hidden="true" />
                  <h2>{t('settings.languageSection')}</h2>
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
              <TerminalStyleSettings
                value={terminalSettings}
                fonts={terminalFonts}
                disabled={actionBusy}
                onChange={onTerminalSettingsChange}
                onUploadFont={onUploadTerminalFont}
                onDeleteFont={onDeleteTerminalFont}
              />
            ),
          },
        ]}
      />
    </section>
  )
}

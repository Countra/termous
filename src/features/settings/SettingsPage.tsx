import { Languages } from 'lucide-react'
import { Segmented } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Language, TerminalSettings } from '../../types/domain'
import { TerminalStyleSettings } from './TerminalStyleSettings'

interface SettingsPageProps {
  language: Language
  terminalSettings: TerminalSettings
  actionBusy: boolean
  onLanguageChange: (language: Language) => Promise<void>
  onTerminalSettingsChange: (settings: TerminalSettings) => Promise<void>
}

export function SettingsPage({
  language,
  terminalSettings,
  actionBusy,
  onLanguageChange,
  onTerminalSettingsChange,
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
      <TerminalStyleSettings value={terminalSettings} disabled={actionBusy} onChange={onTerminalSettingsChange} />
    </section>
  )
}

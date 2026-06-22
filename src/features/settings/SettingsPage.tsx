import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CustomSelect } from '../../components/ui/CustomSelect'
import type { Language } from '../../types/domain'

interface SettingsPageProps {
  language: Language
  actionBusy: boolean
  onLanguageChange: (language: Language) => Promise<void>
}

export function SettingsPage({ language, actionBusy, onLanguageChange }: SettingsPageProps) {
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
          <CustomSelect
            label={t('settings.interfaceLanguage')}
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
    </section>
  )
}


import { Switch } from 'antd'
import { TextCursorInput } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CompletionSettings } from '../../types/domain'

interface TerminalCompletionSettingsProps {
  value: CompletionSettings
  disabled: boolean
  onChange: (value: CompletionSettings) => Promise<void>
}

export function TerminalCompletionSettings({
  value,
  disabled,
  onChange,
}: TerminalCompletionSettingsProps) {
  const { t } = useTranslation()

  return (
    <div className="settings-section terminal-completion-section">
      <div className="settings-section-header">
        <TextCursorInput size={18} aria-hidden="true" />
        <h2>{t('settings.completionTitle')}</h2>
      </div>
      <div className="settings-row terminal-completion-row">
        <div>
          <strong>{t('settings.completionEnabled')}</strong>
          <p className="settings-row-hint">{t('settings.completionHint')}</p>
        </div>
        <Switch
          checked={value.enabled}
          disabled={disabled}
          aria-label={t('settings.completionEnabled')}
          onChange={(enabled) => void onChange({ enabled })}
        />
      </div>
    </div>
  )
}

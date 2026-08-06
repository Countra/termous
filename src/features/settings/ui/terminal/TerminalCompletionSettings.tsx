import { Collapse, Switch } from 'antd'
import {
  Command,
  FileCode2,
  FolderTree,
  History,
  SquareTerminal,
  TextCursorInput,
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { CompletionProviderId, CompletionSettings } from '#common/contracts'
import { completionProviderIds } from '#entities/settings'
import surfaceStyles from '../SettingsSurface.module.scss'
import styles from './TerminalCompletionSettings.module.scss'

interface TerminalCompletionSettingsProps {
  value: CompletionSettings
  disabled: boolean
  onChange: (value: CompletionSettings) => Promise<void>
}

type CompletionSettingKey = 'enabled' | CompletionProviderId

const providerIcons: Record<CompletionProviderId, ReactNode> = {
  native: <SquareTerminal size={16} aria-hidden="true" />,
  alias: <Command size={16} aria-hidden="true" />,
  snippet: <FileCode2 size={16} aria-hidden="true" />,
  history: <History size={16} aria-hidden="true" />,
  directory: <FolderTree size={16} aria-hidden="true" />,
}

const providerStatusClassNames = {
  active: styles['provider-status'],
  paused: `${styles['provider-status']} ${styles.paused}`,
} as const

export function TerminalCompletionSettings({
  value,
  disabled,
  onChange,
}: TerminalCompletionSettingsProps) {
  const { t } = useTranslation()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [pendingKeys, setPendingKeys] = useState<Set<CompletionSettingKey>>(() => new Set())
  const pendingKeysRef = useRef(new Set<CompletionSettingKey>())
  const enabledProviderCount = completionProviderIds.filter(
    (providerId) => value.providers[providerId],
  ).length

  const updateSetting = async (
    settingKey: CompletionSettingKey,
    nextValue: CompletionSettings,
  ) => {
    if (pendingKeysRef.current.size > 0) {
      return
    }
    pendingKeysRef.current = new Set([settingKey])
    setPendingKeys(pendingKeysRef.current)
    try {
      await onChange(nextValue)
    } finally {
      pendingKeysRef.current = new Set()
      setPendingKeys(pendingKeysRef.current)
    }
  }

  return (
    <div className={surfaceStyles.surface}>
      <div className={surfaceStyles.header}>
        <TextCursorInput size={18} aria-hidden="true" />
        <h2>{t('settings.completionTitle')}</h2>
      </div>
      <div className={`${surfaceStyles.row} ${styles.row}`}>
        <div className={styles['setting-copy']}>
          <strong>{t('settings.completionEnabled')}</strong>
          <p className={`${surfaceStyles.hint} ${styles.hint}`}>{t('settings.completionHint')}</p>
        </div>
        <Switch
          checked={value.enabled}
          disabled={disabled || pendingKeys.size > 0}
          loading={pendingKeys.has('enabled')}
          aria-label={t('settings.completionEnabled')}
          onChange={(enabled) => void updateSetting('enabled', { ...value, enabled })}
        />
      </div>
      <Collapse
        ghost
        activeKey={detailsOpen ? ['providers'] : []}
        className={styles.providers}
        expandIconPlacement="end"
        onChange={(key) => setDetailsOpen(
          Array.isArray(key) ? key.includes('providers') : key === 'providers',
        )}
        items={[
          {
            key: 'providers',
            label: (
              <span className={styles['providers-heading']}>
                <span className={styles['setting-copy']}>
                  <strong>{t('settings.completionProviders')}</strong>
                  <span className={`${surfaceStyles.hint} ${styles.hint}`}>
                    {t('settings.completionProvidersHint')}
                  </span>
                </span>
                <span className={providerStatusClassNames[value.enabled ? 'active' : 'paused']}>
                  {value.enabled
                    ? t('settings.completionProvidersEnabled', {
                        count: enabledProviderCount,
                        total: completionProviderIds.length,
                      })
                    : t('settings.completionProvidersPaused', {
                        count: enabledProviderCount,
                        total: completionProviderIds.length,
                      })}
                </span>
              </span>
            ),
            children: (
              <div className={styles['provider-list']}>
                {completionProviderIds.map((providerId) => (
                  <div className={styles['provider-row']} key={providerId}>
                    <span className={styles['provider-icon']}>
                      {providerIcons[providerId]}
                    </span>
                    <span className={styles['provider-copy']}>
                      <strong>{t(`settings.completionProvider.${providerId}.name`)}</strong>
                      <small>{t(`settings.completionProvider.${providerId}.description`)}</small>
                    </span>
                    <Switch
                      checked={value.providers[providerId]}
                      disabled={disabled || !value.enabled || pendingKeys.size > 0}
                      loading={pendingKeys.has(providerId)}
                      aria-label={t(`settings.completionProvider.${providerId}.name`)}
                      onChange={(enabled) => void updateSetting(providerId, {
                        ...value,
                        providers: {
                          ...value.providers,
                          [providerId]: enabled,
                        },
                      })}
                    />
                  </div>
                ))}
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}

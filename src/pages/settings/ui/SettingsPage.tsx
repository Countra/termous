import { NotificationSettings } from '#features/notifications'
import { Bot, DatabaseBackup, HardDrive, Keyboard, Network, RefreshCw, Settings2, SquareTerminal } from 'lucide-react'
import { Tabs } from 'antd'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useAgentDefaultModelStatus, type AgentDefaultModelStatusGateway } from '#entities/agent'
import type {
  AppLanguage,
  AppearanceSettings,
  CompletionSettings,
  ConnectionSettings,
  ShortcutSettings,
  ShortcutSettingsPatch,
  TerminalFont,
  TerminalSettings,
  WindowSettings,
} from '#common/contracts'
import { useShortcutRuntime } from '#entities/shortcuts'
import { AgentSettingsPanel, type AgentSetupGateway } from '#features/agent-setup'
import { McpSettingsPanel } from '#features/mcp-access'
import { McpIcon } from '#shared/ui'
import {
  DataPortabilitySettings,
  ConnectionSettings as ConnectionSettingsPanel,
  GeneralSettings,
  MountSettings,
  type MountSettingsGateway,
  ShortcutSettingsPanel,
  TerminalCompletionSettings,
  TerminalStyleSettings,
  UpdateSettings,
  type DataPortabilityGateway,
  type UpdatePreferencesRuntime,
} from '#features/settings'
import styles from './SettingsPage.module.scss'

export type SettingsPageTabKey =
  | 'general'
  | 'terminal'
  | 'connection'
  | 'mount'
  | 'shortcuts'
  | 'agent'
  | 'mcp'
  | 'data'
  | 'updates'

export interface SettingsPageProps {
  initialTab?: SettingsPageTabKey
  language: AppLanguage
  appearanceSettings: AppearanceSettings
  terminalSettings: TerminalSettings
  sshSmoothScrollEnabled: boolean
  completionSettings: CompletionSettings
  connectionSettings: ConnectionSettings
  shortcutSettings: ShortcutSettings
  windowSettings: WindowSettings
  terminalFonts: TerminalFont[]
  appVersion: string
  dataPortabilityGateway: DataPortabilityGateway
  mountSettingsGateway?: MountSettingsGateway
  agentSetupGateway: AgentSetupGateway
  defaultModelStatusGateway?: AgentDefaultModelStatusGateway
  updatePreferencesRuntime?: UpdatePreferencesRuntime | null
  actionBusy: boolean
  onLanguageChange: (language: AppLanguage) => Promise<void>
  onAppearanceSettingsChange: (settings: AppearanceSettings) => Promise<void>
  onTerminalSettingsChange: (settings: TerminalSettings) => Promise<void>
  onSshSmoothScrollChange: (enabled: boolean) => void
  onCompletionSettingsChange: (settings: CompletionSettings) => Promise<void>
  onConnectionSettingsChange: (settings: ConnectionSettings) => Promise<void>
  onShortcutSettingsChange: (patch: ShortcutSettingsPatch) => Promise<void>
  onWindowSettingsChange: (settings: WindowSettings) => Promise<void>
  onUploadTerminalFont: (file: File) => Promise<TerminalFont>
  onDeleteTerminalFont: (id: string) => Promise<void>
}

export function SettingsPage({
  initialTab = 'general',
  language,
  appearanceSettings,
  terminalSettings,
  sshSmoothScrollEnabled,
  completionSettings,
  connectionSettings,
  shortcutSettings,
  windowSettings,
  terminalFonts,
  appVersion,
  dataPortabilityGateway,
  mountSettingsGateway,
  agentSetupGateway,
  defaultModelStatusGateway,
  updatePreferencesRuntime = null,
  actionBusy,
  onLanguageChange,
  onAppearanceSettingsChange,
  onTerminalSettingsChange,
  onSshSmoothScrollChange,
  onCompletionSettingsChange,
  onConnectionSettingsChange,
  onShortcutSettingsChange,
  onWindowSettingsChange,
  onUploadTerminalFont,
  onDeleteTerminalFont,
}: SettingsPageProps) {
  const { t } = useTranslation()
  const { platform } = useShortcutRuntime()
  const [activeTab, setActiveTab] = useState(initialTab)
  const modelStatus = useAgentDefaultModelStatus(defaultModelStatusGateway?.getDefaultModelStatus, activeTab === 'terminal')

  return (
    <section className={styles.page}>
      <div className={styles['page-title-row']} data-tour="settings-workspace">
        <div>
          <h1>{t('settings.title')}</h1>
          <p>{t('settings.subtitle')}</p>
        </div>
      </div>
      <Tabs
        className={styles.tabs}
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as SettingsPageTabKey)}
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
                <GeneralSettings notificationSettings={<NotificationSettings disabled={actionBusy} />}
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
              <span className={styles['tab-label']} data-tour="settings-terminal-tab">
                <SquareTerminal size={15} aria-hidden="true" />
                {t('settings.tabTerminal')}
              </span>
            ),
            children: (
              <div className={styles['tab-scroll']} data-tour="settings-terminal">
                <div className={styles['terminal-stack']}>
                  <TerminalStyleSettings
                    value={terminalSettings}
                    sshSmoothScrollEnabled={sshSmoothScrollEnabled}
                    fonts={terminalFonts}
                    disabled={actionBusy}
                    onChange={onTerminalSettingsChange}
                    onSshSmoothScrollChange={onSshSmoothScrollChange}
                    onUploadFont={onUploadTerminalFont}
                    onDeleteFont={onDeleteTerminalFont}
                  />
                  <TerminalCompletionSettings
                    value={completionSettings}
                    disabled={actionBusy}
                    onChange={onCompletionSettingsChange}
                    modelStatus={modelStatus}
                    onOpenAgentSettings={() => setActiveTab('agent')}
                  />
                </div>
              </div>
            ),
          },
          {
            key: 'connection',
            label: (
              <span className={styles['tab-label']}>
                <Network size={15} aria-hidden="true" />
                {t('settings.tabConnection')}
              </span>
            ),
            children: (
              <div className={styles['tab-scroll']}>
                <ConnectionSettingsPanel
                  value={connectionSettings}
                  disabled={actionBusy}
                  onChange={onConnectionSettingsChange}
                />
              </div>
            ),
          },
          {
            key: 'mount',
            label: <span className={styles['tab-label']} data-tour="settings-mount-tab"><HardDrive size={15} aria-hidden="true" />{t('settings.tabMount')}</span>,
            children: <div className={styles['tab-scroll']} data-tour="settings-mount"><MountSettings gateway={mountSettingsGateway} disabled={actionBusy} /></div>,
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
            key: 'agent',
            label: (
              <span className={styles['tab-label']} data-tour="settings-agent-tab">
                <Bot size={15} aria-hidden="true" />
                {t('settings.tabAgent')}
              </span>
            ),
            children: (
              <div className={styles['tab-scroll']} data-tour="settings-agent">
                <AgentSettingsPanel gateway={agentSetupGateway} />
              </div>
            ),
          },
          {
            key: 'mcp',
            label: (
              <span className={styles['tab-label']} data-tour="settings-mcp-tab">
                <McpIcon size={15} aria-hidden="true" />
                {t('settings.tabMcp')}
              </span>
            ),
            children: (
              <div className={styles['tab-scroll']} data-tour="settings-mcp">
                <McpSettingsPanel />
              </div>
            ),
          },
          {
            key: 'data',
            label: (
              <span className={styles['tab-label']} data-tour="settings-data-tab">
                <DatabaseBackup size={15} aria-hidden="true" />
                {t('settings.tabData')}
              </span>
            ),
            children: (
              <div className={styles['tab-scroll']} data-tour="settings-data">
                <DataPortabilitySettings
                  appVersion={appVersion}
                  gateway={dataPortabilityGateway}
                />
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

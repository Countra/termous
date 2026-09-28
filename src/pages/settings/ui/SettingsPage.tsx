import { SettingsGatewayContext, type SettingsGateway } from '#entities/settings'
import { Tabs } from 'antd'
import { useTranslation } from 'react-i18next'
import { useState, type ReactNode } from 'react'
import { useAgentDefaultModelStatus, type AgentDefaultModelStatusGateway } from '#entities/agent'
import type {
  AppLanguage,
  AppearanceSettings,
  CompletionSettings,
  CompletionSettingsPatch,
  ConnectionSettings,
  ConnectionSettingsPatch,
  ShortcutSettings,
  ShortcutSettingsPatch,
  TerminalFont,
  TerminalSettings,
  WindowSettings,
} from '#common/contracts'
import { useShortcutRuntime } from '#entities/shortcuts'
import { AgentSettingsPanel, type AgentSetupGateway } from '#features/agent-setup'
import { McpSettingsPanel } from '#features/mcp-access'
import {
  DataPortabilitySettings,
  ConnectionSettings as ConnectionSettingsPanel,
  GeneralSettings,
  NotificationSettings,
  MountSettings,
  type MountSettingsGateway,
  AuditSettings,
  type AuditSettingsGateway,
  ShortcutSettingsPanel,
  TerminalCompletionSettings,
  TerminalStyleSettings,
  UpdateSettings,
  type DataPortabilityGateway,
  type UpdatePreferencesRuntime,
} from '#features/settings'
import styles from './SettingsPage.module.scss'

import { settingsPages, type SettingsPageTabKey } from '../model/registry'
export type { SettingsPageTabKey } from '../model/registry'

export interface SettingsPageProps {
  settingsGateway?: SettingsGateway
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
  auditSettingsGateway: AuditSettingsGateway
  agentSetupGateway: AgentSetupGateway
  defaultModelStatusGateway?: AgentDefaultModelStatusGateway
  updatePreferencesRuntime?: UpdatePreferencesRuntime | null
  actionBusy: boolean
  onLanguageChange: (language: AppLanguage) => Promise<void>
  onAppearanceSettingsChange: (settings: AppearanceSettings) => Promise<void>
  onTerminalSettingsChange: (settings: TerminalSettings) => Promise<void>
  onSshSmoothScrollChange: (enabled: boolean) => void
  onCompletionSettingsChange: (patch: CompletionSettingsPatch) => Promise<void>
  onConnectionSettingsChange: (patch: ConnectionSettingsPatch) => Promise<void>
  onShortcutSettingsChange: (patch: ShortcutSettingsPatch) => Promise<void>
  onWindowSettingsChange: (settings: WindowSettings) => Promise<void>
  onUploadTerminalFont: (file: File) => Promise<TerminalFont>
  onDeleteTerminalFont: (id: string) => Promise<void>
}

export function SettingsPage({
  settingsGateway,
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
  auditSettingsGateway,
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

  const panels: Record<SettingsPageTabKey, ReactNode> = {
    general: (
      <div className={styles['tab-scroll']}>
        <div className={styles['settings-stack']}>
          <GeneralSettings
            language={language}
            appearanceSettings={appearanceSettings}
            windowSettings={windowSettings}
            disabled={actionBusy}
            onLanguageChange={onLanguageChange}
            onAppearanceSettingsChange={onAppearanceSettingsChange}
            onWindowSettingsChange={onWindowSettingsChange}
          />
          <NotificationSettings disabled={actionBusy} />
        </div>
      </div>
    ),
    terminal: (
      <div className={styles['tab-scroll']} data-tour="settings-terminal">
        <div className={styles['settings-stack']}>
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
    connection: (
      <div className={styles['tab-scroll']}>
        <ConnectionSettingsPanel
          value={connectionSettings}
          disabled={actionBusy}
          onChange={onConnectionSettingsChange}
        />
      </div>
    ),
    mount: <div className={styles['tab-scroll']} data-tour="settings-mount"><MountSettings gateway={mountSettingsGateway} disabled={actionBusy} /></div>,
    shortcuts: (
      <div className={styles['tab-scroll']}>
        <ShortcutSettingsPanel
          value={shortcutSettings}
          platform={platform}
          onPatchChanges={(changes) => onShortcutSettingsChange({ changes })}
          onResetAll={() => onShortcutSettingsChange({ reset_all: true })}
        />
      </div>
    ),
    agent: (
      <div className={styles['tab-scroll']} data-tour="settings-agent">
        <AgentSettingsPanel gateway={agentSetupGateway} />
      </div>
    ),
    mcp: (
      <div className={styles['tab-scroll']} data-tour="settings-mcp">
        <McpSettingsPanel />
      </div>
    ),
    audit: <div className={styles['tab-scroll']}><AuditSettings gateway={auditSettingsGateway} disabled={actionBusy} /></div>,
    data: (
      <div className={styles['tab-scroll']} data-tour="settings-data">
        <DataPortabilitySettings
          appVersion={appVersion}
          gateway={dataPortabilityGateway}
        />
      </div>
    ),
    updates: (
      <div className={styles['tab-scroll']}>
        <UpdateSettings updateRuntime={updatePreferencesRuntime} />
      </div>
    ),
  }

  return (
    <SettingsGatewayContext.Provider value={settingsGateway ?? null}>
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
          items={settingsPages.map((entry) => {
            const Icon = entry.icon
            return { key: entry.id, children: panels[entry.id], label: <span className={styles['tab-label']} data-tour={'tour' in entry ? entry.tour : undefined}><Icon size={15} aria-hidden="true" />{t(entry.title)}</span> }
          })}
        />
      </section>
    </SettingsGatewayContext.Provider>
  )
}

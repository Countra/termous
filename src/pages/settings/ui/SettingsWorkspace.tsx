import { SettingsGatewayContext, type SettingsEditor, type SettingsGateway } from '#entities/settings'
import { useTranslation } from 'react-i18next'
import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react'
import { ConfirmDialog, SettingsSaveBar } from '#shared/ui'
import { SettingsNavigation } from './SettingsNavigation'
import { SettingsPanelBoundary } from './SettingsPanelBoundary'
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
  RemoteDesktopSettings,
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
import styles from './SettingsWorkspace.module.scss'

import { settingsPages, type SettingsPageTabKey } from '../model/registry'

export interface SettingsWorkspaceProps {
  settingsGateway?: SettingsGateway
  onDirtyChange?: (dirty: boolean) => void
  onBusyChange?: (busy: boolean) => void
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

export function SettingsWorkspace({
  settingsGateway,
  initialTab = 'general',
  onDirtyChange,
  onBusyChange,
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
}: SettingsWorkspaceProps) {
  const { t } = useTranslation()
  const { platform } = useShortcutRuntime()
  const [activeTab, setActiveTab] = useState(initialTab)
  const [visited, setVisited] = useState(() => new Set<SettingsPageTabKey>([initialTab]))
  const [editors, setEditors] = useState<Partial<Record<SettingsPageTabKey, SettingsEditor>>>({})
  const [pendingTab, setPendingTab] = useState<SettingsPageTabKey | null>(null)
  const registerEditor = useCallback((id: SettingsPageTabKey, editor: SettingsEditor | null) => {
    setEditors(current => {
      if (current[id] === (editor ?? undefined)) return current
      const next = { ...current }
      if (editor) next[id] = editor
      else delete next[id]
      return next
    })
  }, [])
  const currentEditor = editors[activeTab]
  const dirty = Object.values(editors).some(editor => editor?.dirty)
  const busy = Object.values(editors).some(editor => editor?.busy)
  const navigationBusy = busy || pendingTab !== null
  useLayoutEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useLayoutEffect(() => { onBusyChange?.(navigationBusy) }, [navigationBusy, onBusyChange])
  useLayoutEffect(() => () => { onDirtyChange?.(false); onBusyChange?.(false) }, [onDirtyChange, onBusyChange])
  const selectTab = (id: SettingsPageTabKey) => {
    if (id === activeTab || busy) return
    if (currentEditor?.dirty) { setPendingTab(id); return }
    setVisited(current => new Set([...current, id]))
    setActiveTab(id)
  }
  const entry = settingsPages.find(page => page.id === activeTab)!

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
            onOpenAgentSettings={() => selectTab('agent')}
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
    'remote-desktop': (
      <div className={styles['tab-scroll']}>
        <RemoteDesktopSettings value={connectionSettings} disabled={actionBusy} onChange={onConnectionSettingsChange} />
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
        <AgentSettingsPanel gateway={agentSetupGateway} active={activeTab === 'agent'} />
      </div>
    ),
    models: <div className={styles['tab-scroll']} data-tour="settings-models"><AgentSettingsPanel gateway={agentSetupGateway} view="models" active={activeTab === 'models'} /></div>,
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
      <section className={styles.workspace} data-tour="settings-workspace">
        <SettingsNavigation active={activeTab} disabled={busy} onSelect={selectTab} />
        <div className={styles.canvas}>
          <header className={styles['panel-header']}>
            <div><h2>{t(entry.title)}</h2><p>{t(`settings.descriptions.${entry.id}`)}</p></div>
          </header>
          <div className={styles.panels}>
            {settingsPages.filter(page => visited.has(page.id)).map(page =>
              <SettingsPanelBoundary key={page.id} id={page.id} active={activeTab === page.id} onChange={registerEditor}>
                {panels[page.id]}
              </SettingsPanelBoundary>)}
          </div>
          {entry.mode === 'manual' && currentEditor && <SettingsSaveBar dirty={currentEditor.dirty}
            busy={currentEditor.busy} saving={currentEditor.saving} invalid={currentEditor.invalid} ready={currentEditor.ready} saved={currentEditor.saved}
            onSave={currentEditor.save} onReset={currentEditor.reset} />}
        </div>
        <ConfirmDialog open={pendingTab !== null} title={t('settings.editor.leaveTitle')}
          description={t('settings.editor.leaveDescription')} confirmLabel={t('settings.editor.discard')}
          onCancel={() => setPendingTab(null)} danger onConfirm={() => {
            if (!pendingTab || busy) return
            currentEditor?.reset()
            setVisited(current => new Set([...current].filter(id => id !== activeTab).concat(pendingTab)))
            setActiveTab(pendingTab)
            setPendingTab(null)
          }} />
      </section>
    </SettingsGatewayContext.Provider>
  )
}

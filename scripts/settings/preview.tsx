import { createModelServiceFixture } from './modelServiceFixture'
import { PreviewMcpProvider } from './PreviewMcpProvider'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '#shared/styles'
import { TermousUiProvider } from '#app/ui-runtime'
import { SettingsDialog } from '#pages/settings'
import { AppShell } from '#app/app-shell'
import { UpdateRuntimeContext, type UpdateRuntimeValue } from '#features/update'
import { WorkspaceEmptyState } from '#shared/ui'
import { SquareTerminal } from 'lucide-react'
import { ShortcutRuntime, ShortcutRuntimeContextProvider, defaultShortcutSettings } from '#entities/shortcuts'
import { defaultCompletionSettings, defaultConnectionSettings, defaultTerminalSettings, SettingsModuleStore } from '#entities/settings'
import { systemClipboardCapabilities } from '#entities/system-clipboard'
import { defaultExecutionBudget, type SettingsModuleId, type SettingsSnapshot, type UpdatePreferences, type WindowSettings } from '#common/contracts'
import type { AgentReadiness } from '#entities/agent'
import type { AgentSetupGateway } from '#features/agent-setup'
import type { DataPortabilityGateway, UpdatePreferencesRuntime } from '#features/settings'

// 验收入口只使用内存数据，不装配 Core、账号、密钥或系统设置桥接。
const disconnectClipboard = systemClipboardCapabilities.connect({
  get: async () => ({ version: 1, status: 'connected', snapshot: {
    schema_version: 1, instance_id: 'settings-preview', revision: 1,
    capabilities: { import_files: { state: 'ready' }, publish_files: { state: 'ready' } },
  } }),
  subscribe: () => () => {},
})

let readiness: AgentReadiness = {
  status: 'ready', mcp_runtime: { status: 'ready', message: '' }, mcp_client: { status: 'ready', message: '' },
  skills_bundle: { status: 'ready', message: '' }, default_model: { status: 'ready', message: '' },
  mcp_policy: { client_id: 'preview', approval_bypass: false, scope_count: 29, required_scope_count: 29, scope_sync_required: false, revision: 1 },
  settings: { default_model_id: 'model-0', default_reasoning_level: 'off', global_context_window_tokens: 16_384, global_max_output_tokens: 4_096,
    max_concurrent_runs: 4, context_compaction_threshold_percent: 80, connect_ssh_profile_on_bind: false,
    show_turn_token_usage: true, execution_budget: defaultExecutionBudget, revision: 1, created_at: '', updated_at: '' },
}
const agentGateway: AgentSetupGateway = {
  settings: async () => structuredClone(readiness.settings),
  readiness: async () => structuredClone(readiness), setup: async () => structuredClone(readiness),
  ...createModelServiceFixture(() => readiness.settings, new URLSearchParams(location.search).has('save-error')),
  updateSettings: async input => {
    const { expected_revision, ...value } = input
    readiness = { ...readiness, settings: { ...readiness.settings, ...value, revision: expected_revision + 1 } }
    return readiness.settings
  },
  updateMcpPolicy: async input => {
    readiness = { ...readiness, mcp_policy: { ...readiness.mcp_policy!, approval_bypass: input.approval_bypass, revision: input.expected_revision + 1 } }
    return readiness.mcp_policy!
  },
}

const snapshots = new Map<SettingsModuleId, SettingsSnapshot>([
  ['notifications', { id: 'notifications', schema_version: 1, revision: 1, value: { enabled: true, agent: true, file: true, approval: true, cloud: true }, state: { status: 'applied', supported: true } }],
  ['desktop_clipboard', { id: 'desktop_clipboard', schema_version: 1, revision: 1, value: { enabled: true }, state: { status: 'applied' } }],
  ['login_item', { id: 'login_item', schema_version: 1, revision: 1, value: { enabled: false }, state: { status: 'applied', available: true } }],
  ['audit', { id: 'audit', schema_version: 1, revision: 1, value: { enabled: true, retention_days: 90, max_records: 0 }, state: { status: 'applied' } }],
  ['mount', { id: 'mount', schema_version: 1, revision: 1,
    value: { cache_directory: '', cache_max_bytes: 10 * 2 ** 30, cache_min_free_bytes: 512 * 2 ** 20 },
    state: { status: 'applied', default_directory: 'D:/Termous', active_cache_directory: 'D:/Termous/cache/vfs', next_cache_directory: 'D:/Termous/cache/vfs', active_cache_max_bytes: 10 * 2 ** 30, active_cache_min_free_bytes: 512 * 2 ** 20 } }],
])
const store = new SettingsModuleStore({
  read: async id => {
    const snapshot = snapshots.get(id)
    if (!snapshot) throw new Error('预览未提供此模块')
    return structuredClone(snapshot)
  },
  update: async (id, request) => {
    const current = snapshots.get(id)
    if (!current) throw new Error('预览未提供此模块')
    const next = { ...current, revision: current.revision + 1, value: { ...current.value, ...request.patch } }
    snapshots.set(id, next)
    return next
  },
})
const gateway = { getModule: store.snapshot.bind(store), readModule: store.read.bind(store), updateModule: store.update.bind(store), subscribeSettings: store.subscribe }
async function unsupported(): Promise<never> { throw new Error('此验收入口不执行外部资源操作') }
const dataGateway: DataPortabilityGateway = {
  dataPortabilitySummary: async () => ({ total_items: 26, asset_count: 2, asset_bytes: 24576,
    datasets: [{ key: 'hosts', count: 18 }, { key: 'settings', count: 8 }] }),
  createDataPortabilityPlan: unsupported, dataPortabilityPlanItems: unsupported,
  resolveDataPortabilityPlan: unsupported, applyDataPortabilityPlan: unsupported, cancelDataPortabilityImport: unsupported,
}
const shortcuts = { runtime: new ShortcutRuntime({ index: { platform: 'win32', byChord: new Map() } }), platform: 'win32' as const, labels: new Map(), bindingSignatures: new Map() }
const updates: UpdateRuntimeValue = {
  bridgeAvailable: false, initialized: true, initializationFailed: false, runtimeGeneration: 1, snapshot: null,
  setUpdatePreferences: unsupported, openUpdateWindow: async () => false, retryInitialization: async () => false,
}

let preferences: UpdatePreferences = {
  automatic_check: true, check_interval: 'daily', automatic_download: false,
  last_checked_at: null, revision: 1,
}
const previewUpdateRuntime: UpdatePreferencesRuntime = {
  generation: 1, loadFailed: false, preferences, retry: async () => true,
  setPreferences: async patch => {
    preferences = { ...preferences, ...patch, revision: preferences.revision + 1 }
    previewUpdateRuntime.preferences = preferences
    return preferences
  },
}

export function Preview() {
  const [open, setOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [appearance, setAppearance] = useState({ theme: new URLSearchParams(location.search).has('light') ? 'light' as const : 'dark' as const })
  const [language, setLanguage] = useState<'zh-CN' | 'en-US'>('zh-CN')
  const [terminal, setTerminal] = useState(defaultTerminalSettings)
  const [connection, setConnection] = useState(defaultConnectionSettings)
  const [completion, setCompletion] = useState(defaultCompletionSettings)
  const [windowSettings, setWindowSettings] = useState<WindowSettings>({ close_behavior: 'exit' })
  return <TermousUiProvider language={language} theme={appearance.theme}>
    <ShortcutRuntimeContextProvider value={shortcuts}>
      <UpdateRuntimeContext.Provider value={updates}>
      <PreviewMcpProvider>
      <AppShell page="workbench" appVersion="0.0.0-preview" windowCloseBehavior="exit" sidebarCollapsed={collapsed}
        contentInert={open}
        actionBusy={false} onNavigate={target => { if (target === 'settings') setOpen(true) }}
        onOpenConnectionLauncher={() => undefined} onOpenLocalTerminal={() => undefined}
        onOpenProductTour={() => undefined} onToggleSidebar={() => setCollapsed(value => !value)}>
        <WorkspaceEmptyState icon={<SquareTerminal size={24} />} title="工作站" description="连接主机，开始终端会话" />
      </AppShell>
        <SettingsDialog open={open} onClose={() => setOpen(false)} initialTab={new URLSearchParams(location.search).has('models') ? 'models' : 'agent'} settingsGateway={gateway} language={language} appearanceSettings={appearance}
          terminalSettings={terminal} sshSmoothScrollEnabled={false} completionSettings={completion}
          connectionSettings={connection} shortcutSettings={defaultShortcutSettings} windowSettings={windowSettings}
          terminalFonts={[]} appVersion="0.0.0-preview" dataPortabilityGateway={dataGateway}
          auditSettingsGateway={gateway} mountSettingsGateway={gateway} agentSetupGateway={agentGateway} actionBusy={false}
          updatePreferencesRuntime={previewUpdateRuntime}
          onLanguageChange={async value => setLanguage(value)} onAppearanceSettingsChange={async value => setAppearance(value)}
          onTerminalSettingsChange={async value => setTerminal(value)} onConnectionSettingsChange={async patch => setConnection(value => ({ ...value, ...patch }))}
          onCompletionSettingsChange={async patch => setCompletion(value => ({ ...value, ...patch, providers: { ...value.providers, ...patch.providers } }))}
          onWindowSettingsChange={async value => setWindowSettings(value)} onShortcutSettingsChange={unsupported}
          onSshSmoothScrollChange={() => undefined} onUploadTerminalFont={unsupported} onDeleteTerminalFont={unsupported} />
      </PreviewMcpProvider>
      </UpdateRuntimeContext.Provider>
    </ShortcutRuntimeContextProvider>
  </TermousUiProvider>
}
const root = createRoot(document.getElementById('root')!)
root.render(<Preview />)
import.meta.hot?.dispose(() => {
  root.unmount()
  disconnectClipboard()
})

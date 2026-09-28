import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  AppearanceSettings,
  CompletionSettings,
  ConnectionSettings,
  TerminalSettings,
  WindowSettings,
} from '#common/contracts'
import type { AgentSetupGateway } from '#features/agent-setup'

const childState = vi.hoisted(() => ({
  agentSetupGateway: null as unknown,
  dataPortabilityGateway: null as unknown,
  auditSettingsGateway: null as unknown,
  platform: 'darwin' as const,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('#entities/shortcuts', () => ({
  useShortcutRuntime: () => ({ platform: childState.platform }),
}))

vi.mock('#features/mcp-access', () => ({
  McpSettingsPanel: () => <div data-testid="mcp-settings" />,
}))

vi.mock('#features/agent-setup', () => ({
  AgentSettingsPanel: function AgentSettingsPanel({ gateway }: { gateway: unknown }) {
    const [draft, setDraft] = useState('')
    return (
      <div data-testid="agent-settings" ref={() => { childState.agentSetupGateway = gateway }}>
        <input aria-label="agent-draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      </div>
    )
  },
}))

vi.mock('#features/settings', () => ({
  AuditSettings: function AuditSettings({ gateway, disabled }: { gateway: unknown; disabled: boolean }) {
    const [draft, setDraft] = useState('')
    return <div data-testid="audit-settings" ref={() => { childState.auditSettingsGateway = gateway }}>
      <input aria-label="audit-draft" disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} />
    </div>
  },
  MountSettings: () => <div data-testid="mount-settings" />,
  NotificationSettings: () => <div data-testid="notification-settings" />,
  DataPortabilitySettings: ({ appVersion, gateway }: { appVersion: string; gateway: unknown }) => (
    <div
      data-testid="data-portability"
      data-app-version={appVersion}
      ref={() => {
        childState.dataPortabilityGateway = gateway
      }}
    />
  ),
  ConnectionSettings: ({
    onChange,
    value,
  }: {
    onChange: (settings: ConnectionSettings) => Promise<void>
    value: ConnectionSettings
  }) => (
    <button
      type="button"
      onClick={() => void onChange({ ...value, ssh_keepalive_enabled: !value.ssh_keepalive_enabled })}
    >
      connection-change
    </button>
  ),
  GeneralSettings: ({
    onAppearanceSettingsChange,
    onLanguageChange,
    onWindowSettingsChange,
  }: {
    onAppearanceSettingsChange: (settings: AppearanceSettings) => Promise<void>
    onLanguageChange: (language: string) => Promise<void>
    onWindowSettingsChange: (settings: WindowSettings) => Promise<void>
  }) => (
    <div data-testid="general-settings">
      <button type="button" onClick={() => void onAppearanceSettingsChange({ theme: 'light' })}>
        settings.themeLight
      </button>
      <button type="button" onClick={() => void onLanguageChange('en-US')}>
        settings.english
      </button>
      <button
        type="button"
        onClick={() => void onWindowSettingsChange({ close_behavior: 'minimize_to_tray' })}
      >
        settings.closeBehaviorMinimizeToTray
      </button>
    </div>
  ),
  ShortcutSettingsPanel: ({
    onPatchChanges,
    onResetAll,
    platform,
  }: {
    onPatchChanges: (changes: Record<string, unknown>) => Promise<void>
    onResetAll: () => Promise<void>
    platform: string
  }) => (
    <div data-testid="shortcut-settings" data-platform={platform}>
      <button type="button" onClick={() => void onPatchChanges({ 'terminal.paste': null })}>shortcut-patch</button>
      <button type="button" onClick={() => void onResetAll()}>shortcut-reset</button>
    </div>
  ),
  TerminalCompletionSettings: ({
    onChange,
    value,
    modelStatus,
    onOpenAgentSettings,
  }: {
    onChange: (settings: CompletionSettings) => Promise<void>
    value: CompletionSettings
    modelStatus?: { status: string; label?: string }
    onOpenAgentSettings?: () => void
  }) => (
    <div>
      <button type="button" onClick={() => void onChange({ ...value, enabled: false })}>completion-change</button>
      <span data-testid="completion-model">{modelStatus?.label ?? modelStatus?.status}</span>
      <button type="button" onClick={onOpenAgentSettings}>completion-open-agent-settings</button>
    </div>
  ),
  TerminalStyleSettings: ({
    fonts,
    onChange,
    onDeleteFont,
    onSshSmoothScrollChange,
    onUploadFont,
    sshSmoothScrollEnabled,
    value,
  }: {
    fonts: Array<{ id: string }>
    onChange: (settings: TerminalSettings) => Promise<void>
    onDeleteFont: (id: string) => Promise<void>
    onSshSmoothScrollChange: (enabled: boolean) => void
    onUploadFont: (file: File) => Promise<unknown>
    sshSmoothScrollEnabled: boolean
    value: TerminalSettings
  }) => (
    <div
      data-testid="terminal-style"
      data-font-count={fonts.length}
      data-smooth-scroll={String(sshSmoothScrollEnabled)}
    >
      <button type="button" onClick={() => void onChange({ ...value, font_size: 14 })}>terminal-change</button>
      <button type="button" onClick={() => onSshSmoothScrollChange(!sshSmoothScrollEnabled)}>smooth-scroll-change</button>
      <button type="button" onClick={() => void onUploadFont(new File(['font'], 'custom.ttf'))}>terminal-upload</button>
      <button type="button" onClick={() => void onDeleteFont('custom-font')}>terminal-delete</button>
    </div>
  ),
  UpdateSettings: ({ updateRuntime }: { updateRuntime?: { generation: number } | null }) => (
    <div data-testid="update-settings" data-generation={updateRuntime?.generation} />
  ),
}))

import { SettingsPage } from '#pages/settings'

const terminalSettings: TerminalSettings = {
  font_family: 'jetbrains_mono',
  font_size: 13,
  line_height: 1.2,
  letter_spacing: 0,
  cursor_style: 'block',
  cursor_blink: true,
  theme_mode: 'follow_app',
  scrollback: 5000,
}

const completionSettings: CompletionSettings = {
  enabled: true,
  ai_enabled: false,
  providers: {
    native: true,
    alias: true,
    snippet: true,
    history: true,
    directory: true,
  },
}

function renderSettingsPage(overrides: Record<string, unknown> = {}) {
  const handlers = {
    auditSettingsGateway: {
      getModule: vi.fn(), readModule: vi.fn(), updateModule: vi.fn(), subscribeSettings: vi.fn(() => () => {}),
    },
    agentSetupGateway: { readiness: vi.fn(async () => { throw new Error('unused') }) } as unknown as AgentSetupGateway,
    dataPortabilityGateway: {
      applyDataPortabilityPlan: vi.fn(async () => { throw new Error('unused') }),
      cancelDataPortabilityImport: vi.fn(async () => { throw new Error('unused') }),
      createDataPortabilityPlan: vi.fn(async () => { throw new Error('unused') }),
      dataPortabilityPlanItems: vi.fn(async () => { throw new Error('unused') }),
      dataPortabilitySummary: vi.fn(async () => { throw new Error('unused') }),
      resolveDataPortabilityPlan: vi.fn(async () => { throw new Error('unused') }),
    },
    onAppearanceSettingsChange: vi.fn(async () => undefined),
    onCompletionSettingsChange: vi.fn(async () => undefined),
    onConnectionSettingsChange: vi.fn(async () => undefined),
    onDeleteTerminalFont: vi.fn(async () => undefined),
    onLanguageChange: vi.fn(async () => undefined),
    onShortcutSettingsChange: vi.fn(async () => undefined),
    onSshSmoothScrollChange: vi.fn(),
    onTerminalSettingsChange: vi.fn(async () => undefined),
    onUploadTerminalFont: vi.fn(async () => ({
      id: 'uploaded-font',
      kind: 'imported' as const,
      display_name: 'Uploaded',
      family_name: 'Uploaded',
    })),
    onWindowSettingsChange: vi.fn(async () => undefined),
  }
  render(
    <SettingsPage
      language="zh-CN"
      appearanceSettings={{ theme: 'dark' }}
      terminalSettings={terminalSettings}
      sshSmoothScrollEnabled={false}
      completionSettings={completionSettings}
      connectionSettings={{
        ssh_keepalive_enabled: false,
        forward_auto_reconnect_enabled: false,
        remote_desktop_auto_reconnect_enabled: true,
      }}
      shortcutSettings={{ schema_version: 1, overrides: {} }}
      windowSettings={{ close_behavior: 'exit' }}
      terminalFonts={[]}
      appVersion="1.2.3"
      updatePreferencesRuntime={{
        generation: 7,
        loadFailed: false,
        preferences: null,
        retry: async () => true,
        setPreferences: async () => {
          throw new Error('unused')
        },
      }}
      actionBusy={false}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

describe('设置页面装配合同', () => {
  it('审计使用独立标签和专用接口，切换标签保留草稿', async () => {
    const user = userEvent.setup()
    const handlers = renderSettingsPage({ initialTab: 'audit' })
    expect(screen.getByRole('tab', { name: 'settings.tabAudit' })).toHaveAttribute('aria-selected', 'true')
    expect(childState.auditSettingsGateway).toBe(handlers.auditSettingsGateway)
    await user.type(screen.getByRole('textbox', { name: 'audit-draft' }), '30')
    await user.click(screen.getByRole('tab', { name: 'settings.tabGeneral' }))
    await user.click(screen.getByRole('tab', { name: 'settings.tabAudit' }))
    expect(screen.getByRole('textbox', { name: 'audit-draft' })).toHaveValue('30')
  })

  it('审计设置遵守全局忙碌状态', () => {
    renderSettingsPage({ initialTab: 'audit', actionBusy: true })
    expect(screen.getByRole('textbox', { name: 'audit-draft' })).toBeDisabled()
  })

  it('终端页读取默认模型，前往 AI 设置后再返回会刷新且保留设置草稿', async () => {
    const user = userEvent.setup()
    const getDefaultModelStatus = vi.fn().mockResolvedValue({ available: true, model_id: 'm1', model_name: 'Model one', provider_name: 'Provider' })
    renderSettingsPage({ initialTab: 'terminal', defaultModelStatusGateway: { getDefaultModelStatus } })
    await waitFor(() => expect(screen.getByTestId('completion-model')).toHaveTextContent('Model one'))
    await user.click(screen.getByRole('button', { name: 'completion-open-agent-settings' }))
    expect(screen.getByRole('tab', { name: 'settings.tabAgent' })).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByRole('textbox', { name: 'agent-draft' }), '保留草稿')
    getDefaultModelStatus.mockResolvedValue({ available: true, model_id: 'm2', model_name: 'Model two', provider_name: 'Provider' })
    await user.click(screen.getByRole('tab', { name: 'settings.tabTerminal' }))
    await waitFor(() => expect(screen.getByTestId('completion-model')).toHaveTextContent('Model two'))
    expect(getDefaultModelStatus).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: 'completion-open-agent-settings' }))
    expect(screen.getByRole('textbox', { name: 'agent-draft' })).toHaveValue('保留草稿')
  })

  it('提供十个页签并保持通用设置默认页签和命令委托', async () => {
    const user = userEvent.setup()
    const handlers = renderSettingsPage()
    const tabs = screen.getAllByRole('tab')

    expect(tabs).toHaveLength(10)
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'settings.tabGeneral',
      'settings.tabTerminal',
      'settings.tabConnection',
      'settings.tabMount',
      'settings.tabShortcuts',
      'settings.tabAgent',
      'settings.tabMcp',
      'settings.tabAudit',
      'settings.tabData',
      'settings.tabUpdates',
    ])
    expect(screen.getByRole('tab', { name: 'settings.tabAgent' }).querySelector('.lucide-bot')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'settings.tabMcp' }).querySelector('.mcp-icon')).not.toBeNull()
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('button', { name: 'settings.themeLight' }))
    await user.click(screen.getByRole('button', { name: 'settings.english' }))
    await user.click(screen.getByRole('button', { name: 'settings.closeBehaviorMinimizeToTray' }))

    expect(handlers.onAppearanceSettingsChange).toHaveBeenCalledWith({ theme: 'light' })
    expect(handlers.onLanguageChange).toHaveBeenCalledWith('en-US')
    expect(handlers.onWindowSettingsChange).toHaveBeenCalledWith({ close_behavior: 'minimize_to_tray' })
  })

  it('支持从 Agent 工作区直接打开 Agent 设置页签', () => {
    renderSettingsPage({ initialTab: 'agent' })

    expect(screen.getByRole('tab', { name: 'settings.tabAgent' }))
      .toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('agent-settings')).toBeInTheDocument()
  })

  it('向导页签锚点激活对应面板并保留懒挂载实例及未保存草稿', async () => {
    const user = userEvent.setup()
    const handlers = renderSettingsPage()
    const tabs = ['terminal', 'mcp', 'agent', 'data'] as const
    const panels = new Map<string, Element>()

    for (const tab of tabs) {
      expect(document.querySelector(`[data-tour="settings-${tab}"]`)).toBeNull()
      const anchor = document.querySelector<HTMLElement>(`[data-tour="settings-${tab}-tab"]`)
      expect(anchor).not.toBeNull()
      expect(anchor?.closest('[role="tab"]')).toHaveAttribute('aria-selected', 'false')
    }

    for (const tab of tabs) {
      const anchor = document.querySelector<HTMLElement>(`[data-tour="settings-${tab}-tab"]`)!
      await user.click(anchor)
      expect(anchor.closest('[role="tab"]')).toHaveAttribute('aria-selected', 'true')
      const panel = screen.getByRole('tabpanel').querySelector(`[data-tour="settings-${tab}"]`)
      expect(panel).not.toBeNull()
      panels.set(tab, panel!)
      if (tab === 'agent') {
        await user.type(screen.getByRole('textbox', { name: 'agent-draft' }), '未保存的 Provider 配置')
      }
    }

    for (const tab of [...tabs].reverse()) {
      await user.click(document.querySelector<HTMLElement>(`[data-tour="settings-${tab}-tab"]`)!)
      expect(screen.getByRole('tabpanel').querySelector(`[data-tour="settings-${tab}"]`))
        .toBe(panels.get(tab))
      if (tab === 'agent') {
        expect(screen.getByRole('textbox', { name: 'agent-draft' })).toHaveValue('未保存的 Provider 配置')
      }
    }

    expect(handlers.onTerminalSettingsChange).not.toHaveBeenCalled()
    expect(handlers.onCompletionSettingsChange).not.toHaveBeenCalled()
    expect(handlers.onUploadTerminalFont).not.toHaveBeenCalled()
    expect(handlers.onDeleteTerminalFont).not.toHaveBeenCalled()
  })

  it('保持终端、连接、快捷键、Agent、MCP、数据和更新子模块的 Props 与命令委托', async () => {
    const user = userEvent.setup()
    const handlers = renderSettingsPage()

    await user.click(screen.getByRole('tab', { name: 'settings.tabTerminal' }))
    expect(screen.getByTestId('terminal-style')).toHaveAttribute('data-smooth-scroll', 'false')
    await user.click(screen.getByRole('button', { name: 'terminal-change' }))
    await user.click(screen.getByRole('button', { name: 'smooth-scroll-change' }))
    await user.click(screen.getByRole('button', { name: 'completion-change' }))
    await user.click(screen.getByRole('button', { name: 'terminal-upload' }))
    await user.click(screen.getByRole('button', { name: 'terminal-delete' }))

    expect(handlers.onTerminalSettingsChange).toHaveBeenCalledWith({ ...terminalSettings, font_size: 14 })
    expect(handlers.onSshSmoothScrollChange).toHaveBeenCalledWith(true)
    expect(handlers.onCompletionSettingsChange).toHaveBeenCalledWith({ ...completionSettings, enabled: false })
    expect(handlers.onUploadTerminalFont).toHaveBeenCalledWith(expect.objectContaining({ name: 'custom.ttf' }))
    expect(handlers.onDeleteTerminalFont).toHaveBeenCalledWith('custom-font')

    await user.click(screen.getByRole('tab', { name: 'settings.tabConnection' }))
    await user.click(screen.getByRole('button', { name: 'connection-change' }))
    expect(handlers.onConnectionSettingsChange).toHaveBeenCalledWith({
      ssh_keepalive_enabled: true,
      forward_auto_reconnect_enabled: false,
      remote_desktop_auto_reconnect_enabled: true,
    })

    await user.click(screen.getByRole('tab', { name: 'settings.tabShortcuts' }))
    expect(screen.getByTestId('shortcut-settings')).toHaveAttribute('data-platform', 'darwin')
    await user.click(screen.getByRole('button', { name: 'shortcut-patch' }))
    await user.click(screen.getByRole('button', { name: 'shortcut-reset' }))
    expect(handlers.onShortcutSettingsChange).toHaveBeenNthCalledWith(1, {
      changes: { 'terminal.paste': null },
    })
    expect(handlers.onShortcutSettingsChange).toHaveBeenNthCalledWith(2, { reset_all: true })

    await user.click(screen.getByRole('tab', { name: 'settings.tabAgent' }))
    expect(screen.getByTestId('agent-settings')).toBeInTheDocument()
    expect(childState.agentSetupGateway).toBe(handlers.agentSetupGateway)

    await user.click(screen.getByRole('tab', { name: 'settings.tabMcp' }))
    expect(screen.getByTestId('mcp-settings')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'settings.tabData' }))
    expect(screen.getByTestId('data-portability')).toHaveAttribute('data-app-version', '1.2.3')
    expect(childState.dataPortabilityGateway).toBe(handlers.dataPortabilityGateway)

    await user.click(screen.getByRole('tab', { name: 'settings.tabUpdates' }))
    expect(screen.getByTestId('update-settings')).toHaveAttribute('data-generation', '7')
  })
})

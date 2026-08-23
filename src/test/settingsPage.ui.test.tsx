import { useState, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  AppearanceSettings,
  CompletionSettings,
  ConnectionSettings,
  TerminalSettings,
  WindowSettings,
} from '#common/contracts'

const childState = vi.hoisted(() => ({
  dataPortabilityGateway: null as unknown,
  platform: 'darwin' as const,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('antd', () => ({
  Segmented: ({
    disabled,
    onChange,
    options,
    value,
  }: {
    disabled?: boolean
    onChange?: (value: string) => void
    options: Array<{ label: ReactNode; value: string }>
    value?: string
  }) => (
    <div data-segmented-value={value}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  Tabs: ({
    items,
  }: {
    items: Array<{ children: ReactNode; key: string; label: ReactNode }>
  }) => {
    const [activeKey, setActiveKey] = useState(items[0]?.key)
    const activeItem = items.find((item) => item.key === activeKey)
    return (
      <div>
        <div role="tablist">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={item.key === activeKey}
              onClick={() => setActiveKey(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div role="tabpanel">{activeItem?.children}</div>
      </div>
    )
  },
}))

vi.mock('#entities/shortcuts', () => ({
  useShortcutRuntime: () => ({ platform: childState.platform }),
}))

vi.mock('#features/mcp-access', () => ({
  McpSettingsPanel: () => <div data-testid="mcp-settings" />,
}))

vi.mock('#features/settings', () => ({
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
  }: {
    onChange: (settings: CompletionSettings) => Promise<void>
    value: CompletionSettings
  }) => (
    <button type="button" onClick={() => void onChange({ ...value, enabled: false })}>
      completion-change
    </button>
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
  it('保持七个页签及通用设置默认页签和命令委托', async () => {
    const user = userEvent.setup()
    const handlers = renderSettingsPage()
    const tabs = screen.getAllByRole('tab')

    expect(tabs).toHaveLength(7)
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'settings.tabGeneral',
      'settings.tabTerminal',
      'settings.tabConnection',
      'settings.tabShortcuts',
      'settings.tabMcp',
      'settings.tabData',
      'settings.tabUpdates',
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('button', { name: 'settings.themeLight' }))
    await user.click(screen.getByRole('button', { name: 'settings.english' }))
    await user.click(screen.getByRole('button', { name: 'settings.closeBehaviorMinimizeToTray' }))

    expect(handlers.onAppearanceSettingsChange).toHaveBeenCalledWith({ theme: 'light' })
    expect(handlers.onLanguageChange).toHaveBeenCalledWith('en-US')
    expect(handlers.onWindowSettingsChange).toHaveBeenCalledWith({ close_behavior: 'minimize_to_tray' })
  })

  it('保持终端、连接、快捷键、MCP、数据和更新子模块的 Props 与命令委托', async () => {
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
    })

    await user.click(screen.getByRole('tab', { name: 'settings.tabShortcuts' }))
    expect(screen.getByTestId('shortcut-settings')).toHaveAttribute('data-platform', 'darwin')
    await user.click(screen.getByRole('button', { name: 'shortcut-patch' }))
    await user.click(screen.getByRole('button', { name: 'shortcut-reset' }))
    expect(handlers.onShortcutSettingsChange).toHaveBeenNthCalledWith(1, {
      changes: { 'terminal.paste': null },
    })
    expect(handlers.onShortcutSettingsChange).toHaveBeenNthCalledWith(2, { reset_all: true })

    await user.click(screen.getByRole('tab', { name: 'settings.tabMcp' }))
    expect(screen.getByTestId('mcp-settings')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'settings.tabData' }))
    expect(screen.getByTestId('data-portability')).toHaveAttribute('data-app-version', '1.2.3')
    expect(childState.dataPortabilityGateway).toBe(handlers.dataPortabilityGateway)

    await user.click(screen.getByRole('tab', { name: 'settings.tabUpdates' }))
    expect(screen.getByTestId('update-settings')).toHaveAttribute('data-generation', '7')
  })
})

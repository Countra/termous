import type { ComponentType } from 'react'
import { Bot, ClipboardList, CloudCog, DatabaseBackup, HardDrive, Keyboard, MonitorPlay, Network, RefreshCw, Settings2, SquareTerminal } from 'lucide-react'
import { McpIcon } from '#shared/ui'
import type { SettingsModuleId } from '#common/contracts'

interface SettingsPageRegistration {
  id: string
  title: string
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>
  modules: readonly SettingsModuleId[]
  tour?: string
  group: 'basics' | 'connections' | 'intelligence' | 'maintenance'
  mode: 'automatic' | 'manual' | 'resources'
}

// 页面注册只组合专用面板；模型、客户端和备份等业务资源仍使用各自网关。
export const settingsPages = [
  { id: 'general', title: 'settings.tabGeneral', icon: Settings2, modules: ['language', 'appearance', 'window', 'login_item', 'notifications'], group: 'basics', mode: 'automatic' },
  { id: 'shortcuts', title: 'settings.tabShortcuts', icon: Keyboard, modules: ['shortcuts'], group: 'basics', mode: 'resources' },
  { id: 'terminal', title: 'settings.tabTerminal', icon: SquareTerminal, modules: ['terminal', 'completion', 'terminal_local'], tour: 'settings-terminal-tab', group: 'connections', mode: 'automatic' },
  { id: 'connection', title: 'settings.tabConnection', icon: Network, modules: ['connection'], group: 'connections', mode: 'automatic' },
  { id: 'remote-desktop', title: 'settings.tabRemoteDesktop', icon: MonitorPlay, modules: ['connection'], group: 'connections', mode: 'automatic' },
  { id: 'mount', title: 'settings.tabMount', icon: HardDrive, modules: ['mount'], tour: 'settings-mount-tab', group: 'connections', mode: 'manual' },
  { id: 'agent', title: 'settings.tabAgent', icon: Bot, modules: ['agent'], tour: 'settings-agent-tab', group: 'intelligence', mode: 'manual' },
  { id: 'models', title: 'settings.tabModels', tour: 'settings-models-tab', icon: CloudCog, modules: ['agent'], group: 'intelligence', mode: 'manual' },
  { id: 'mcp', title: 'settings.tabMcp', icon: McpIcon, modules: ['mcp'], tour: 'settings-mcp-tab', group: 'intelligence', mode: 'resources' },
  { id: 'audit', title: 'settings.tabAudit', icon: ClipboardList, modules: ['audit'], group: 'maintenance', mode: 'manual' },
  { id: 'data', title: 'settings.tabData', icon: DatabaseBackup, modules: [], tour: 'settings-data-tab', group: 'maintenance', mode: 'resources' },
  { id: 'updates', title: 'settings.tabUpdates', icon: RefreshCw, modules: ['updates'], group: 'maintenance', mode: 'automatic' },
] as const satisfies readonly SettingsPageRegistration[]

export type SettingsPageTabKey = typeof settingsPages[number]['id']

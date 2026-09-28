import type { ComponentType } from 'react'
import { Bot, ClipboardList, DatabaseBackup, HardDrive, Keyboard, Network, RefreshCw, Settings2, SquareTerminal } from 'lucide-react'
import { McpIcon } from '#shared/ui'
import type { SettingsModuleId } from '#common/contracts'

interface SettingsPageRegistration {
  id: string
  title: string
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>
  modules: readonly SettingsModuleId[]
  tour?: string
}

// 页面注册只组合专用面板；模型、客户端和备份等业务资源仍使用各自网关。
export const settingsPages = [
  { id: 'general', title: 'settings.tabGeneral', icon: Settings2, modules: ['language', 'appearance', 'window', 'login_item', 'notifications'] },
  { id: 'terminal', title: 'settings.tabTerminal', icon: SquareTerminal, modules: ['terminal', 'completion', 'terminal_local'], tour: 'settings-terminal-tab' },
  { id: 'connection', title: 'settings.tabConnection', icon: Network, modules: ['connection'] },
  { id: 'mount', title: 'settings.tabMount', icon: HardDrive, modules: ['mount'], tour: 'settings-mount-tab' },
  { id: 'shortcuts', title: 'settings.tabShortcuts', icon: Keyboard, modules: ['shortcuts'] },
  { id: 'agent', title: 'settings.tabAgent', icon: Bot, modules: ['agent'], tour: 'settings-agent-tab' },
  { id: 'mcp', title: 'settings.tabMcp', icon: McpIcon, modules: ['mcp'], tour: 'settings-mcp-tab' },
  { id: 'audit', title: 'settings.tabAudit', icon: ClipboardList, modules: ['audit'] },
  { id: 'data', title: 'settings.tabData', icon: DatabaseBackup, modules: [], tour: 'settings-data-tab' },
  { id: 'updates', title: 'settings.tabUpdates', icon: RefreshCw, modules: ['updates'] },
] as const satisfies readonly SettingsPageRegistration[]

export type SettingsPageTabKey = typeof settingsPages[number]['id']

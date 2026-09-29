export const coreSettingsModules = ['language', 'appearance', 'terminal', 'completion', 'connection', 'shortcuts', 'window', 'mount', 'audit', 'agent', 'mcp', 'cloud'] as const
export type CoreSettingsModule = typeof coreSettingsModules[number]
export const desktopSettingsModules = ['notifications', 'updates', 'login_item'] as const
export type DesktopSettingsModule = typeof desktopSettingsModules[number]
export type SettingsModuleId = CoreSettingsModule | DesktopSettingsModule | 'terminal_local'

export interface SettingsDescriptor {
  id: SettingsModuleId
  schema_version: number
  backup: 'include' | 'exclude'
  apply: 'immediate' | 'restart'
}

// 本机模块的归属与备份策略由代码声明，设置值和导入包不能改变该策略。
export const localSettingsDefinitions = {
  notifications: { id: 'notifications', owner: 'desktop', schema_version: 1, backup: 'exclude', apply: 'immediate' },
  updates: { id: 'updates', owner: 'desktop', schema_version: 1, backup: 'exclude', apply: 'immediate' },
  login_item: { id: 'login_item', owner: 'desktop', schema_version: 1, backup: 'exclude', apply: 'immediate' },
  terminal_local: { id: 'terminal_local', owner: 'browser', schema_version: 1, backup: 'exclude', apply: 'immediate' },
} as const satisfies Record<DesktopSettingsModule | 'terminal_local', SettingsDescriptor & { owner: 'desktop' | 'browser' }>

export interface SettingsSnapshot<T = Record<string, unknown>> {
  id: SettingsModuleId
  schema_version: number
  revision: number
  value: T
  state: { status: 'applied' | 'restart_required' | 'unavailable'; [key: string]: unknown }
}

export interface SettingsCatalogue {
  instance_id: string
  modules: (SettingsDescriptor & { snapshot?: SettingsSnapshot; error?: string })[]
}

export interface SettingsUpdate {
  expected_revision: number
  patch: Record<string, unknown>
}

export type SettingsEvent = { instance_id: string } & ({ type: 'resync' } | { type: 'changed'; module: SettingsModuleId; revision: number })

export const settingsIPCChannels = { get: 'settings:get', update: 'settings:update', changed: 'settings:changed' } as const
export interface DesktopSettingsBridge {
  get(module: DesktopSettingsModule): Promise<SettingsSnapshot>
  update(module: DesktopSettingsModule, request: SettingsUpdate): Promise<SettingsSnapshot>
  onChanged(listener: (event: SettingsEvent) => void): () => void
}

export type SettingsIPCResult = { ok: true; snapshot: SettingsSnapshot } | { ok: false; code: string }

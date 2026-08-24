import type { AppLanguage, AppTheme } from './application'

export type TerminalFontFamily = string

export type TerminalFontKind = 'builtin' | 'imported'

export interface TerminalFont {
  id: TerminalFontFamily
  kind: TerminalFontKind
  display_name: string
  family_name: string
  file_name?: string
  size_bytes?: number
  sha256?: string
  created_at?: string
}

export type TerminalCursorStyle = 'block' | 'bar' | 'underline'

export type TerminalThemeMode = 'follow_app' | 'dark' | 'light'

export interface TerminalSettings {
  font_family: TerminalFontFamily
  font_size: number
  line_height: number
  letter_spacing: number
  cursor_style: TerminalCursorStyle
  cursor_blink: boolean
  theme_mode: TerminalThemeMode
  scrollback: 1000 | 5000 | 10000 | 50000
}

export type CompletionProviderId = 'native' | 'alias' | 'snippet' | 'history' | 'directory'

export interface CompletionProviderSettings {
  native: boolean
  alias: boolean
  snippet: boolean
  history: boolean
  directory: boolean
}

export interface CompletionSettings {
  enabled: boolean
  providers: CompletionProviderSettings
}

export interface ConnectionSettings {
  ssh_keepalive_enabled: boolean
  forward_auto_reconnect_enabled: boolean
  remote_desktop_auto_reconnect_enabled: boolean
}

export type ShortcutModifier = 'primary' | 'control' | 'alt' | 'shift' | 'meta'

export interface ShortcutChord {
  modifiers: ShortcutModifier[]
  code: string
  key: string
}

export interface ShortcutActionOverride {
  bindings: ShortcutChord[]
}

export interface ShortcutSettings {
  schema_version: 1
  overrides: Record<string, ShortcutActionOverride>
}

export interface ShortcutSettingsPatch {
  changes?: Record<string, ShortcutActionOverride | null>
  reset_all?: boolean
}

export type WindowCloseBehavior = 'exit' | 'minimize_to_tray'

export interface WindowSettings {
  close_behavior: WindowCloseBehavior
}

export interface AppearanceSettings {
  theme: AppTheme
}

export interface Settings {
  language: AppLanguage
  appearance: AppearanceSettings
  terminal: TerminalSettings
  completion: CompletionSettings
  connection: ConnectionSettings
  shortcuts: ShortcutSettings
  window: WindowSettings
}

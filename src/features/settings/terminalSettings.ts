import type {
  AppearanceSettings,
  Settings,
  WindowSettings,
} from '../../types/domain'
import {
  normalizeCompletionSettings,
  normalizeTerminalSettings,
} from '#features/terminal'
import { normalizeShortcutSettings } from './shortcutSettings.ts'

export {
  completionProviderIds,
  completionProviderSettingsSignature,
  completionSettingsEqual,
  defaultCompletionProviderSettings,
  defaultCompletionSettings,
  defaultTerminalSettings,
  hasEnabledCompletionProvider,
  normalizeCompletionProviderSettings,
  normalizeCompletionSettings,
  normalizeTerminalSettings,
} from '#features/terminal'

export const defaultAppearanceSettings: AppearanceSettings = {
  theme: 'dark',
}

export const defaultWindowSettings: WindowSettings = {
  close_behavior: 'exit',
}

const closeBehaviors = new Set(['exit', 'minimize_to_tray'])
const appearanceThemes = new Set(['dark', 'light'])

export function normalizeSettings(settings: Partial<Settings> | null | undefined): Settings {
  return {
    language: settings?.language === 'en-US' ? 'en-US' : 'zh-CN',
    appearance: normalizeAppearanceSettings(settings?.appearance),
    terminal: normalizeTerminalSettings(settings?.terminal),
    completion: normalizeCompletionSettings(settings?.completion),
    shortcuts: normalizeShortcutSettings(settings?.shortcuts),
    window: normalizeWindowSettings(settings?.window),
  }
}

export function normalizeAppearanceSettings(settings: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  const theme = settings?.theme
  return {
    theme: appearanceThemes.has(String(theme)) ? (theme as AppearanceSettings['theme']) : defaultAppearanceSettings.theme,
  }
}

export function normalizeWindowSettings(settings: Partial<WindowSettings> | null | undefined): WindowSettings {
  const closeBehavior = settings?.close_behavior
  return {
    close_behavior: closeBehaviors.has(String(closeBehavior)) ? (closeBehavior as WindowSettings['close_behavior']) : defaultWindowSettings.close_behavior,
  }
}

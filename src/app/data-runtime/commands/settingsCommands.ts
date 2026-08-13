import type {
  AppearanceSettings,
  CompletionSettings,
  Settings,
  ShortcutSettingsPatch,
  TerminalSettings,
  WindowSettings,
} from '#common/contracts'
import type { SettingsCommandGateway } from '../api/runtimeGatewayContracts'
import { changeLanguage } from '#shared/i18n'
import {
  applyShortcutSettingsPatch,
  completionSettingsEqual,
  normalizeSettings,
  shortcutSettingsEqual,
} from '#features/settings'
import { SerialMutationQueue } from '#shared/async'
import { upsertTerminalFont } from '../model/appDataState'
import type { MutableValue, SetAppData } from '../model/runtimeTypes'

interface SettingsCommandDependencies {
  api: SettingsCommandGateway
  currentSettings: Settings
  setData: SetAppData
  completionSettingsMutation: MutableValue<number>
  completionSettingsPendingWrites: MutableValue<number>
  completionSettingsWriteQueue: SerialMutationQueue
  completionSettings: MutableValue<CompletionSettings>
  confirmedCompletionSettings: MutableValue<CompletionSettings>
  shortcutSettingsMutation: MutableValue<number>
  shortcutSettingsPendingWrites: MutableValue<number>
  shortcutSettingsWriteQueue: SerialMutationQueue
  shortcutSettings: MutableValue<Settings['shortcuts']>
  confirmedShortcutSettings: MutableValue<Settings['shortcuts']>
}

export function createSettingsCommands({
  api,
  currentSettings,
  setData,
  completionSettingsMutation,
  completionSettingsPendingWrites,
  completionSettingsWriteQueue,
  completionSettings,
  confirmedCompletionSettings,
  shortcutSettingsMutation,
  shortcutSettingsPendingWrites,
  shortcutSettingsWriteQueue,
  shortcutSettings,
  confirmedShortcutSettings,
}: SettingsCommandDependencies) {
  return {
    async setLanguage(language: Settings['language']) {
      const settings = normalizeSettings(await api.updateLanguage(language))
      setData((current) => ({ ...current, settings }))
      await changeLanguage(settings.language)
    },
    async setAppearanceSettings(appearance: AppearanceSettings) {
      const previousSettings = currentSettings
      setData((current) => ({ ...current, settings: { ...current.settings, appearance } }))
      try {
        const settings = normalizeSettings(await api.updateAppearanceSettings(appearance))
        setData((current) => ({ ...current, settings }))
      } catch (updateError) {
        setData((current) => ({ ...current, settings: previousSettings }))
        throw updateError
      }
    },
    async setTerminalSettings(terminal: TerminalSettings) {
      const previousSettings = currentSettings
      setData((current) => ({ ...current, settings: { ...current.settings, terminal } }))
      try {
        const settings = normalizeSettings(await api.updateTerminalSettings(terminal))
        setData((current) => ({ ...current, settings }))
      } catch (updateError) {
        setData((current) => ({ ...current, settings: previousSettings }))
        throw updateError
      }
    },
    async setCompletionSettings(completion: CompletionSettings) {
      const mutation = completionSettingsMutation.current + 1
      completionSettingsMutation.current = mutation
      completionSettingsPendingWrites.current += 1
      completionSettings.current = completion
      setData((current) => ({ ...current, settings: { ...current.settings, completion } }))
      try {
        const settings = normalizeSettings(await completionSettingsWriteQueue.enqueue(
          () => api.updateCompletionSettings(completion),
        ))
        confirmedCompletionSettings.current = settings.completion
        if (completionSettingsMutation.current !== mutation) {
          return
        }
        if (!completionSettingsEqual(completionSettings.current, completion)) {
          return
        }
        completionSettings.current = settings.completion
        setData((current) => (
          completionSettingsEqual(current.settings.completion, completion)
            ? {
                ...current,
                settings: {
                  ...current.settings,
                  completion: settings.completion,
                },
              }
            : current
        ))
      } catch (updateError) {
        if (completionSettingsMutation.current !== mutation) {
          return
        }
        if (!completionSettingsEqual(completionSettings.current, completion)) {
          throw updateError
        }
        const confirmedCompletion = confirmedCompletionSettings.current
        completionSettings.current = confirmedCompletion
        setData((current) => (
          completionSettingsEqual(current.settings.completion, completion)
            ? {
                ...current,
                settings: {
                  ...current.settings,
                  completion: confirmedCompletion,
                },
              }
            : current
        ))
        throw updateError
      } finally {
        completionSettingsPendingWrites.current = Math.max(
          0,
          completionSettingsPendingWrites.current - 1,
        )
      }
    },
    async updateShortcutSettings(patch: ShortcutSettingsPatch) {
      const mutation = shortcutSettingsMutation.current + 1
      shortcutSettingsMutation.current = mutation
      shortcutSettingsPendingWrites.current += 1
      const optimistic = applyShortcutSettingsPatch(shortcutSettings.current, patch)
      shortcutSettings.current = optimistic
      setData((current) => ({
        ...current,
        settings: { ...current.settings, shortcuts: optimistic },
      }))
      try {
        const settings = normalizeSettings(await shortcutSettingsWriteQueue.enqueue(
          () => api.updateShortcutSettings(patch),
        ))
        confirmedShortcutSettings.current = settings.shortcuts
        if (shortcutSettingsMutation.current !== mutation) {
          return
        }
        if (!shortcutSettingsEqual(shortcutSettings.current, optimistic)) {
          return
        }
        shortcutSettings.current = settings.shortcuts
        setData((current) => (
          shortcutSettingsEqual(current.settings.shortcuts, optimistic)
            ? {
                ...current,
                settings: {
                  ...current.settings,
                  shortcuts: settings.shortcuts,
                },
              }
            : current
        ))
      } catch (updateError) {
        if (shortcutSettingsMutation.current !== mutation) {
          throw updateError
        }
        if (!shortcutSettingsEqual(shortcutSettings.current, optimistic)) {
          throw updateError
        }
        const confirmedShortcuts = confirmedShortcutSettings.current
        shortcutSettings.current = confirmedShortcuts
        setData((current) => (
          shortcutSettingsEqual(current.settings.shortcuts, optimistic)
            ? {
                ...current,
                settings: {
                  ...current.settings,
                  shortcuts: confirmedShortcuts,
                },
              }
            : current
        ))
        throw updateError
      } finally {
        shortcutSettingsPendingWrites.current = Math.max(
          0,
          shortcutSettingsPendingWrites.current - 1,
        )
      }
    },
    async setWindowSettings(windowSettings: WindowSettings) {
      const previousSettings = currentSettings
      setData((current) => ({ ...current, settings: { ...current.settings, window: windowSettings } }))
      try {
        const settings = normalizeSettings(await api.updateWindowSettings(windowSettings))
        setData((current) => ({ ...current, settings }))
      } catch (updateError) {
        setData((current) => ({ ...current, settings: previousSettings }))
        throw updateError
      }
    },
    async uploadTerminalFont(file: File) {
      const font = await api.uploadTerminalFont(file)
      const terminalFonts = await api.terminalFonts()
      setData((current) => ({
        ...current,
        terminalFonts: terminalFonts ?? upsertTerminalFont(current.terminalFonts, font),
      }))
      return font
    },
    async deleteTerminalFont(id: string) {
      await api.deleteTerminalFont(id)
      const [settings, terminalFonts] = await Promise.all([api.settings(), api.terminalFonts()])
      setData((current) => ({
        ...current,
        settings: normalizeSettings(settings),
        terminalFonts: terminalFonts ?? current.terminalFonts.filter((font) => font.id !== id),
      }))
    },
  }
}

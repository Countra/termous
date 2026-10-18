import type { AppearanceSettings, CompletionSettingsPatch, ConnectionSettingsPatch, Settings, ShortcutSettingsPatch, TerminalSettings, WindowSettings } from '#common/contracts'
import type { SettingsCommandGateway } from '../api/runtimeGatewayContracts'
import { upsertTerminalFont } from '../model/appDataState'
import type { SetAppData } from '../model/runtimeTypes'

// 设置确认值统一由模块状态订阅派生；命令不再持有第二份可写聚合状态。
export function createSettingsCommands({ api, setData }: { api: SettingsCommandGateway; setData: SetAppData }) {
  return {
    async setLanguage(value: Settings['language']) { await api.updateLanguage(value) },
    async setAppearanceSettings(value: AppearanceSettings) { await api.updateAppearanceSettings(value) },
    async setTerminalSettings(value: TerminalSettings) { await api.updateTerminalSettings(value) },
    async setCompletionSettings(value: CompletionSettingsPatch) { await api.updateCompletionSettings(value) },
    async setConnectionSettings(value: ConnectionSettingsPatch) { await api.updateConnectionSettings(value) },
    async updateShortcutSettings(value: ShortcutSettingsPatch) { await api.updateShortcutSettings(value) },
    async setWindowSettings(value: WindowSettings) { await api.updateWindowSettings(value) },
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
      const [, terminalFonts] = await Promise.all([api.settings(), api.terminalFonts()])
      setData((current) => ({
        ...current,
        terminalFonts: terminalFonts ?? current.terminalFonts.filter((font) => font.id !== id),
      }))
    },
  }
}

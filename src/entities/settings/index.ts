export {
  findTerminalFont,
  fontFamilyFromSetting,
  loadTerminalFont,
  syncImportedFontFaces,
} from './model/terminalFonts.ts'
export {
  defaultConnectionSettings,
  normalizeConnectionSettings,
} from './model/connectionSettings.ts'
export {
  completionProviderIds,
  completionProviderSettingsSignature,
  defaultCompletionProviderSettings,
  defaultCompletionSettings,
  defaultTerminalSettings,
  hasEnabledCompletionProvider,
  normalizeCompletionProviderSettings,
  normalizeCompletionSettings,
  normalizeTerminalSettings,
} from './model/terminalSettings.ts'
export { terminalTheme } from './model/terminalTheme.ts'

export { settingsErrorCode, SettingsModuleStore, decodeSettingsSnapshot, decodeSettingsCatalogue, decodeSettingsEvent, type SettingsTransport } from './model/moduleState.ts'

export { SettingsGatewayContext, useSettingsModule, type SettingsGateway } from './model/useSettingsModule.ts'
export { decodeMountSettings } from './model/mountSettings.ts'

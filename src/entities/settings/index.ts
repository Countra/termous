export {
  findTerminalFont,
  fontFamilyFromSetting,
  loadTerminalFont,
  syncImportedFontFaces,
} from './model/terminalFonts.ts'
export {
  connectionSettingsEqual,
  defaultConnectionSettings,
  normalizeConnectionSettings,
} from './model/connectionSettings.ts'
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
} from './model/terminalSettings.ts'
export { terminalTheme } from './model/terminalTheme.ts'

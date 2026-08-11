import type {
  AppTheme as ThemeMode,
  TerminalSettings,
} from '#common/contracts'
import type { SessionKind } from '#entities/session'

export const SSH_TERMINAL_SMOOTH_SCROLL_DURATION_MS = 125

export function shouldFitAfterSettingsChange(previous: TerminalSettings, next: TerminalSettings) {
  return (
    previous.font_family !== next.font_family ||
    previous.font_size !== next.font_size ||
    previous.line_height !== next.line_height ||
    previous.letter_spacing !== next.letter_spacing
  )
}

export function terminalSmoothScrollDuration(
  sessionKind: SessionKind | undefined,
  enabled: boolean,
) {
  return sessionKind === 'ssh' && enabled
    ? SSH_TERMINAL_SMOOTH_SCROLL_DURATION_MS
    : 0
}

export function terminalTheme(settings: TerminalSettings, appTheme: ThemeMode) {
  const theme = settings.theme_mode === 'follow_app' ? appTheme : settings.theme_mode
  if (theme === 'light') {
    return {
      background: '#fbfcfe',
      foreground: '#1f2630',
      cursor: '#1f6feb',
      selectionBackground: '#d7e5ff',
      black: '#151a22',
      blue: '#1f6feb',
      cyan: '#087f9b',
      green: '#0e7d58',
      magenta: '#7d55c7',
      red: '#bf343b',
      white: '#ffffff',
      yellow: '#966100',
    }
  }
  return {
    background: '#080a0f',
    foreground: '#e6ebf4',
    cursor: '#61a8ff',
    selectionBackground: '#24476d',
    black: '#020617',
    blue: '#61a8ff',
    cyan: '#22d3ee',
    green: '#34d399',
    magenta: '#b58cff',
    red: '#ff6a63',
    white: '#f8fafc',
    yellow: '#f0b84c',
  }
}

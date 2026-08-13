import type { TerminalSettings } from '#common/contracts'
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
